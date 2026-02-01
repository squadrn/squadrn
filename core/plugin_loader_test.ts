import { assertEquals, assertRejects } from "jsr:@std/assert@^1";
import type {
  ChannelProvider,
  IncomingMessage,
  LLMProvider,
  OutgoingMessage,
  Plugin,
  PluginAPI,
  PluginManifest,
} from "@squadrn/types";
import { EventBus } from "./event_bus.ts";
import { SqliteStorage } from "./storage/sqlite.ts";
import { InstalledPlugin, PluginLoader } from "./plugin_loader.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    name: "@test/mock-plugin",
    version: "1.0.0",
    description: "A mock plugin for testing",
    author: "Test",
    repository: "https://github.com/test/mock-plugin",
    type: "custom",
    permissions: {},
    minCoreVersion: "0.1.0",
    ...overrides,
  };
}

function makeMockPlugin(
  manifest: PluginManifest,
  registerFn?: (api: PluginAPI) => Promise<void>,
  unregisterFn?: () => Promise<void>,
): Plugin {
  return {
    manifest,
    register: registerFn ?? (async () => {}),
    unregister: unregisterFn,
  };
}

function makeLoader(pluginConfig: Record<string, Record<string, unknown>> = {}) {
  const events = new EventBus();
  const storage = new SqliteStorage(":memory:");
  const loader = new PluginLoader(events, storage, pluginConfig);
  return { events, storage, loader };
}

function tmpPluginsJson(): string {
  return Deno.makeTempFileSync({ suffix: ".json" });
}

// ── Tests ───────────────────────────────────────────────────────────────────

Deno.test("PluginLoader - loadOne registers a custom plugin", async () => {
  const { loader } = makeLoader();
  const manifest = makeManifest();
  const plugin = makeMockPlugin(manifest);
  const entry: InstalledPlugin = {
    url: "https://github.com/test/mock-plugin",
    manifest,
    installedAt: new Date().toISOString(),
  };

  await loader.loadOne(manifest.name, entry, plugin);

  assertEquals(loader.listLoaded(), [manifest.name]);
});

Deno.test("PluginLoader - loadOne registers a channel plugin", async () => {
  const { loader } = makeLoader();
  const manifest = makeManifest({ name: "@test/channel-test", type: "channel" });

  const mockChannel: ChannelProvider = {
    name: "test-channel",
    connect: async () => {},
    disconnect: async () => {},
    onMessage: (_handler: (msg: IncomingMessage) => void) => {},
    sendMessage: async (_msg: OutgoingMessage) => {},
  };

  const plugin = makeMockPlugin(manifest, async (api) => {
    api.registerChannel!(mockChannel);
  });

  const entry: InstalledPlugin = {
    url: "https://github.com/test/channel-test",
    manifest,
    installedAt: new Date().toISOString(),
  };

  await loader.loadOne(manifest.name, entry, plugin);

  assertEquals(loader.listChannels(), ["test-channel"]);
  assertEquals(loader.getChannel("test-channel"), mockChannel);
});

Deno.test("PluginLoader - loadOne registers an LLM plugin", async () => {
  const { loader } = makeLoader();
  const manifest = makeManifest({ name: "@test/llm-test", type: "llm" });

  const mockLLM: LLMProvider = {
    name: "test-llm",
    supportsTools: false,
    complete: async () => ({
      content: "hello",
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: "end" as const,
    }),
  };

  const plugin = makeMockPlugin(manifest, async (api) => {
    api.registerLLM!(mockLLM);
  });

  const entry: InstalledPlugin = {
    url: "https://github.com/test/llm-test",
    manifest,
    installedAt: new Date().toISOString(),
  };

  await loader.loadOne(manifest.name, entry, plugin);

  assertEquals(loader.listLLMs(), ["test-llm"]);
  assertEquals(loader.getLLM("test-llm"), mockLLM);
});

Deno.test("PluginLoader - plugin receives namespaced storage", async () => {
  const { loader, storage } = makeLoader();
  const manifest = makeManifest({ name: "@test/storage-test" });

  let storedApi: PluginAPI | null = null;
  const plugin = makeMockPlugin(manifest, async (api) => {
    storedApi = api;
  });

  const entry: InstalledPlugin = {
    url: "https://github.com/test/storage-test",
    manifest,
    installedAt: new Date().toISOString(),
  };

  await loader.loadOne(manifest.name, entry, plugin);

  // Write through plugin API
  await storedApi!.storage.set("mykey", { data: 42 });

  // Read from underlying storage — should be prefixed
  const raw = await storage.get<{ data: number }>("plugin:@test/storage-test:mykey");
  assertEquals(raw, { data: 42 });

  // Read through plugin API
  const fromApi = await storedApi!.storage.get<{ data: number }>("mykey");
  assertEquals(fromApi, { data: 42 });

  // Delete through plugin API
  const deleted = await storedApi!.storage.delete("mykey");
  assertEquals(deleted, true);

  const afterDelete = await storage.get("plugin:@test/storage-test:mykey");
  assertEquals(afterDelete, null);
});

Deno.test("PluginLoader - plugin receives its config section", async () => {
  const { loader } = makeLoader({
    "@test/config-test": { apiKey: "secret123", retries: 3 },
  });
  const manifest = makeManifest({ name: "@test/config-test" });

  let receivedConfig: Record<string, unknown> = {};
  const plugin = makeMockPlugin(manifest, async (api) => {
    receivedConfig = api.config;
  });

  const entry: InstalledPlugin = {
    url: "https://github.com/test/config-test",
    manifest,
    installedAt: new Date().toISOString(),
  };

  await loader.loadOne(manifest.name, entry, plugin);

  assertEquals(receivedConfig, { apiKey: "secret123", retries: 3 });
});

Deno.test("PluginLoader - plugin can subscribe to events", async () => {
  const { loader, events } = makeLoader();
  const manifest = makeManifest({ name: "@test/events-test" });

  const received: unknown[] = [];
  const plugin = makeMockPlugin(manifest, async (api) => {
    api.events.on("message:received", (payload) => {
      received.push(payload);
    });
  });

  const entry: InstalledPlugin = {
    url: "https://github.com/test/events-test",
    manifest,
    installedAt: new Date().toISOString(),
  };

  await loader.loadOne(manifest.name, entry, plugin);
  await events.emit("message:received", { text: "hello" });

  assertEquals(received, [{ text: "hello" }]);
});

Deno.test("PluginLoader - loadOne rejects invalid plugin (no register)", async () => {
  const { loader } = makeLoader();
  const manifest = makeManifest();

  const badPlugin = { manifest } as unknown as Plugin; // missing register

  const entry: InstalledPlugin = {
    url: "https://github.com/test/bad-plugin",
    manifest,
    installedAt: new Date().toISOString(),
  };

  await assertRejects(
    () => loader.loadOne(manifest.name, entry, badPlugin),
    Error,
    "does not export a valid Plugin",
  );
});

Deno.test("PluginLoader - loadAll emits plugin:loaded events", async () => {
  const { loader, events } = makeLoader();
  const pluginsPath = tmpPluginsJson();

  const manifest = makeManifest({ name: "@test/loadall-test" });

  // Write plugins.json manually
  const installed: Record<string, InstalledPlugin> = {
    [manifest.name]: {
      url: "https://github.com/test/loadall-test",
      manifest,
      installedAt: new Date().toISOString(),
    },
  };
  await Deno.writeTextFile(pluginsPath, JSON.stringify(installed));

  const loaded: string[] = [];
  events.on("plugin:loaded", (payload) => {
    const p = payload as { name: string };
    loaded.push(p.name);
  });

  const errors: string[] = [];
  events.on("plugin:error", (payload) => {
    const p = payload as { name: string };
    errors.push(p.name);
  });

  // loadAll will try dynamic import which will fail (no real module),
  // so we expect plugin:error
  await loader.loadAll(pluginsPath);

  assertEquals(errors, ["@test/loadall-test"]);

  try {
    await Deno.remove(pluginsPath);
  } catch { /* cleanup */ }
});

Deno.test("PluginLoader - uninstall removes plugin", async () => {
  const { loader } = makeLoader();
  const pluginsPath = tmpPluginsJson();
  const manifest = makeManifest({ name: "@test/uninstall-test" });

  let unregistered = false;
  const plugin = makeMockPlugin(
    manifest,
    async () => {},
    async () => {
      unregistered = true;
    },
  );

  // Write plugins.json
  const installed: Record<string, InstalledPlugin> = {
    [manifest.name]: {
      url: "https://github.com/test/uninstall-test",
      manifest,
      installedAt: new Date().toISOString(),
    },
  };
  await Deno.writeTextFile(pluginsPath, JSON.stringify(installed));

  // Load plugin first
  await loader.loadOne(manifest.name, installed[manifest.name]!, plugin);
  assertEquals(loader.listLoaded(), [manifest.name]);

  // Uninstall
  await loader.uninstall(manifest.name, pluginsPath);

  assertEquals(unregistered, true);
  assertEquals(loader.listLoaded(), []);

  // plugins.json should be empty
  const remaining = JSON.parse(await Deno.readTextFile(pluginsPath));
  assertEquals(remaining, {});

  try {
    await Deno.remove(pluginsPath);
  } catch { /* cleanup */ }
});

Deno.test("PluginLoader - channel plugin type does NOT get registerLLM hook", async () => {
  const { loader } = makeLoader();
  const manifest = makeManifest({ name: "@test/hook-test", type: "channel" });

  let hasRegisterLLM = false;
  let hasRegisterChannel = false;
  const plugin = makeMockPlugin(manifest, async (api) => {
    hasRegisterLLM = typeof api.registerLLM === "function";
    hasRegisterChannel = typeof api.registerChannel === "function";
  });

  const entry: InstalledPlugin = {
    url: "https://github.com/test/hook-test",
    manifest,
    installedAt: new Date().toISOString(),
  };

  await loader.loadOne(manifest.name, entry, plugin);

  assertEquals(hasRegisterChannel, true);
  assertEquals(hasRegisterLLM, false);
});
