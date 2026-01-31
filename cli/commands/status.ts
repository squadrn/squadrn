import { GatewayClient, loadConfig } from "@squadrn/core";
import { CONFIG_PATH, SOCKET_PATH } from "../utils/paths.ts";
import * as out from "../utils/output.ts";

export async function statusCommand(): Promise<void> {
  out.header("Squadrn Status");

  // Try to get live status from the gateway socket
  const client = new GatewayClient(SOCKET_PATH);
  const response = await client.status();

  if (response.ok && response.data) {
    const data = response.data as {
      pid: number;
      uptime: number;
      plugins: string[];
      config: { agents: Record<string, unknown> } | null;
    };
    out.success(`Gateway running (PID: ${data.pid})`);
    const uptimeSec = Math.floor(data.uptime / 1000);
    out.info(`Uptime: ${uptimeSec}s`);
    out.info(`Plugins loaded: ${data.plugins.length}`);
    const agentCount = data.config ? Object.keys(data.config.agents).length : 0;
    out.info(`Agents configured: ${agentCount}`);
    return;
  }

  // Fallback: static info from config file
  out.info("Gateway: not running");

  const result = await loadConfig(CONFIG_PATH);
  if (result.ok) {
    const config = result.value;
    out.info(`Config: ${CONFIG_PATH}`);
    out.info(`Storage: ${config.storage.adapter} (${config.storage.path})`);
    const agentCount = Object.keys(config.agents).length;
    out.info(`Agents configured: ${agentCount}`);
  } else {
    out.warn("No config found. Run 'squadrn init' first.");
  }
}
