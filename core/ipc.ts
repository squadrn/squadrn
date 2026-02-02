/**
 * Cross-platform IPC abstraction.
 *
 * Uses Unix domain sockets on macOS/Linux and TCP (localhost) on Windows,
 * where `op_net_listen_unix` is not supported.
 */

export const IS_WINDOWS = Deno.build.os === "windows";

/**
 * Check if a process with the given PID is alive.
 * Uses SIGCONT on Unix, tasklist on Windows.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    if (IS_WINDOWS) {
      const cmd = new Deno.Command("tasklist", {
        args: ["/FI", `PID eq ${pid}`, "/NH"],
        stdout: "piped",
        stderr: "null",
      });
      const { stdout } = cmd.outputSync();
      const text = new TextDecoder().decode(stdout);
      return text.includes(String(pid));
    }
    Deno.kill(pid, "SIGCONT");
    return true;
  } catch {
    return false;
  }
}

/**
 * Derive a deterministic TCP port from a socket path (Windows only).
 * Maps the path to a port in the ephemeral range 49152–65535.
 */
function portFromPath(path: string): number {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0;
  }
  return 49152 + (Math.abs(hash) % (65535 - 49152));
}

/** Start an IPC listener for the given socket path. */
export function listenIpc(socketPath: string): Deno.Listener {
  if (IS_WINDOWS) {
    const basePort = portFromPath(socketPath);
    // Retry with incrementing ports in case of TIME_WAIT collisions
    for (let offset = 0; offset < 10; offset++) {
      const port = 49152 + ((basePort - 49152 + offset) % (65535 - 49152));
      try {
        const listener = Deno.listen({ transport: "tcp", hostname: "127.0.0.1", port });
        // Write port to sidecar file so connectIpc can find it
        try {
          Deno.writeTextFileSync(socketPath + ".port", String(port));
        } catch { /* best effort */ }
        return listener;
      } catch (err) {
        if (offset === 9) throw err;
      }
    }
    // Unreachable, but satisfies type checker
    throw new Error("Failed to bind IPC port");
  }
  return Deno.listen({ transport: "unix", path: socketPath });
}

/** Connect to an IPC endpoint at the given socket path. */
export async function connectIpc(socketPath: string): Promise<Deno.Conn> {
  if (IS_WINDOWS) {
    // Read actual port from sidecar file if available, fall back to hash
    let port = portFromPath(socketPath);
    try {
      const stored = Deno.readTextFileSync(socketPath + ".port");
      port = parseInt(stored.trim(), 10);
    } catch { /* use hash-derived port */ }
    return await Deno.connect({
      transport: "tcp",
      hostname: "127.0.0.1",
      port,
    });
  }
  return await Deno.connect({ transport: "unix", path: socketPath });
}

/** Whether socket file cleanup is needed (not on Windows where we use TCP). */
export function needsSocketCleanup(): boolean {
  return !IS_WINDOWS;
}

/** Clean up IPC-related files for the given socket path. */
export async function cleanupIpcFiles(socketPath: string): Promise<void> {
  if (!IS_WINDOWS) {
    await Deno.remove(socketPath).catch(() => {});
  } else {
    await Deno.remove(socketPath + ".port").catch(() => {});
  }
}
