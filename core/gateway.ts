import { EventBus } from "./event_bus.ts";
import { ConfigManager, type SquadrnConfig } from "./config_manager.ts";
import { SqliteStorage } from "./storage/sqlite.ts";
import type { StorageAdapter } from "./storage/adapter.ts";

export class Gateway {
  #events: EventBus;
  #configManager: ConfigManager | null = null;
  #storage: StorageAdapter | null = null;
  #running = false;

  constructor() {
    this.#events = new EventBus();
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

  async start(configPath: string): Promise<void> {
    if (this.#running) throw new Error("Gateway is already running");

    const result = await ConfigManager.load(configPath);
    if (!result.ok) throw result.error;
    const mgr = result.value;
    this.#configManager = mgr;
    const config = mgr.config;

    // Init storage
    this.#storage = new SqliteStorage(config.storage.path);

    this.#running = true;
    await this.#events.emit("gateway:started");

    console.log(`Gateway started on ${config.gateway.host}:${config.gateway.port}`);
  }

  async stop(): Promise<void> {
    if (!this.#running) return;

    await this.#events.emit("gateway:stopping");
    this.#storage?.close();
    this.#storage = null;
    this.#running = false;

    console.log("Gateway stopped");
  }
}
