import { GatewayClient, loadConfig } from "@squadrn/core";
import type { GatewayStatus } from "@squadrn/core";
import { CONFIG_PATH, SOCKET_PATH } from "../utils/paths.ts";
import * as out from "../utils/output.ts";

function formatUptime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function statusCommand(): Promise<void> {
  out.header("Squadrn Status");

  // Try to get live status from the gateway socket
  const client = new GatewayClient(SOCKET_PATH);
  const response = await client.status();

  if (response.ok && response.data) {
    const data = response.data as unknown as GatewayStatus;

    out.success(`Gateway running (PID: ${data.pid})`);
    out.info(`Uptime: ${formatUptime(data.uptime)}`);

    // Memory
    if (data.memory) {
      out.info(
        `Memory: ${formatBytes(data.memory.rss)} RSS, ` +
          `${formatBytes(data.memory.heapUsed)} / ${formatBytes(data.memory.heapTotal)} heap`,
      );
    }

    // Plugins
    if (data.plugins.length > 0) {
      out.info(`Plugins loaded: ${data.plugins.join(", ")}`);
    } else {
      out.info("Plugins loaded: none");
    }

    // Agents
    if (data.config) {
      const agents = Object.entries(data.config.agents);
      if (agents.length > 0) {
        out.info(`Agents configured: ${agents.length}`);
        for (const [key, agent] of agents) {
          const a = agent as { name: string; role: string; llm: string };
          out.info(`  - ${key}: ${a.name} (${a.role}) [${a.llm}]`);
        }
      } else {
        out.info("Agents configured: none");
      }
    }

    return;
  }

  // Gateway not running — show static info
  out.info("Squadrn is not running");
  console.log();

  const result = await loadConfig(CONFIG_PATH);
  if (result.ok) {
    const config = result.value;
    out.info(`Config: ${CONFIG_PATH}`);
    out.info(`Storage: ${config.storage.adapter} (${config.storage.path})`);
    const agentCount = Object.keys(config.agents).length;
    out.info(`Agents configured: ${agentCount}`);
    console.log();
    out.info("Run 'squadrn start' to start the gateway");
  } else {
    out.warn("No config found. Run 'squadrn init' first.");
  }
}
