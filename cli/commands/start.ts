import { Gateway } from "@squadrn/core";
import { CONFIG_PATH, PID_PATH, SOCKET_PATH } from "../utils/paths.ts";
import * as out from "../utils/output.ts";

export async function startCommand(): Promise<void> {
  // Check for existing PID
  try {
    const pid = await Deno.readTextFile(PID_PATH);
    const pidNum = parseInt(pid.trim(), 10);
    try {
      Deno.kill(pidNum, "SIGCONT");
      out.error(`Gateway already running (PID: ${pidNum})`);
      out.info("Run 'squadrn stop' first");
      return;
    } catch {
      out.warn("Stale PID file found, cleaning up");
      await Deno.remove(PID_PATH).catch(() => {});
    }
  } catch {
    // No PID file, good to go
  }

  out.info("Starting Squadrn gateway...");

  const gateway = new Gateway();

  try {
    await gateway.start(CONFIG_PATH, SOCKET_PATH);
  } catch (err) {
    out.error(`Failed to start: ${(err as Error).message}`);
    Deno.exit(1);
  }

  // Write PID file
  await Deno.writeTextFile(PID_PATH, String(Deno.pid));

  out.success("Gateway is running");
  out.info(`PID: ${Deno.pid}`);
  out.info(`Socket: ${SOCKET_PATH}`);

  // Handle shutdown signals
  const shutdown = async () => {
    out.info("\nShutting down...");
    await gateway.stop();
    try {
      await Deno.remove(PID_PATH);
    } catch { /* ignore */ }
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);

  // Keep process alive
  await new Promise(() => {});
}
