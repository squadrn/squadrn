import { formatError, Gateway, GatewayClient, isProcessAlive } from "@squadrn/core";
import { CONFIG_PATH, PID_PATH, SOCKET_PATH } from "../utils/paths.ts";
import * as out from "../utils/output.ts";

export async function uiCommand(): Promise<void> {
  // 1. Check if a daemon is already running
  try {
    const pidText = await Deno.readTextFile(PID_PATH);
    const pid = parseInt(pidText.trim(), 10);

    if (isProcessAlive(pid)) {
      const client = new GatewayClient(SOCKET_PATH);
      const resp = await client.status();
      if (resp.ok) {
        out.error(`Gateway already running (PID: ${pid})`);
        out.info("Run 'squadrn stop' first");
        return;
      }
      // Stale process
      out.warn("Stale gateway process found, cleaning up");
      try {
        Deno.kill(pid, "SIGTERM");
      } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 500));
    }

    await Deno.remove(PID_PATH).catch(() => {});
    await Deno.remove(SOCKET_PATH).catch(() => {});
  } catch {
    // No PID file — good to go
  }

  // 2. Verify config exists
  try {
    await Deno.stat(CONFIG_PATH);
  } catch {
    out.error("No config found. Run 'squadrn init' first.");
    return;
  }

  // 3. Start gateway in foreground (plugins get stdin/stdout access)
  // Suppress gateway logs so they don't pollute the TUI
  Deno.env.set("SQUADRN_LOG_LEVEL", "error");

  const gateway = new Gateway();

  try {
    await gateway.start(CONFIG_PATH, SOCKET_PATH);
  } catch (err) {
    out.error(`Failed to start gateway: ${formatError(err)}`);
    return;
  }

  // Write PID file so `squadrn stop` works from another terminal
  await Deno.writeTextFile(PID_PATH, String(Deno.pid));

  // Handle shutdown signals
  const shutdown = async () => {
    await gateway.stop();
    try {
      await Deno.remove(PID_PATH);
    } catch { /* ignore */ }
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGINT", shutdown);
  if (Deno.build.os !== "windows") {
    Deno.addSignalListener("SIGTERM", shutdown);
  }

  // Keep alive — the TUI plugin's keypress loop handles interaction
  await new Promise(() => {});
}
