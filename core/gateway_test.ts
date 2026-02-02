import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { Gateway } from "./gateway.ts";
import { GatewayClient } from "./gateway_client.ts";
import { defaultConfig, serializeConfig } from "./config_manager.ts";
import { needsSocketCleanup } from "./ipc.ts";

const SANITIZE = { sanitizeOps: false, sanitizeResources: false };

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

async function setupGateway(dir: string) {
  const dbPath = join(dir, "data.db");
  const socketPath = join(dir, "gateway.sock");
  const configPath = join(dir, "config.toml");

  const config = defaultConfig();
  config.storage.path = dbPath;

  await Deno.writeTextFile(configPath, serializeConfig(config));
  return { configPath, socketPath, dbPath };
}

Deno.test({
  name: "Gateway - start and stop lifecycle",
  ...SANITIZE,
  fn: async () => {
    await withTempDir(async (dir) => {
      const { configPath, socketPath } = await setupGateway(dir);
      const gw = new Gateway({ gracePeriodMs: 100 });

      const events: string[] = [];
      gw.events.on("gateway:started", () => {
        events.push("started");
      });
      gw.events.on("gateway:stopping", () => {
        events.push("stopping");
      });

      assertEquals(gw.isRunning, false);

      await gw.start(configPath, socketPath);
      assertEquals(gw.isRunning, true);
      assertEquals(events, ["started"]);

      await gw.stop();
      assertEquals(gw.isRunning, false);
      assertEquals(events, ["started", "stopping"]);
    });
  },
});

Deno.test({
  name: "Gateway - double start throws",
  ...SANITIZE,
  fn: async () => {
    await withTempDir(async (dir) => {
      const { configPath, socketPath } = await setupGateway(dir);
      const gw = new Gateway({ gracePeriodMs: 100 });

      await gw.start(configPath, socketPath);

      await assertRejects(
        () => gw.start(configPath, socketPath),
        Error,
        "already running",
      );

      await gw.stop();
    });
  },
});

Deno.test("Gateway - stop when not running is a no-op", async () => {
  const gw = new Gateway();
  await gw.stop();
  assertEquals(gw.isRunning, false);
});

Deno.test({
  name: "Gateway - status returns snapshot",
  ...SANITIZE,
  fn: async () => {
    await withTempDir(async (dir) => {
      const { configPath, socketPath } = await setupGateway(dir);
      const gw = new Gateway({ gracePeriodMs: 100 });

      await gw.start(configPath, socketPath);

      const status = gw.status();
      assertEquals(status.running, true);
      assertEquals(status.pid, Deno.pid);
      assertEquals(typeof status.uptime, "number");
      assertEquals(Array.isArray(status.plugins), true);

      await gw.stop();
    });
  },
});

Deno.test({
  name: "Gateway - handleCommand status",
  ...SANITIZE,
  fn: async () => {
    await withTempDir(async (dir) => {
      const { configPath, socketPath } = await setupGateway(dir);
      const gw = new Gateway({ gracePeriodMs: 100 });

      await gw.start(configPath, socketPath);

      const resp = await gw.handleCommand({ action: "status" });
      assertEquals(resp.ok, true);
      assertEquals((resp.data as Record<string, unknown>)["running"], true);

      await gw.stop();
    });
  },
});

Deno.test("Gateway - handleCommand unknown action", async () => {
  const gw = new Gateway();
  const resp = await gw.handleCommand({ action: "bogus" as "status" });
  assertEquals(resp.ok, false);
  assertEquals(typeof resp.error, "string");
});

Deno.test({
  name: "Gateway - graceful shutdown waits for handlers",
  ...SANITIZE,
  fn: async () => {
    await withTempDir(async (dir) => {
      const { configPath, socketPath } = await setupGateway(dir);
      const gw = new Gateway({ gracePeriodMs: 2000 });

      let handlerFinished = false;
      gw.events.on("gateway:stopping", async () => {
        await new Promise((r) => setTimeout(r, 50));
        handlerFinished = true;
      });

      await gw.start(configPath, socketPath);
      await gw.stop();

      assertEquals(handlerFinished, true);
    });
  },
});

Deno.test({
  name: "Gateway - grace period caps slow handlers",
  ...SANITIZE,
  fn: async () => {
    await withTempDir(async (dir) => {
      const { configPath, socketPath } = await setupGateway(dir);
      const gw = new Gateway({ gracePeriodMs: 50 });

      let handlerFinished = false;
      gw.events.on("gateway:stopping", async () => {
        await new Promise((r) => setTimeout(r, 5000));
        handlerFinished = true;
      });

      await gw.start(configPath, socketPath);
      const start = performance.now();
      await gw.stop();
      const elapsed = performance.now() - start;

      assertEquals(handlerFinished, false);
      assertEquals(elapsed < 1000, true);
    });
  },
});

Deno.test({
  name: "Gateway - socket accepts status command via client",
  ...SANITIZE,
  fn: async () => {
    await withTempDir(async (dir) => {
      const { configPath, socketPath } = await setupGateway(dir);
      const gw = new Gateway({ gracePeriodMs: 100 });

      await gw.start(configPath, socketPath);
      await new Promise((r) => setTimeout(r, 50));

      const client = new GatewayClient(socketPath);
      const resp = await client.status();
      assertEquals(resp.ok, true);
      assertEquals((resp.data as Record<string, unknown>)["running"], true);

      await gw.stop();
    });
  },
});

Deno.test({
  name: "Gateway - socket accepts stop command via client",
  ...SANITIZE,
  fn: async () => {
    await withTempDir(async (dir) => {
      const { configPath, socketPath } = await setupGateway(dir);
      const gw = new Gateway({ gracePeriodMs: 100 });

      await gw.start(configPath, socketPath);
      await new Promise((r) => setTimeout(r, 50));

      const client = new GatewayClient(socketPath);
      const resp = await client.stop();
      assertEquals(resp.ok, true);

      // Wait for async stop
      await new Promise((r) => setTimeout(r, 300));
      assertEquals(gw.isRunning, false);
    });
  },
});

Deno.test(
  "GatewayClient - connection to non-existent socket returns error",
  async () => {
    const client = new GatewayClient("/tmp/nonexistent-squadrn-test.sock");
    const resp = await client.status();
    assertEquals(resp.ok, false);
    assertEquals(typeof resp.error, "string");
  },
);

Deno.test({
  name: "Gateway - socket cleans up on stop",
  ...SANITIZE,
  fn: async () => {
    await withTempDir(async (dir) => {
      const { configPath, socketPath } = await setupGateway(dir);
      const gw = new Gateway({ gracePeriodMs: 100 });

      await gw.start(configPath, socketPath);

      if (needsSocketCleanup()) {
        const stat = await Deno.stat(socketPath).catch(() => null);
        assertEquals(stat !== null, true);
      }

      await gw.stop();

      if (needsSocketCleanup()) {
        const statAfter = await Deno.stat(socketPath).catch(() => null);
        assertEquals(statAfter, null);
      }
    });
  },
});
