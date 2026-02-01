import { assertEquals } from "jsr:@std/assert";
import { join } from "jsr:@std/path";
import { Gateway, GatewayClient, serializeConfig, defaultConfig } from "@squadrn/core";

const SANITIZE = { sanitizeOps: false, sanitizeResources: false };

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

async function setupEnv(dir: string) {
  const dbPath = join(dir, "data.db");
  const socketPath = join(dir, "gateway.sock");
  const configPath = join(dir, "config.toml");
  const pidPath = join(dir, "gateway.pid");

  const config = defaultConfig();
  config.storage.path = dbPath;
  await Deno.writeTextFile(configPath, serializeConfig(config));

  return { configPath, socketPath, pidPath, dbPath };
}

Deno.test({ name: "start - daemon spawned via Deno.Command is reachable via socket", ...SANITIZE, fn: async () => {
  await withTempDir(async (dir) => {
    const { configPath, socketPath, pidPath } = await setupEnv(dir);

    // Spawn daemon directly (simulating what startCommand does)
    const daemonPath = new URL("../daemon.ts", import.meta.url).pathname;
    const cmd = new Deno.Command("deno", {
      args: ["run", "--allow-all", daemonPath, configPath, socketPath, pidPath],
      stdin: "null",
      stdout: "null",
      stderr: "null",
    });
    const child = cmd.spawn();
    child.unref();

    // Wait for socket
    const deadline = Date.now() + 5000;
    let ready = false;
    while (Date.now() < deadline) {
      const client = new GatewayClient(socketPath);
      const resp = await client.status();
      if (resp.ok) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    assertEquals(ready, true);

    // PID file should exist
    const pidText = await Deno.readTextFile(pidPath);
    const pid = parseInt(pidText.trim(), 10);
    assertEquals(pid > 0, true);

    // Stop via socket
    const client = new GatewayClient(socketPath);
    await client.stop();
    await new Promise((r) => setTimeout(r, 500));

    // Process should be gone
    let alive = true;
    try {
      Deno.kill(pid, "SIGCONT");
    } catch {
      alive = false;
    }
    // If still alive, force kill
    if (alive) {
      try { Deno.kill(pid, "SIGKILL"); } catch { /* */ }
    }
  });
}});

Deno.test({ name: "start - detects already running daemon via PID + ping", ...SANITIZE, fn: async () => {
  await withTempDir(async (dir) => {
    const { configPath, socketPath, pidPath } = await setupEnv(dir);

    const gw = new Gateway({ gracePeriodMs: 100 });
    await gw.start(configPath, socketPath);
    await Deno.writeTextFile(pidPath, String(Deno.pid));

    // Simulate check: PID file exists, process alive, socket responds
    const pidText = await Deno.readTextFile(pidPath);
    const pid = parseInt(pidText.trim(), 10);

    let processAlive = false;
    try {
      Deno.kill(pid, "SIGCONT");
      processAlive = true;
    } catch { /* */ }

    assertEquals(processAlive, true);

    await new Promise((r) => setTimeout(r, 50));
    const client = new GatewayClient(socketPath);
    const resp = await client.status();
    assertEquals(resp.ok, true);

    await gw.stop();
    await Deno.remove(pidPath).catch(() => {});
  });
}});

Deno.test("start - stale PID file is detected when process is dead", async () => {
  await withTempDir(async (dir) => {
    const pidPath = join(dir, "gateway.pid");
    // Write a PID that definitely doesn't exist
    await Deno.writeTextFile(pidPath, "999999999");

    let processAlive = false;
    try {
      Deno.kill(999999999, "SIGCONT");
      processAlive = true;
    } catch { /* */ }

    assertEquals(processAlive, false);

    // Clean up
    await Deno.remove(pidPath).catch(() => {});
  });
});
