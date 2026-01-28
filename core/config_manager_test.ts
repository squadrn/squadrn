import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  ConfigManager,
  createDefaultConfig,
  defaultConfig,
  loadConfig,
  serializeConfig,
} from "./config_manager.ts";

const VALID_TOML = `
[gateway]
host = "0.0.0.0"
port = 9000
log_level = "debug"

[storage]
adapter = "sqlite"
path = "/tmp/test.db"

[agents.jarvis]
name = "Jarvis"
role = "Lead"
llm = "claude"
channels = ["telegram"]
heartbeat = "*/15 * * * *"
soul_file = "~/.squadrn/agents/jarvis/SOUL.md"
`;

async function withTempFile(
  content: string,
  fn: (path: string) => Promise<void>,
): Promise<void> {
  const path = await Deno.makeTempFile({ suffix: ".toml" });
  try {
    await Deno.writeTextFile(path, content);
    await fn(path);
  } finally {
    await Deno.remove(path).catch(() => {});
  }
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

// --- defaultConfig ---

Deno.test("defaultConfig returns expected defaults", () => {
  const cfg = defaultConfig();
  assertEquals(cfg.gateway.host, "127.0.0.1");
  assertEquals(cfg.gateway.port, 18900);
  assertEquals(cfg.gateway.log_level, "info");
  assertEquals(cfg.storage.adapter, "sqlite");
  assertEquals(Object.keys(cfg.agents).length, 0);
});

Deno.test("defaultConfig returns a fresh clone each time", () => {
  const a = defaultConfig();
  const b = defaultConfig();
  a.gateway.port = 1;
  assertEquals(b.gateway.port, 18900);
});

// --- loadConfig ---

Deno.test("loadConfig - missing file returns defaults", async () => {
  const result = await loadConfig("/tmp/__nonexistent__config__.toml");
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.gateway.port, 18900);
  }
});

Deno.test("loadConfig - valid TOML is parsed and merged", async () => {
  await withTempFile(VALID_TOML, async (path) => {
    const result = await loadConfig(path);
    assertEquals(result.ok, true);
    if (!result.ok) return;
    assertEquals(result.value.gateway.host, "0.0.0.0");
    assertEquals(result.value.gateway.port, 9000);
    assertEquals(result.value.gateway.log_level, "debug");
    assertEquals(result.value.agents["jarvis"]?.name, "Jarvis");
  });
});

Deno.test("loadConfig - partial config merges with defaults", async () => {
  await withTempFile("[gateway]\nport = 5000\n", async (path) => {
    const result = await loadConfig(path);
    assertEquals(result.ok, true);
    if (!result.ok) return;
    assertEquals(result.value.gateway.port, 5000);
    assertEquals(result.value.gateway.host, "127.0.0.1"); // default
    assertEquals(result.value.storage.adapter, "sqlite"); // default
  });
});

Deno.test("loadConfig - invalid TOML returns error", async () => {
  await withTempFile("{{bad toml", async (path) => {
    const result = await loadConfig(path);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertStringIncludes(result.error.message, "Invalid TOML");
    }
  });
});

Deno.test("loadConfig - invalid port returns validation error", async () => {
  await withTempFile("[gateway]\nport = 99999\n", async (path) => {
    const result = await loadConfig(path);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertStringIncludes(result.error.message, "gateway.port");
    }
  });
});

Deno.test("loadConfig - invalid log_level returns validation error", async () => {
  await withTempFile('[gateway]\nlog_level = "verbose"\n', async (path) => {
    const result = await loadConfig(path);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertStringIncludes(result.error.message, "gateway.log_level");
    }
  });
});

Deno.test("loadConfig - agent missing required fields returns errors", async () => {
  await withTempFile('[agents.bad]\nname = "Bad"\n', async (path) => {
    const result = await loadConfig(path);
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertStringIncludes(result.error.message, "agents.bad.role");
      assertStringIncludes(result.error.message, "agents.bad.llm");
    }
  });
});

// --- serializeConfig ---

Deno.test("serializeConfig roundtrips with loadConfig", async () => {
  const cfg = defaultConfig();
  const toml = serializeConfig(cfg);
  await withTempFile(toml, async (path) => {
    const result = await loadConfig(path);
    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.value, cfg);
    }
  });
});

// --- createDefaultConfig ---

Deno.test("createDefaultConfig creates file with defaults", async () => {
  await withTempDir(async (dir) => {
    const path = `${dir}/sub/config.toml`;
    await createDefaultConfig(path);
    const result = await loadConfig(path);
    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.value.gateway.port, 18900);
    }
  });
});

Deno.test("createDefaultConfig does not overwrite existing file", async () => {
  await withTempFile("[gateway]\nport = 5000\n", async (path) => {
    await createDefaultConfig(path);
    const result = await loadConfig(path);
    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.value.gateway.port, 5000);
    }
  });
});

// --- ConfigManager ---

Deno.test("ConfigManager.load - loads config from file", async () => {
  await withTempFile(VALID_TOML, async (path) => {
    const result = await ConfigManager.load(path);
    assertEquals(result.ok, true);
    if (!result.ok) return;
    assertEquals(result.value.config.gateway.port, 9000);
    assertEquals(result.value.path, path);
  });
});

Deno.test("ConfigManager.fromDefaults - uses defaults", () => {
  const mgr = ConfigManager.fromDefaults("/fake/path");
  assertEquals(mgr.config.gateway.port, 18900);
});

Deno.test("ConfigManager.reload - picks up file changes", async () => {
  await withTempFile("[gateway]\nport = 5000\n", async (path) => {
    const result = await ConfigManager.load(path);
    assertEquals(result.ok, true);
    if (!result.ok) return;
    const mgr = result.value;
    assertEquals(mgr.config.gateway.port, 5000);

    // Change the file
    await Deno.writeTextFile(path, "[gateway]\nport = 6000\n");
    const reloadResult = await mgr.reload();
    assertEquals(reloadResult.ok, true);
    assertEquals(mgr.config.gateway.port, 6000);
  });
});

Deno.test("ConfigManager.reload - keeps old config on error", async () => {
  await withTempFile("[gateway]\nport = 5000\n", async (path) => {
    const result = await ConfigManager.load(path);
    assertEquals(result.ok, true);
    if (!result.ok) return;
    const mgr = result.value;

    // Write invalid TOML
    await Deno.writeTextFile(path, "{{broken");
    const reloadResult = await mgr.reload();
    assertEquals(reloadResult.ok, false);
    // Old config preserved
    assertEquals(mgr.config.gateway.port, 5000);
  });
});
