import { GatewayClient } from "@squadrn/core";
import { CONFIG_PATH, PID_PATH, SOCKET_PATH } from "../utils/paths.ts";
import * as out from "../utils/output.ts";

/** Check if a process with the given PID is alive. */
function isProcessAlive(pid: number): boolean {
  try {
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

/** Ping the daemon via socket to confirm it's responsive. */
async function pingDaemon(): Promise<boolean> {
  const client = new GatewayClient(SOCKET_PATH);
  const resp = await client.status();
  return resp.ok;
}

/** Wait for the daemon socket to become available, with timeout. */
async function waitForSocket(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pingDaemon()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** Resolve the path to daemon.ts relative to the current module. */
function daemonScriptPath(): string {
  const url = new URL("../daemon.ts", import.meta.url);
  return url.pathname;
}

export async function startCommand(): Promise<void> {
  // 1. Check if a daemon is already running (PID file + ping)
  try {
    const pidText = await Deno.readTextFile(PID_PATH);
    const pid = parseInt(pidText.trim(), 10);

    if (isProcessAlive(pid)) {
      // Process exists — verify via socket ping
      if (await pingDaemon()) {
        out.error(`Gateway already running (PID: ${pid})`);
        out.info("Run 'squadrn stop' first");
        return;
      }
      // Process alive but socket dead — stale state, kill and continue
      out.warn("Stale gateway process found, cleaning up");
      try {
        Deno.kill(pid, "SIGTERM");
      } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 500));
    }

    // Stale PID file
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

  // 3. Spawn daemon as detached background process
  out.info("Starting Squadrn gateway...");

  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-all",
      daemonScriptPath(),
      CONFIG_PATH,
      SOCKET_PATH,
      PID_PATH,
    ],
    stdin: "null",
    stdout: "null",
    stderr: "null",
  });

  const child = cmd.spawn();
  child.unref();

  // 4. Wait for socket to become available
  const ready = await waitForSocket(5000);

  if (!ready) {
    out.error("Gateway failed to start (timeout waiting for socket)");
    out.info("Check logs for details");
    return;
  }

  // 5. Read PID from file and show success
  try {
    const pidText = await Deno.readTextFile(PID_PATH);
    const pid = parseInt(pidText.trim(), 10);
    out.success(`Gateway is running (PID: ${pid})`);
    out.info(`Socket: ${SOCKET_PATH}`);
    out.info(`Config: ${CONFIG_PATH}`);
  } catch {
    out.success("Gateway is running");
  }
}
