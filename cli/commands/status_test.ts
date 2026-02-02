import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "jsr:@std/path";
import { defaultConfig, Gateway, GatewayClient, serializeConfig } from "@squadrn/core";
import type { GatewayStatus } from "@squadrn/core";

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

  const config = defaultConfig();
  config.storage.path = dbPath;
  await Deno.writeTextFile(configPath, serializeConfig(config));

  return { configPath, socketPath, dbPath };
}

Deno.test({
  name: "status - returns full status from running gateway",
  ...SANITIZE,
  fn: async () => {
    await withTempDir(async (dir) => {
      const { configPath, socketPath } = await setupEnv(dir);

      const gw = new Gateway({ gracePeriodMs: 100 });
      await gw.start(configPath, socketPath);
      await new Promise((r) => setTimeout(r, 50));

      const client = new GatewayClient(socketPath);
      const resp = await client.status();

      assertEquals(resp.ok, true);
      const data = resp.data as unknown as GatewayStatus;

      assertEquals(data.running, true);
      assertEquals(data.pid, Deno.pid);
      assertEquals(typeof data.uptime, "number");
      assertEquals(data.uptime >= 0, true);
      assertEquals(Array.isArray(data.plugins), true);

      // Memory info
      assertEquals(typeof data.memory.rss, "number");
      assertEquals(data.memory.rss > 0, true);
      assertEquals(typeof data.memory.heapUsed, "number");
      assertEquals(typeof data.memory.heapTotal, "number");

      // Config
      assertEquals(data.config !== null, true);

      await gw.stop();
    });
  },
});

Deno.test("status - returns error when gateway not running", async () => {
  const client = new GatewayClient("/tmp/nonexistent-squadrn-status-test.sock");
  const resp = await client.status();
  assertEquals(resp.ok, false);
  assertStringIncludes(resp.error ?? "", "Cannot connect");
});
