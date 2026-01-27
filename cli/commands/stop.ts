import { PID_PATH } from "../utils/paths.ts";
import * as out from "../utils/output.ts";

export async function stopCommand(): Promise<void> {
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
