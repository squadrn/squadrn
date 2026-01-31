import { EventBus } from "./event_bus.ts";
import { ConfigManager, type SquadrnConfig } from "./config_manager.ts";
import { SqliteStorage } from "./storage/sqlite.ts";
import type { StorageAdapter } from "./storage/adapter.ts";
import { createLogger } from "./logger.ts";
import type { Logger } from "@squadrn/types";

/** JSON command sent over the Unix socket. */
export interface GatewayCommand {
  action: "status" | "stop" | "reload";
}

/** JSON response returned by the gateway socket. */
export interface GatewayResponse {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/** Status snapshot returned by the status command. */
export interface GatewayStatus {
  running: boolean;
  pid: number;
  uptime: number;
  config: SquadrnConfig | null;
  plugins: string[];
}

const DEFAULT_GRACE_MS = 5000;

export class Gateway {
  #events: EventBus;
  #configManager: ConfigManager | null = null;
  #storage: StorageAdapter | null = null;
  #running = false;
  #log: Logger;
  #listener: Deno.Listener | null = null;
  #socketPath: string | null = null;
  #startedAt: number = 0;
  #gracePeriodMs: number = DEFAULT_GRACE_MS;
  #plugins: string[] = [];

  constructor(options?: { gracePeriodMs?: number }) {
    this.#events = new EventBus();
    this.#log = createLogger("gateway");
    if (options?.gracePeriodMs !== undefined) {
      this.#gracePeriodMs = options.gracePeriodMs;
    }
  }

  get events(): EventBus {
    return this.#events;
  }

  get config(): SquadrnConfig | null {
    return this.#configManager?.config ?? null;
  }

  get isRunning(): boolean {
    return this.#running;
  }

  get socketPath(): string | null {
    return this.#socketPath;
  }

  /** Start the gateway daemon. */
  async start(configPath: string, socketPath: string): Promise<void> {
    if (this.#running) throw new Error("Gateway is already running");

    // 1. Load configuration
    this.#log.info("Loading configuration", { path: configPath });
    const result = await ConfigManager.load(configPath);
    if (!result.ok) throw result.error;
    this.#configManager = result.value;

    // 2. Initialize storage
    const config = this.#configManager.config;
    this.#log.info("Initializing storage", { adapter: config.storage.adapter, path: config.storage.path });
    this.#storage = new SqliteStorage(config.storage.path);

    // 3. Event bus is ready (constructed in constructor)

    // 4. TODO: Load installed plugins from ~/.squadrn/plugins.json
    // Plugins will be loaded here in a future implementation

    // 5. Start Unix socket server
    this.#socketPath = socketPath;
    await this.#cleanStaleSocket(socketPath);
    this.#listener = Deno.listen({ transport: "unix", path: socketPath });
    this.#acceptConnections();

    this.#running = true;
    this.#startedAt = Date.now();

    // 6. Emit started event
    await this.#events.emit("gateway:started");
    this.#log.info("Gateway started", {
      host: config.gateway.host,
      port: config.gateway.port,
      socket: socketPath,
    });
  }

  /** Gracefully stop the gateway. */
  async stop(): Promise<void> {
    if (!this.#running) return;

    // 1. Emit stopping event
    this.#log.info("Gateway stopping, waiting for handlers", { gracePeriodMs: this.#gracePeriodMs });
    const stopPromise = this.#events.emit("gateway:stopping");

    // 2. Wait for handlers with grace period
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      stopPromise,
      new Promise<void>((resolve) => {
        graceTimer = setTimeout(resolve, this.#gracePeriodMs);
      }),
    ]);
    clearTimeout(graceTimer);

    // 3. Disconnect plugins (future: call plugin.unregister())

    // 4. Close storage
    this.#storage?.close();
    this.#storage = null;

    // 5. Close socket
    if (this.#listener) {
      this.#listener.close();
      this.#listener = null;
    }
    if (this.#socketPath) {
      try {
        await Deno.remove(this.#socketPath);
      } catch { /* already removed */ }
      this.#socketPath = null;
    }

    this.#running = false;
    this.#log.info("Gateway stopped");
  }

  /** Build a status snapshot. */
  status(): GatewayStatus {
    return {
      running: this.#running,
      pid: Deno.pid,
      uptime: this.#running ? Date.now() - this.#startedAt : 0,
      config: this.config,
      plugins: [...this.#plugins],
    };
  }

  /** Handle a command received over the socket. */
  async handleCommand(cmd: GatewayCommand): Promise<GatewayResponse> {
    switch (cmd.action) {
      case "status":
        return { ok: true, data: this.status() as unknown as Record<string, unknown> };
      case "stop":
        // Stop asynchronously so we can send the response first
        setTimeout(() => this.stop(), 50);
        return { ok: true, data: { message: "Shutting down" } };
      case "reload": {
        if (!this.#configManager) {
          return { ok: false, error: "No config loaded" };
        }
        const result = await this.#configManager.reload();
        if (!result.ok) {
          return { ok: false, error: result.error.message };
        }
        this.#log.info("Configuration reloaded");
        return { ok: true, data: { message: "Configuration reloaded" } };
      }
      default:
        return { ok: false, error: `Unknown action: ${String((cmd as unknown as Record<string, unknown>).action)}` };
    }
  }

  /** Remove a stale socket file if it exists. */
  async #cleanStaleSocket(path: string): Promise<void> {
    try {
      await Deno.remove(path);
    } catch { /* doesn't exist, fine */ }
  }

  /** Accept connections on the Unix socket in the background. */
  #acceptConnections(): void {
    const listener = this.#listener;
    if (!listener) return;

    (async () => {
      for await (const conn of listener) {
        this.#handleConnection(conn);
      }
    })().catch(() => {
      // Listener closed, expected during shutdown
    });
  }

  /** Handle a single socket connection. */
  async #handleConnection(conn: Deno.Conn): Promise<void> {
    try {
      const buf = new Uint8Array(4096);
      const n = await conn.read(buf);
      if (n === null) {
        conn.close();
        return;
      }

      const raw = new TextDecoder().decode(buf.subarray(0, n));
      let cmd: GatewayCommand;
      try {
        cmd = JSON.parse(raw) as GatewayCommand;
      } catch {
        const errResp: GatewayResponse = { ok: false, error: "Invalid JSON" };
        await conn.write(new TextEncoder().encode(JSON.stringify(errResp)));
        conn.close();
        return;
      }

      const response = await this.handleCommand(cmd);
      await conn.write(new TextEncoder().encode(JSON.stringify(response)));
      conn.close();
    } catch (err) {
      this.#log.error("Socket connection error", { error: (err as Error).message });
      try {
        conn.close();
      } catch { /* ignore */ }
    }
  }
}
