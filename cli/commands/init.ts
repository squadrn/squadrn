import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { Confirm, Input, Select } from "@cliffy/prompt";
import { defaultConfig, serializeConfig } from "@squadrn/core";
import { AGENTS_DIR, CONFIG_PATH, DATA_DIR, PLUGINS_PATH, SQUADRN_DIR } from "../utils/paths.ts";
import * as out from "../utils/output.ts";

export async function initCommand(): Promise<void> {
  out.header("Squadrn - Setup Wizard");

  // Check if already initialized
  try {
    await Deno.stat(CONFIG_PATH);
    out.warn(`Config already exists at ${CONFIG_PATH}`);
    const overwrite = await Confirm.prompt({
      message: "Reinitialize? This will overwrite your config.",
      default: false,
    });
    if (!overwrite) {
      out.info("Aborted");
      return;
    }
  } catch {
    // File doesn't exist — continue with setup
  }

  // Interactive prompts
  const llm = await Select.prompt({
    message: "Preferred LLM provider",
    options: [
      { name: "Claude (Anthropic)", value: "claude" },
      { name: "OpenAI (GPT)", value: "openai" },
      { name: "Ollama (local)", value: "ollama" },
      { name: "None (configure later)", value: "none" },
    ],
  });

  const channel = await Select.prompt({
    message: "Preferred channel",
    options: [
      { name: "Telegram", value: "telegram" },
      { name: "Slack", value: "slack" },
      { name: "None (internal only)", value: "none" },
    ],
  });

  const createAgent = await Confirm.prompt({
    message: "Create a starter agent?",
    default: true,
  });

  let agentName = "";
  let agentRole = "";
  if (createAgent) {
    agentName = await Input.prompt({
      message: "Agent name",
      default: "jarvis",
    });
    agentRole = await Input.prompt({
      message: "Agent role",
      default: "General Assistant",
    });
  }

  // Create directory structure
  console.log();
  out.info("Creating directory structure...");
  await ensureDir(SQUADRN_DIR);
  await ensureDir(DATA_DIR);
  await ensureDir(AGENTS_DIR);

  // Build config
  const config = defaultConfig();

  if (createAgent && agentName) {
    const agentDir = join(AGENTS_DIR, agentName);
    await ensureDir(agentDir);

    const soulPath = join(agentDir, "SOUL.md");
    const soulContent = `# ${agentName}\n\nYou are ${agentName}, a ${agentRole}.\n`;
    await Deno.writeTextFile(soulPath, soulContent);

    config.agents[agentName] = {
      name: agentName,
      role: agentRole,
      llm: llm === "none" ? "claude" : llm,
      channels: channel === "none" ? [] : [channel],
      heartbeat: "*/15 * * * *",
      soul_file: soulPath,
    };

    out.success(`Created agent "${agentName}" at ${agentDir}`);
  }

  // Write config
  await Deno.writeTextFile(CONFIG_PATH, serializeConfig(config));

  // Write empty plugins file
  await Deno.writeTextFile(PLUGINS_PATH, JSON.stringify([], null, 2));

  out.success(`Created config at ${CONFIG_PATH}`);
  out.success(`Created data directory at ${DATA_DIR}`);

  // Next steps
  console.log();
  out.header("Next Steps");

  if (llm !== "none") {
    out.info(`1. Install the LLM plugin: squadrn plugin add @squadrn/llm-${llm}`);
  }
  if (channel !== "none") {
    out.info(
      `${
        llm !== "none" ? "2" : "1"
      }. Install the channel plugin: squadrn plugin add @squadrn/channel-${channel}`,
    );
  }
  out.info(
    `${
      llm !== "none" && channel !== "none" ? "3" : llm !== "none" || channel !== "none" ? "2" : "1"
    }. Edit config: ${CONFIG_PATH}`,
  );
  out.info("Then run: squadrn start");
}
