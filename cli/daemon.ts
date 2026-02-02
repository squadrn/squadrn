/**
 * Daemon entry point — spawned by `squadrn start` as a detached background process.
 * Receives configPath, socketPath, pidPath as CLI arguments.
 *
 * Usage: deno run --allow-all cli/daemon.ts <configPath> <socketPath> <pidPath>
 */

import { formatError, Gateway } from "@squadrn/core";

const configPath = Deno.args[0];
const socketPath = Deno.args[1];
const pidPath = Deno.args[2];

if (!configPath || !socketPath || !pidPath) {
  console.error("Usage: daemon.ts <configPath> <socketPath> <pidPath>");
  Deno.exit(1);
}

const gateway = new Gateway();

try {
  await gateway.start(configPath, socketPath);
} catch (err) {
  console.error(`Failed to start gateway: ${formatError(err)}`);
  Deno.exit(1);
}

// Write PID file
await Deno.writeTextFile(pidPath, String(Deno.pid));

// Handle shutdown signals
const shutdown = async () => {
  await gateway.stop();
  try {
    await Deno.remove(pidPath);
  } catch { /* ignore */ }
  Deno.exit(0);
};

Deno.addSignalListener("SIGINT", shutdown);
if (Deno.build.os !== "windows") {
  Deno.addSignalListener("SIGTERM", shutdown);
}

// Keep alive
await new Promise(() => {});
