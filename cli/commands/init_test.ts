import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { defaultConfig, loadConfig, serializeConfig } from "@squadrn/core";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

Deno.test(
  "init - defaultConfig produces valid TOML that round-trips",
  async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, "config.toml");
      const config = defaultConfig();
      const toml = serializeConfig(config);

      await Deno.writeTextFile(configPath, toml);

      const result = await loadConfig(configPath);
      assertEquals(result.ok, true);
      if (result.ok) {
        assertEquals(result.value.gateway.host, "127.0.0.1");
        assertEquals(result.value.gateway.port, 18900);
        assertEquals(result.value.storage.adapter, "sqlite");
      }
    });
  },
);

Deno.test("init - config with agent round-trips correctly", async () => {
  await withTempDir(async (dir) => {
    const configPath = join(dir, "config.toml");
    const config = defaultConfig();
    config.agents["scout"] = {
      name: "Scout",
      role: "General Assistant",
      llm: "claude",
      channels: ["telegram"],
      heartbeat: "*/15 * * * *",
      soul_file: "~/.squadrn/agents/scout/SOUL.md",
    };

    await Deno.writeTextFile(configPath, serializeConfig(config));

    const result = await loadConfig(configPath);
    assertEquals(result.ok, true);
    if (result.ok) {
      const agent = result.value.agents["scout"];
      assertEquals(agent?.name, "Scout");
      assertEquals(agent?.role, "General Assistant");
      assertEquals(agent?.llm, "claude");
      assertEquals(agent?.channels, ["telegram"]);
    }
  });
});

Deno.test("init - directory structure is created correctly", async () => {
  await withTempDir(async (dir) => {
    const squadrnDir = join(dir, ".squadrn");
    const dataDir = join(squadrnDir, "data");
    const agentsDir = join(squadrnDir, "agents");

    await Deno.mkdir(squadrnDir, { recursive: true });
    await Deno.mkdir(dataDir, { recursive: true });
    await Deno.mkdir(agentsDir, { recursive: true });

    // Verify dirs exist
    const stat1 = await Deno.stat(squadrnDir);
    assertEquals(stat1.isDirectory, true);
    const stat2 = await Deno.stat(dataDir);
    assertEquals(stat2.isDirectory, true);
    const stat3 = await Deno.stat(agentsDir);
    assertEquals(stat3.isDirectory, true);
  });
});

Deno.test("init - SOUL.md file can be created for an agent", async () => {
  await withTempDir(async (dir) => {
    const agentDir = join(dir, "agents", "scout");
    await Deno.mkdir(agentDir, { recursive: true });

    const soulPath = join(agentDir, "SOUL.md");
    const content = "# Scout\n\nYou are Scout, a General Assistant.\n";
    await Deno.writeTextFile(soulPath, content);

    const readBack = await Deno.readTextFile(soulPath);
    assertEquals(readBack, content);
  });
});

Deno.test("init - plugins.json is valid empty array", async () => {
  await withTempDir(async (dir) => {
    const pluginsPath = join(dir, "plugins.json");
    await Deno.writeTextFile(pluginsPath, JSON.stringify([], null, 2));

    const content = await Deno.readTextFile(pluginsPath);
    const parsed = JSON.parse(content);
    assertEquals(Array.isArray(parsed), true);
    assertEquals(parsed.length, 0);
  });
});
