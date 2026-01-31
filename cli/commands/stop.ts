import { GatewayClient } from "@squadrn/core";
import { PID_PATH, SOCKET_PATH } from "../utils/paths.ts";
import * as out from "../utils/output.ts";

export async function stopCommand(): Promise<void> {
  // Try graceful stop via socket first
  const client = new GatewayClient(SOCKET_PATH);
  const response = await client.stop();

  if (response.ok) {
    out.success("Gateway is shutting down");
    // Wait briefly then clean up PID file
    await new Promise((r) => setTimeout(r, 200));
    try {
      await Deno.remove(PID_PATH);
    } catch { /* ignore */ }
    return;
  }

  // Fallback: kill by PID
  let pid: number;
  try {
    const content = await Deno.readTextFile(PID_PATH);
    pid = parseInt(content.trim(), 10);
  } catch {
    out.error("No running gateway found");
    return;
  }

  out.info(`Stopping gateway (PID: ${pid})...`);

  try {
    Deno.kill(pid, "SIGTERM");
  } catch {
    out.warn("Process not found, cleaning up stale PID file");
  }

  try {
    await Deno.remove(PID_PATH);
  } catch { /* ignore */ }

  out.success("Gateway stopped");
}
