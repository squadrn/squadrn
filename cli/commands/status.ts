import { PID_PATH, CONFIG_PATH } from "../utils/paths.ts";
import { loadConfig } from "@squadrn/core";
import * as out from "../utils/output.ts";

export async function statusCommand(): Promise<void> {
  out.header("Squadrn Status");

  // Check gateway
  try {
    const pid = await Deno.readTextFile(PID_PATH);
    const pidNum = parseInt(pid.trim(), 10);
    try {
      Deno.kill(pidNum, "SIGCONT");
      out.success(`Gateway running (PID: ${pidNum})`);
    } catch {
      out.warn("Stale PID file found, gateway not running");
    }
  } catch {
    out.info("Gateway: not running");
  }

  // Show config info
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
