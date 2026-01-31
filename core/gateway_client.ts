import type { GatewayCommand, GatewayResponse } from "./gateway.ts";

/** Client for communicating with the gateway daemon over its Unix socket. */
export class GatewayClient {
  #socketPath: string;

  constructor(socketPath: string) {
    this.#socketPath = socketPath;
  }

  /** Send a command to the gateway and return the response. */
  async send(cmd: GatewayCommand): Promise<GatewayResponse> {
    let conn: Deno.Conn;
    try {
      conn = await Deno.connect({ transport: "unix", path: this.#socketPath });
    } catch {
      return { ok: false, error: "Cannot connect to gateway (is it running?)" };
    }

    try {
      await conn.write(new TextEncoder().encode(JSON.stringify(cmd)));

      const buf = new Uint8Array(65536);
      const n = await conn.read(buf);
      if (n === null) {
        return { ok: false, error: "No response from gateway" };
      }

      const raw = new TextDecoder().decode(buf.subarray(0, n));
      return JSON.parse(raw) as GatewayResponse;
    } finally {
      conn.close();
    }
  }

  /** Request gateway status. */
  async status(): Promise<GatewayResponse> {
    return this.send({ action: "status" });
  }

  /** Request gateway to stop. */
  async stop(): Promise<GatewayResponse> {
    return this.send({ action: "stop" });
  }

  /** Request gateway to reload configuration. */
  async reload(): Promise<GatewayResponse> {
    return this.send({ action: "reload" });
  }
}
