/**
 * Tests for install.sh and uninstall.sh scripts.
 *
 * Runs the scripts in isolated temp directories with overridden environment
 * variables (SQUADRN_INSTALL_DIR, SQUADRN_BIN_DIR) to avoid touching the
 * real system. A fake binary is used instead of downloading from GitHub.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { fromFileUrl } from "@std/path";

const PROJECT_ROOT = join(fromFileUrl(import.meta.url), "..", "..", "..");
const INSTALL_SCRIPT = join(PROJECT_ROOT, "docs", "site", "install.sh");
const UNINSTALL_SCRIPT = join(PROJECT_ROOT, "docs", "site", "uninstall.sh");

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

/** Run a shell script with env overrides, capturing stdout+stderr. */
async function runScript(
  script: string,
  env: Record<string, string>,
  stdin?: string,
): Promise<{ code: number; output: string }> {
  const cmd = new Deno.Command("sh", {
    args: [script],
    env: { ...Deno.env.toObject(), ...env, TERM: "dumb" },
    stdin: stdin !== undefined ? "piped" : "null",
    stdout: "piped",
    stderr: "piped",
  });

  const proc = cmd.spawn();

  if (stdin !== undefined && proc.stdin) {
    const writer = proc.stdin.getWriter();
    await writer.write(new TextEncoder().encode(stdin));
    await writer.close();
  }

  const { code, stdout, stderr } = await proc.output();
  const output = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);
  return { code, output };
}

/** Create a fake "squadrn" binary that responds to --version. */
async function createFakeBinary(binDir: string): Promise<void> {
  const binPath = join(binDir, "squadrn");
  await Deno.writeTextFile(binPath, '#!/bin/sh\necho "0.1.0"\n');
  await Deno.chmod(binPath, 0o755);
}

/**
 * Create a patched install script that uses a fake binary instead of
 * downloading from GitHub.
 */
async function createPatchedInstall(
  dir: string,
  fakeBinDir: string,
): Promise<string> {
  const original = await Deno.readTextFile(INSTALL_SCRIPT);

  const patched = original.replace(
    /# Get latest version[\s\S]*?chmod \+x "\$BIN_DIR\/squadrn"/,
    `# (patched for test: skip download, use fake binary)
cp "${join(fakeBinDir, "squadrn")}" "$BIN_DIR/squadrn"
chmod +x "$BIN_DIR/squadrn"`,
  );

  const patchedPath = join(dir, "install_patched.sh");
  await Deno.writeTextFile(patchedPath, patched);
  await Deno.chmod(patchedPath, 0o755);
  return patchedPath;
}

// ── Install tests ──────────────────────────────────────────────────────────

Deno.test("install - creates binary and data directory", async () => {
  await withTempDir(async (dir) => {
    const installDir = join(dir, ".squadrn");
    const binDir = join(dir, "bin");
    const fakeBinDir = join(dir, "fake");
    await Deno.mkdir(binDir, { recursive: true });
    await Deno.mkdir(fakeBinDir, { recursive: true });
    await createFakeBinary(fakeBinDir);

    const patchedScript = await createPatchedInstall(dir, fakeBinDir);

    const { code, output } = await runScript(patchedScript, {
      SQUADRN_INSTALL_DIR: installDir,
      SQUADRN_BIN_DIR: binDir,
      PATH: `${binDir}:${Deno.env.get("PATH") ?? ""}`,
    });

    assertEquals(code, 0, `Install failed with output:\n${output}`);
    assertStringIncludes(output, "installed successfully");

    const binStat = await Deno.stat(join(binDir, "squadrn"));
    assertEquals(binStat.isFile, true);

    const dirStat = await Deno.stat(installDir);
    assertEquals(dirStat.isDirectory, true);
  });
});

Deno.test("install - binary responds to --version", async () => {
  await withTempDir(async (dir) => {
    const installDir = join(dir, ".squadrn");
    const binDir = join(dir, "bin");
    const fakeBinDir = join(dir, "fake");
    await Deno.mkdir(binDir, { recursive: true });
    await Deno.mkdir(fakeBinDir, { recursive: true });
    await createFakeBinary(fakeBinDir);

    const patchedScript = await createPatchedInstall(dir, fakeBinDir);

    await runScript(patchedScript, {
      SQUADRN_INSTALL_DIR: installDir,
      SQUADRN_BIN_DIR: binDir,
      PATH: `${binDir}:${Deno.env.get("PATH") ?? ""}`,
    });

    const cmd = new Deno.Command(join(binDir, "squadrn"), {
      args: ["--version"],
      stdout: "piped",
    });
    const { stdout } = await cmd.output();
    const version = new TextDecoder().decode(stdout).trim();
    assertEquals(version, "0.1.0");
  });
});

// ── Uninstall tests ────────────────────────────────────────────────────────

Deno.test("uninstall - removes binary", async () => {
  await withTempDir(async (dir) => {
    const installDir = join(dir, ".squadrn");
    const binDir = join(dir, "bin");
    await Deno.mkdir(installDir, { recursive: true });
    await Deno.mkdir(binDir, { recursive: true });
    await createFakeBinary(binDir);

    const { code, output } = await runScript(UNINSTALL_SCRIPT, {
      SQUADRN_INSTALL_DIR: installDir,
      SQUADRN_BIN_DIR: binDir,
    });

    assertEquals(code, 0, `Uninstall failed with output:\n${output}`);
    assertStringIncludes(output, "Removed binary");

    try {
      await Deno.stat(join(binDir, "squadrn"));
      throw new Error("Binary should have been removed");
    } catch (e) {
      assertEquals((e as { code?: string }).code, "ENOENT");
    }
  });
});

Deno.test("uninstall - keeps data directory in non-interactive mode", async () => {
  await withTempDir(async (dir) => {
    const installDir = join(dir, ".squadrn");
    const binDir = join(dir, "bin");
    await Deno.mkdir(installDir, { recursive: true });
    await Deno.mkdir(binDir, { recursive: true });
    await createFakeBinary(binDir);

    await Deno.writeTextFile(join(installDir, "config.toml"), "# test");

    const { code, output } = await runScript(UNINSTALL_SCRIPT, {
      SQUADRN_INSTALL_DIR: installDir,
      SQUADRN_BIN_DIR: binDir,
    });

    assertEquals(code, 0, `Uninstall failed with output:\n${output}`);
    assertStringIncludes(output, "Kept data directory");

    const stat = await Deno.stat(installDir);
    assertEquals(stat.isDirectory, true);
  });
});

Deno.test("uninstall - removes data directory when confirmed", async () => {
  await withTempDir(async (dir) => {
    const installDir = join(dir, ".squadrn");
    const binDir = join(dir, "bin");
    await Deno.mkdir(installDir, { recursive: true });
    await Deno.mkdir(binDir, { recursive: true });
    await createFakeBinary(binDir);

    await Deno.writeTextFile(join(installDir, "config.toml"), "# test");

    const { code, output } = await runScript(UNINSTALL_SCRIPT, {
      SQUADRN_INSTALL_DIR: installDir,
      SQUADRN_BIN_DIR: binDir,
      SQUADRN_REMOVE_DATA: "y",
    });

    assertEquals(code, 0, `Uninstall failed with output:\n${output}`);
    assertStringIncludes(output, "Removed data directory");

    try {
      await Deno.stat(installDir);
      throw new Error("Data directory should have been removed");
    } catch (e) {
      assertEquals((e as { code?: string }).code, "ENOENT");
    }
  });
});

Deno.test("uninstall - declines data removal keeps directory", async () => {
  await withTempDir(async (dir) => {
    const installDir = join(dir, ".squadrn");
    const binDir = join(dir, "bin");
    await Deno.mkdir(installDir, { recursive: true });
    await Deno.mkdir(binDir, { recursive: true });
    await createFakeBinary(binDir);

    await Deno.writeTextFile(join(installDir, "config.toml"), "# test");

    const { code, output } = await runScript(UNINSTALL_SCRIPT, {
      SQUADRN_INSTALL_DIR: installDir,
      SQUADRN_BIN_DIR: binDir,
      SQUADRN_REMOVE_DATA: "n",
    });

    assertEquals(code, 0, `Uninstall failed with output:\n${output}`);
    assertStringIncludes(output, "Kept data directory");

    const stat = await Deno.stat(installDir);
    assertEquals(stat.isDirectory, true);
  });
});

Deno.test("uninstall - handles missing binary gracefully", async () => {
  await withTempDir(async (dir) => {
    const installDir = join(dir, ".squadrn");
    const binDir = join(dir, "bin");
    await Deno.mkdir(installDir, { recursive: true });
    await Deno.mkdir(binDir, { recursive: true });

    const { code, output } = await runScript(UNINSTALL_SCRIPT, {
      SQUADRN_INSTALL_DIR: installDir,
      SQUADRN_BIN_DIR: binDir,
    });

    assertEquals(code, 0, `Uninstall failed with output:\n${output}`);
    assertStringIncludes(output, "already removed");
    assertStringIncludes(output, "uninstalled");
  });
});

Deno.test("uninstall - stops running gateway via PID file", async () => {
  await withTempDir(async (dir) => {
    const installDir = join(dir, ".squadrn");
    const binDir = join(dir, "bin");
    await Deno.mkdir(installDir, { recursive: true });
    await Deno.mkdir(binDir, { recursive: true });
    await createFakeBinary(binDir);

    // Start a dummy process to simulate a running gateway
    const proc = new Deno.Command("sleep", {
      args: ["60"],
      stdout: "null",
      stderr: "null",
    }).spawn();
    const pid = proc.pid;

    await Deno.writeTextFile(join(installDir, "gateway.pid"), String(pid));

    const { code, output } = await runScript(UNINSTALL_SCRIPT, {
      SQUADRN_INSTALL_DIR: installDir,
      SQUADRN_BIN_DIR: binDir,
    });

    assertEquals(code, 0, `Uninstall failed with output:\n${output}`);
    assertStringIncludes(output, "Stopping running gateway");

    // Give it a moment then verify the process is gone
    await new Promise((r) => setTimeout(r, 200));
    try {
      Deno.kill(pid, "SIGCONT");
      proc.kill("SIGKILL");
      throw new Error("Gateway process should have been stopped");
    } catch (e) {
      assertStringIncludes((e as Error).message, "ESRCH");
    }
  });
});

// ── Full lifecycle ─────────────────────────────────────────────────────────

Deno.test("install + uninstall - full lifecycle", async () => {
  await withTempDir(async (dir) => {
    const installDir = join(dir, ".squadrn");
    const binDir = join(dir, "bin");
    const fakeBinDir = join(dir, "fake");
    await Deno.mkdir(binDir, { recursive: true });
    await Deno.mkdir(fakeBinDir, { recursive: true });
    await createFakeBinary(fakeBinDir);

    const patchedScript = await createPatchedInstall(dir, fakeBinDir);

    // 1. Install
    const install = await runScript(patchedScript, {
      SQUADRN_INSTALL_DIR: installDir,
      SQUADRN_BIN_DIR: binDir,
      PATH: `${binDir}:${Deno.env.get("PATH") ?? ""}`,
    });
    assertEquals(install.code, 0, `Install failed:\n${install.output}`);

    const binStat = await Deno.stat(join(binDir, "squadrn"));
    assertEquals(binStat.isFile, true);
    const dirStat = await Deno.stat(installDir);
    assertEquals(dirStat.isDirectory, true);

    // Simulate data
    await Deno.writeTextFile(join(installDir, "config.toml"), "[gateway]\nport = 18900\n");
    await Deno.writeTextFile(join(installDir, "data.db"), "");

    // 2. Uninstall (confirm data deletion via env)
    const uninstall = await runScript(UNINSTALL_SCRIPT, {
      SQUADRN_INSTALL_DIR: installDir,
      SQUADRN_BIN_DIR: binDir,
      SQUADRN_REMOVE_DATA: "y",
    });
    assertEquals(uninstall.code, 0, `Uninstall failed:\n${uninstall.output}`);

    // Everything gone
    try {
      await Deno.stat(join(binDir, "squadrn"));
      throw new Error("Binary should be removed");
    } catch (e) {
      assertEquals((e as { code?: string }).code, "ENOENT");
    }

    try {
      await Deno.stat(installDir);
      throw new Error("Data dir should be removed");
    } catch (e) {
      assertEquals((e as { code?: string }).code, "ENOENT");
    }
  });
});
