/**
 * Cross-platform IPC abstraction.
 *
 * Uses Unix domain sockets on macOS/Linux and TCP (localhost) on Windows,
 * where `op_net_listen_unix` is not supported.
 */

const IS_WINDOWS = Deno.build.os === "windows";

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
