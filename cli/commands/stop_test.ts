import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { defaultConfig, Gateway, GatewayClient, serializeConfig } from "@squadrn/core";

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

Deno.test({
  name: "stop - graceful stop via socket shuts down gateway",
  ...SANITIZE,
  fn: async () => {
    await withTempDir(async (dir) => {
      const { configPath, socketPath, pidPath } = await setupEnv(dir);

      const gw = new Gateway({ gracePeriodMs: 100 });
      await gw.start(configPath, socketPath);
      await Deno.writeTextFile(pidPath, String(Deno.pid));
      await new Promise((r) => setTimeout(r, 50));

      const client = new GatewayClient(socketPath);
      const resp = await client.stop();
      assertEquals(resp.ok, true);

      // Wait for async stop
      await new Promise((r) => setTimeout(r, 300));
      assertEquals(gw.isRunning, false);

      await Deno.remove(pidPath).catch(() => {});
    });
  },
});

Deno.test("stop - returns error when no gateway is running", async () => {
  const client = new GatewayClient("/tmp/nonexistent-squadrn-stop-test.sock");
  const resp = await client.stop();
  assertEquals(resp.ok, false);
});

Deno.test({
  name: "stop - cleans up socket and PID files",
  ...SANITIZE,
  fn: async () => {
    await withTempDir(async (dir) => {
      const { configPath, socketPath, pidPath } = await setupEnv(dir);

      const gw = new Gateway({ gracePeriodMs: 100 });
      await gw.start(configPath, socketPath);
      await Deno.writeTextFile(pidPath, String(Deno.pid));
      await new Promise((r) => setTimeout(r, 50));

      // Verify files exist
      const sockStat = await Deno.stat(socketPath).catch(() => null);
      assertEquals(sockStat !== null, true);
      const pidStat = await Deno.stat(pidPath).catch(() => null);
      assertEquals(pidStat !== null, true);

      // Stop gateway
      await gw.stop();

      // Socket should be cleaned by gateway
      const sockAfter = await Deno.stat(socketPath).catch(() => null);
      assertEquals(sockAfter, null);

      // PID file still exists (CLI is responsible for cleanup)
      // So we clean it here
      await Deno.remove(pidPath).catch(() => {});
    });
  },
});
