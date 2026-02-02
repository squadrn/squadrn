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
    return Deno.listen({ transport: "tcp", hostname: "127.0.0.1", port: portFromPath(socketPath) });
  }
  return Deno.listen({ transport: "unix", path: socketPath });
}

/** Connect to an IPC endpoint at the given socket path. */
export async function connectIpc(socketPath: string): Promise<Deno.Conn> {
  if (IS_WINDOWS) {
    return await Deno.connect({
      transport: "tcp",
      hostname: "127.0.0.1",
      port: portFromPath(socketPath),
    });
  }
  return await Deno.connect({ transport: "unix", path: socketPath });
}

/** Whether socket file cleanup is needed (not on Windows where we use TCP). */
export function needsSocketCleanup(): boolean {
  return !IS_WINDOWS;
}
