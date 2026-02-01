import { GatewayClient } from "@squadrn/core";
import { PID_PATH, SOCKET_PATH } from "../utils/paths.ts";
import * as out from "../utils/output.ts";

/** Wait for the gateway process to exit after sending stop. */
async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      Deno.kill(pid, "SIGCONT");
      // Still alive
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      // Process gone
      return true;
    }
  }
  return false;
}

export async function stopCommand(): Promise<void> {
  // 1. Try graceful stop via socket
  const client = new GatewayClient(SOCKET_PATH);
  const response = await client.stop();

  if (response.ok) {
    out.info("Shutting down gateway...");

    // Read PID and wait for process to exit
    let pid: number | null = null;
    try {
      const content = await Deno.readTextFile(PID_PATH);
      pid = parseInt(content.trim(), 10);
    } catch { /* no pid file */ }

    if (pid !== null) {
      const exited = await waitForExit(pid, 5000);
      if (!exited) {
        out.warn("Gateway did not exit in time, sending SIGTERM");
        try {
          Deno.kill(pid, "SIGTERM");
        } catch { /* already gone */ }
      }
    }

    // Clean up files
    await Deno.remove(PID_PATH).catch(() => {});
    await Deno.remove(SOCKET_PATH).catch(() => {});

    out.success("Gateway stopped");
    return;
  }

  // 2. Fallback: kill by PID
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
    const exited = await waitForExit(pid, 5000);
    if (!exited) {
      out.warn("Forcefully killing gateway");
      Deno.kill(pid, "SIGKILL");
    }
  } catch {
    out.warn("Process not found, cleaning up stale files");
  }

  await Deno.remove(PID_PATH).catch(() => {});
  await Deno.remove(SOCKET_PATH).catch(() => {});

  out.success("Gateway stopped");
}
