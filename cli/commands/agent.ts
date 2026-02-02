import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { Checkbox, Input, Select } from "@cliffy/prompt";
import { bold, cyan, dim, gray, green, red, yellow } from "@std/fmt/colors";
import { GatewayClient, readPluginsJson } from "@squadrn/core";
import type { InstalledPlugin } from "@squadrn/core";
import type { AgentConfig } from "@squadrn/types";
import { AGENTS_DIR, CONFIG_PATH, PLUGINS_PATH, SOCKET_PATH } from "../utils/paths.ts";
import * as out from "../utils/output.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

function pad(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

async function loadPluginsByType(type: string): Promise<string[]> {
  const plugins = await readPluginsJson(PLUGINS_PATH);
  return Object.entries(plugins)
    .filter(([, p]) => (p as InstalledPlugin).manifest.type === type)
    .map(([name]) => name);
}

async function loadAgentsConfig(): Promise<Record<string, AgentConfig>> {
  const { loadConfig } = await import("@squadrn/core");
  const result = await loadConfig(CONFIG_PATH);
  if (!result.ok) return {};
  return result.value.agents;
}

async function saveAgentToConfig(name: string, agent: AgentConfig): Promise<void> {
  const { loadConfig, serializeConfig } = await import("@squadrn/core");
  const result = await loadConfig(CONFIG_PATH);
  if (!result.ok) {
    out.error("Cannot read config. Run 'squadrn init' first.");
    return;
  }
  const config = result.value;
  config.agents[name] = agent;
  await Deno.writeTextFile(CONFIG_PATH, serializeConfig(config));
}

async function removeAgentFromConfig(name: string): Promise<boolean> {
  const { loadConfig, serializeConfig } = await import("@squadrn/core");
  const result = await loadConfig(CONFIG_PATH);
  if (!result.ok) return false;
  if (!result.value.agents[name]) return false;
  delete result.value.agents[name];
  await Deno.writeTextFile(CONFIG_PATH, serializeConfig(result.value));
  return true;
}

// ── Soul templates ──────────────────────────────────────────────────────────

function soulTemplate(name: string, role: string): string {
  return `# ${name}

## Identity
You are **${name}**, a ${role} in the Squadrn team.

## Responsibilities
- Fulfill your role as ${role}
- Collaborate with other agents when needed
- Report progress on assigned tasks
- Ask for clarification when instructions are ambiguous

## Communication Style
- Be concise and direct
- Use @mentions to address other agents
- Update your working memory with important context

## Working Memory Format
When you need to remember something, include a fenced block:
\`\`\`working_memory
key: value
\`\`\`
`;
}

// ── Help ────────────────────────────────────────────────────────────────────

const AGENT_HELP = `
Usage: squadrn agent <subcommand> [options]

Subcommands:
  create             Create a new agent (interactive wizard)
  list               List all configured agents
  start <name>       Start an agent
  stop <name>        Stop an agent
  logs <name>        Tail agent logs (--lines=N for history)
  edit <name>        Open agent's SOUL.md in $EDITOR
  remove <name>      Remove an agent
`;

// ── Main router ─────────────────────────────────────────────────────────────

export async function agentCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "create":
      await agentCreate();
      break;
    case "list":
      await agentList();
      break;
    case "start":
      await agentStart(args[1]);
      break;
    case "stop":
      await agentStop(args[1]);
      break;
    case "logs":
      await agentLogs(args[1], args);
      break;
    case "edit":
      await agentEdit(args[1]);
      break;
    case "remove":
      await agentRemove(args[1]);
      break;
    default:
      if (subcommand) out.error(`Unknown agent subcommand: ${subcommand}`);
      console.log(AGENT_HELP);
  }
}

// ── create ──────────────────────────────────────────────────────────────────

async function agentCreate(): Promise<void> {
  out.header("Create Agent");

  const existing = await loadAgentsConfig();

  // Name
  const name = await Input.prompt({
    message: "Agent name",
    validate: (v) => {
      if (!v.trim()) return "Name is required";
      if (!/^[a-z][a-z0-9_-]*$/i.test(v)) return "Use alphanumeric, hyphens and underscores only";
      if (existing[v.toLowerCase()]) return `Agent "${v}" already exists`;
      return true;
    },
    transform: (v) => v.toLowerCase(),
  });

  // Role
  const ROLE_PRESETS = [
    "Squad Lead",
    "Developer",
    "Writer",
    "Researcher",
    "QA Tester",
    "DevOps",
    "Custom...",
  ];
  let role = await Select.prompt({
    message: "Agent role",
    options: ROLE_PRESETS,
  });
  if (role === "Custom...") {
    role = await Input.prompt({ message: "Custom role" });
  }

  // LLM
  const llmPlugins = await loadPluginsByType("llm");
  let llm: string;
  if (llmPlugins.length > 0) {
    llm = await Select.prompt({
      message: "LLM plugin",
      options: [...llmPlugins, "other"],
    });
    if (llm === "other") {
      llm = await Input.prompt({ message: "LLM plugin name", default: "claude" });
    }
  } else {
    out.warn("No LLM plugins installed. Using default name.");
    llm = await Input.prompt({ message: "LLM plugin name", default: "claude" });
  }

  // Channels
  const channelPlugins = await loadPluginsByType("channel");
  let channels: string[] = [];
  if (channelPlugins.length > 0) {
    channels = await Checkbox.prompt({
      message: "Channels (space to toggle, enter to confirm)",
      options: channelPlugins,
    });
  } else {
    out.info("No channel plugins installed. Agent will be internal-only.");
  }

  // Heartbeat
  const heartbeat = await Input.prompt({
    message: "Heartbeat cron",
    default: "*/15 * * * *",
  });

  // Create directory & files
  const agentDir = join(AGENTS_DIR, name);
  await ensureDir(agentDir);

  const soulPath = join(agentDir, "SOUL.md");
  await Deno.writeTextFile(soulPath, soulTemplate(name, role));

  const workingPath = join(agentDir, "WORKING.md");
  try {
    await Deno.stat(workingPath);
  } catch {
    await Deno.writeTextFile(workingPath, "");
  }

  // Save to config
  const agentConfig: AgentConfig = {
    name,
    role,
    llm,
    channels,
    heartbeat,
    soul_file: soulPath,
  };
  await saveAgentToConfig(name, agentConfig);

  console.log();
  out.success(`Agent "${name}" created`);
  out.info(`SOUL.md: ${soulPath}`);
  out.info(`Edit personality: squadrn agent edit ${name}`);
  out.info(`Start agent:      squadrn agent start ${name}`);
}

// ── list ────────────────────────────────────────────────────────────────────

async function agentList(): Promise<void> {
  const agents = await loadAgentsConfig();
  const entries = Object.entries(agents);

  if (entries.length === 0) {
    out.info("No agents configured");
    out.info(`Create one with: ${cyan("squadrn agent create")}`);
    return;
  }

  // Try to get live status from gateway
  const liveStatus = await getLiveAgentStatuses();

  out.header("Agents");

  const nameW = 16;
  const roleW = 20;
  const statusW = 10;
  const llmW = 12;
  const heartW = 18;

  console.log(
    `  ${bold(pad("NAME", nameW))} ${bold(pad("ROLE", roleW))} ${bold(pad("STATUS", statusW))} ${bold(pad("LLM", llmW))} ${bold(pad("HEARTBEAT", heartW))}`,
  );
  console.log(`  ${dim("-".repeat(nameW + roleW + statusW + llmW + heartW + 4))}`);

  for (const [key, agent] of entries) {
    const status = liveStatus?.[key] ?? "offline";
    const statusColor = status === "active"
      ? green
      : status === "idle"
      ? gray
      : status === "blocked"
      ? yellow
      : red;

    console.log(
      `  ${pad(key, nameW)} ${pad(agent.role, roleW)} ${statusColor(pad(status, statusW))} ${pad(agent.llm, llmW)} ${dim(pad(agent.heartbeat, heartW))}`,
    );
  }

  console.log();
  out.info(`${entries.length} agent${entries.length === 1 ? "" : "s"} configured`);
}

// ── start ───────────────────────────────────────────────────────────────────

async function agentStart(name: string | undefined): Promise<void> {
  if (!name) {
    out.error("Usage: squadrn agent start <name>");
    return;
  }

  const agents = await loadAgentsConfig();
  if (!agents[name]) {
    out.error(`Agent "${name}" not found`);
    out.info("Run 'squadrn agent list' to see configured agents");
    return;
  }

  const client = new GatewayClient(SOCKET_PATH);
  const resp = await client.send({ action: "agent:start", agent: name } as never);

  if (resp.ok) {
    out.success(`Agent "${name}" started`);
  } else {
    // Gateway might not be running — inform user
    if (resp.error?.includes("connect")) {
      out.error("Gateway is not running. Start it first with 'squadrn start'");
    } else {
      out.error(resp.error ?? `Failed to start agent "${name}"`);
    }
  }
}

// ── stop ────────────────────────────────────────────────────────────────────

async function agentStop(name: string | undefined): Promise<void> {
  if (!name) {
    out.error("Usage: squadrn agent stop <name>");
    return;
  }

  const agents = await loadAgentsConfig();
  if (!agents[name]) {
    out.error(`Agent "${name}" not found`);
    return;
  }

  const client = new GatewayClient(SOCKET_PATH);
  const resp = await client.send({ action: "agent:stop", agent: name } as never);

  if (resp.ok) {
    out.success(`Agent "${name}" stopped`);
  } else {
    if (resp.error?.includes("connect")) {
      out.error("Gateway is not running");
    } else {
      out.error(resp.error ?? `Failed to stop agent "${name}"`);
    }
  }
}

// ── logs ────────────────────────────────────────────────────────────────────

async function agentLogs(name: string | undefined, args: string[]): Promise<void> {
  if (!name) {
    out.error("Usage: squadrn agent logs <name> [--lines=N]");
    return;
  }

  const agents = await loadAgentsConfig();
  if (!agents[name]) {
    out.error(`Agent "${name}" not found`);
    return;
  }

  // Parse --lines flag
  const linesFlag = args.find((a) => a.startsWith("--lines="));
  const lines = linesFlag ? parseInt(linesFlag.split("=")[1]!, 10) : 50;

  const sessionDir = join(
    Deno.env.get("HOME") ?? "",
    ".squadrn",
    "sessions",
  );

  // Look for session JSONL files for this agent
  out.header(`Logs: ${name}`);

  // Read from the agent's session files
  try {
    const entries: string[] = [];

    for await (const entry of Deno.readDir(sessionDir)) {
      if (!entry.isFile || !entry.name.endsWith(".jsonl")) continue;
      const filePath = join(sessionDir, entry.name);
      try {
        const text = await Deno.readTextFile(filePath);
        const fileLines = text.split("\n").filter((l) => l.trim());
        // Check first message for agent association (session files don't embed agentId
        // in each line — we just show all recent sessions for now)
        for (const line of fileLines) {
          entries.push(line);
        }
      } catch {
        // skip unreadable files
      }
    }

    if (entries.length === 0) {
      out.info("No logs yet. Start the agent and send it a message.");
      return;
    }

    // Show last N entries
    const tail = entries.slice(-lines);
    for (const line of tail) {
      try {
        const msg = JSON.parse(line) as { role: string; content: string };
        const prefix = msg.role === "assistant" ? green(`[${name}]`) : cyan("[user]");
        console.log(`${prefix} ${msg.content.slice(0, 200)}`);
      } catch {
        console.log(dim(line.slice(0, 200)));
      }
    }
  } catch {
    out.info("No session logs found.");
    out.info(`Session directory: ${sessionDir}`);
  }
}

// ── edit ────────────────────────────────────────────────────────────────────

async function agentEdit(name: string | undefined): Promise<void> {
  if (!name) {
    out.error("Usage: squadrn agent edit <name>");
    return;
  }

  const agents = await loadAgentsConfig();
  const agent = agents[name];
  if (!agent) {
    out.error(`Agent "${name}" not found`);
    return;
  }

  const soulPath = agent.soul_file;
  const editor = Deno.env.get("EDITOR") ?? Deno.env.get("VISUAL") ?? "vi";

  out.info(`Opening ${soulPath} in ${editor}...`);

  const cmd = new Deno.Command(editor, {
    args: [soulPath],
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const proc = cmd.spawn();
  const status = await proc.status;

  if (status.success) {
    out.success(`SOUL.md saved for "${name}"`);
  } else {
    out.error(`Editor exited with code ${status.code}`);
  }
}

// ── remove ──────────────────────────────────────────────────────────────────

async function agentRemove(name: string | undefined): Promise<void> {
  if (!name) {
    out.error("Usage: squadrn agent remove <name>");
    return;
  }

  const { Confirm } = await import("@cliffy/prompt");

  const agents = await loadAgentsConfig();
  if (!agents[name]) {
    out.error(`Agent "${name}" not found`);
    return;
  }

  const confirm = await Confirm.prompt({
    message: `Remove agent "${name}"? This deletes its config entry.`,
    default: false,
  });
  if (!confirm) {
    out.info("Aborted");
    return;
  }

  await removeAgentFromConfig(name);
  out.success(`Agent "${name}" removed from config`);
  out.info(`Agent files remain at: ${join(AGENTS_DIR, name)}`);
}

// ── Gateway helpers ─────────────────────────────────────────────────────────

async function getLiveAgentStatuses(): Promise<Record<string, string> | null> {
  try {
    const client = new GatewayClient(SOCKET_PATH);
    const resp = await client.status();
    if (!resp.ok || !resp.data) return null;
    // Gateway may expose agent statuses in future — for now return null
    return null;
  } catch {
    return null;
  }
}
