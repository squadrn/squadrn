import type {
  ChannelProvider,
  EventHandler,
  EventName,
  LLMProvider,
  Logger,
  Plugin,
  PluginAPI,
  PluginManifest,
  QueryFilter,
  StorageAdapter,
  ToolProvider,
} from "@squadrn/types";
import { EventBus } from "./event_bus.ts";
import { createLogger } from "./logger.ts";

// ── Errors ──────────────────────────────────────────────────────────────────

import { PluginError } from "./errors.ts";
export { PluginError as PluginLoadError };

// ── Installed plugin record (persisted in plugins.json) ─────────────────────

export interface InstalledPlugin {
  url: string;
  manifest: PluginManifest;
  installedAt: string;
}

// ── PluginLoader ────────────────────────────────────────────────────────────

export class PluginLoader {
  #events: EventBus;
  #storage: StorageAdapter;
  #pluginConfig: Record<string, Record<string, unknown>>;
  #log: Logger;

  #channelRegistry = new Map<string, ChannelProvider>();
  #llmRegistry = new Map<string, LLMProvider>();
  #toolRegistry = new Map<string, ToolProvider>();
  #loadedPlugins = new Map<string, Plugin>();

  constructor(
    events: EventBus,
    storage: StorageAdapter,
    pluginConfig: Record<string, Record<string, unknown>>,
  ) {
    this.#events = events;
    this.#storage = storage;
    this.#pluginConfig = pluginConfig;
    this.#log = createLogger("plugin-loader");
  }

  // ── Installation ────────────────────────────────────────────────────────

  /**
   * Install a plugin from a GitHub URL.
   * Fetches manifest.json, validates it, and persists to plugins.json.
   */
  async install(source: string, pluginsJsonPath: string): Promise<PluginManifest> {
    const manifestPath = toRawManifestUrl(source);
    this.#log.info("Fetching manifest", { url: manifestPath });

    let manifest: PluginManifest;
    if (isLocalPath(source)) {
      try {
        const text = await Deno.readTextFile(manifestPath);
        manifest = JSON.parse(text) as PluginManifest;
      } catch (err) {
        throw new PluginError(
          "unknown",
          "PLUGIN_MANIFEST_FETCH_FAILED",
          `Failed to read local manifest at ${manifestPath}: ${(err as Error).message}`,
        );
      }
    } else {
      const resp = await fetch(manifestPath);
      if (!resp.ok) {
        throw new PluginError(
          "unknown",
          "PLUGIN_MANIFEST_FETCH_FAILED",
          `Failed to fetch manifest: HTTP ${resp.status}`,
        );
      }
      manifest = (await resp.json()) as PluginManifest;
    }
    validateManifest(manifest);

    // Read existing plugins.json
    const installed = await readPluginsJson(pluginsJsonPath);

    // Store the source (local path or GitHub URL)
    installed[manifest.name] = {
      url: source,
      manifest,
      installedAt: new Date().toISOString(),
    };

    await writePluginsJson(pluginsJsonPath, installed);
    this.#log.info("Plugin installed", { name: manifest.name, version: manifest.version });
    return manifest;
  }

  /**
   * Uninstall a plugin: call unregister(), remove from plugins.json, clean storage.
   */
  async uninstall(name: string, pluginsJsonPath: string): Promise<void> {
    // Call unregister if loaded
    const plugin = this.#loadedPlugins.get(name);
    if (plugin?.unregister) {
      await plugin.unregister();
    }

    // Remove from registries
    this.#channelRegistry.delete(name);
    this.#llmRegistry.delete(name);
    this.#toolRegistry.delete(name);
    this.#loadedPlugins.delete(name);

    // Remove from plugins.json
    const installed = await readPluginsJson(pluginsJsonPath);
    delete installed[name];
    await writePluginsJson(pluginsJsonPath, installed);

    // Clean plugin storage (keys prefixed with "plugin:{name}:")
    await this.#cleanPluginStorage(name);

    this.#log.info("Plugin uninstalled", { name });
  }

  // ── Loading ─────────────────────────────────────────────────────────────

  /**
   * Load all plugins from plugins.json.
   * Emits "plugin:loaded" or "plugin:error" for each.
   */
  async loadAll(pluginsJsonPath: string): Promise<void> {
    const installed = await readPluginsJson(pluginsJsonPath);

    for (const [name, entry] of Object.entries(installed)) {
      try {
        await this.loadOne(name, entry);
        await this.#events.emit("plugin:loaded", { name, version: entry.manifest.version });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.#log.error("Plugin load failed", { name, error: error.message });
        await this.#events.emit("plugin:error", { name, error: error.message });
      }
    }
  }

  /**
   * Load a single plugin by dynamic import and register it.
   * Can also be used directly with an in-memory Plugin object (for testing).
   */
  async loadOne(
    name: string,
    entry: InstalledPlugin,
    moduleOverride?: Plugin,
  ): Promise<void> {
    const log = createLogger(`plugin:${name}`);

    // Dynamic import or use override
    let plugin: Plugin;
    if (moduleOverride) {
      plugin = moduleOverride;
    } else {
      const modUrl = toRawModUrl(entry.url);
      log.info("Importing plugin", { url: modUrl });
      const mod = await import(modUrl);
      plugin = mod.default as Plugin;
    }

    if (!plugin?.manifest || typeof plugin.register !== "function") {
      throw new PluginError(name, "PLUGIN_LOAD_FAILED", "Module does not export a valid Plugin");
    }

    validateManifest(plugin.manifest);

    // Build sandboxed PluginAPI
    const api = this.#buildPluginAPI(name, plugin.manifest, log);

    // Register
    await plugin.register(api);
    this.#loadedPlugins.set(name, plugin);
    log.info("Plugin registered", { type: plugin.manifest.type });
  }

  // ── Registry access ─────────────────────────────────────────────────────

  getChannel(name: string): ChannelProvider | undefined {
    return this.#channelRegistry.get(name);
  }

  getLLM(name: string): LLMProvider | undefined {
    return this.#llmRegistry.get(name);
  }

  getTool(name: string): ToolProvider | undefined {
    return this.#toolRegistry.get(name);
  }

  listChannels(): string[] {
    return [...this.#channelRegistry.keys()];
  }

  listLLMs(): string[] {
    return [...this.#llmRegistry.keys()];
  }

  listTools(): string[] {
    return [...this.#toolRegistry.keys()];
  }

  listLoaded(): string[] {
    return [...this.#loadedPlugins.keys()];
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  #buildPluginAPI(name: string, manifest: PluginManifest, log: Logger): PluginAPI {
    const events = this.#events;
    const storage = this.#storage;
    const storagePrefix = `plugin:${name}:`;
    const config = this.#pluginConfig[name] ?? {};
    const channelRegistry = this.#channelRegistry;
    const llmRegistry = this.#llmRegistry;
    const toolRegistry = this.#toolRegistry;

    const api: PluginAPI = {
      events: {
        on(event: string, handler: EventHandler): void {
          events.on(event as EventName, handler);
        },
        off(event: string, handler: EventHandler): void {
          events.off(event as EventName, handler);
        },
        emit(event: string, payload: unknown): void {
          events.emit(event as EventName, payload);
        },
      },
      storage: {
        get<T>(key: string): Promise<T | null> {
          return storage.get<T>(`${storagePrefix}${key}`);
        },
        set<T>(key: string, value: T): Promise<void> {
          return storage.set(`${storagePrefix}${key}`, value);
        },
        delete(key: string): Promise<boolean> {
          return storage.delete(`${storagePrefix}${key}`);
        },
        query<T>(collection: string, filter?: QueryFilter): Promise<T[]> {
          return storage.query<T>(collection, filter ?? {});
        },
      },
      config,
      log,
    };

    // Type-specific registration hooks
    if (manifest.type === "channel") {
      api.registerChannel = (channel: ChannelProvider) => {
        channelRegistry.set(channel.name, channel);
      };
    }
    if (manifest.type === "llm") {
      api.registerLLM = (llm: LLMProvider) => {
        llmRegistry.set(llm.name, llm);
      };
    }
    if (manifest.type === "tool") {
      api.registerTool = (tool: ToolProvider) => {
        toolRegistry.set(tool.name, tool);
      };
    }

    return api;
  }

  async #cleanPluginStorage(name: string): Promise<void> {
    // Query all keys in the plugin's namespace and delete them
    const prefix = `plugin:${name}:`;
    const rows = await this.#storage.query<{ key: string }>("plugin", {
      where: {},
    });
    for (const row of rows) {
      const key = typeof row === "object" && row !== null && "key" in row
        ? (row as { key: string }).key
        : undefined;
      if (key?.startsWith(prefix)) {
        await this.#storage.delete(key);
      }
    }
  }
}

// ── Manifest validation ───────────────────────────────────────────────────

const REQUIRED_MANIFEST_FIELDS: (keyof PluginManifest)[] = [
  "name",
  "version",
  "description",
  "author",
  "repository",
  "type",
  "permissions",
  "minCoreVersion",
];

const VALID_PLUGIN_TYPES = ["channel", "llm", "storage", "tool", "ui", "custom"];

export function validateManifest(manifest: unknown): asserts manifest is PluginManifest {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Manifest must be a non-null object");
  }

  const m = manifest as Record<string, unknown>;
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!(field in m) || m[field] === undefined || m[field] === null) {
      throw new Error(`Manifest missing required field: "${field}"`);
    }
  }

  if (typeof m.name !== "string" || m.name.length === 0) {
    throw new Error('Manifest "name" must be a non-empty string');
  }
  if (typeof m.version !== "string") {
    throw new Error('Manifest "version" must be a string');
  }
  if (!VALID_PLUGIN_TYPES.includes(m.type as string)) {
    throw new Error(`Manifest "type" must be one of: ${VALID_PLUGIN_TYPES.join(", ")}`);
  }
  if (typeof m.permissions !== "object") {
    throw new Error('Manifest "permissions" must be an object');
  }
}

// ── URL helpers ───────────────────────────────────────────────────────────

/** Check if a source string is a local file path (absolute or relative). */
export function isLocalPath(source: string): boolean {
  return source.startsWith("/") || source.startsWith("./") || source.startsWith("../");
}

/**
 * Convert a plugin source to a manifest URL or file path.
 * Supports GitHub URLs and local paths.
 */
export function toRawManifestUrl(source: string): string {
  if (isLocalPath(source)) {
    const resolved = source.startsWith("/") ? source : `${Deno.cwd()}/${source}`;
    return `${resolved}/manifest.json`;
  }
  const match = source.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error(`Invalid plugin source: ${source}`);
  const [, owner, repo] = match;
  return `https://raw.githubusercontent.com/${owner}/${repo}/main/manifest.json`;
}

/**
 * Convert a plugin source to a mod.ts import URL or file path.
 * Supports GitHub URLs and local paths.
 */
export function toRawModUrl(source: string): string {
  if (isLocalPath(source)) {
    const resolved = source.startsWith("/") ? source : `${Deno.cwd()}/${source}`;
    return `file://${resolved}/mod.ts`;
  }
  const match = source.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error(`Invalid plugin source: ${source}`);
  const [, owner, repo] = match;
  return `https://raw.githubusercontent.com/${owner}/${repo}/main/mod.ts`;
}

// ── plugins.json I/O ────────────────────────────────────────────────────

export async function readPluginsJson(
  path: string,
): Promise<Record<string, InstalledPlugin>> {
  try {
    const text = await Deno.readTextFile(path);
    return JSON.parse(text) as Record<string, InstalledPlugin>;
  } catch {
    return {};
  }
}

export async function writePluginsJson(
  path: string,
  data: Record<string, InstalledPlugin>,
): Promise<void> {
  await Deno.writeTextFile(path, JSON.stringify(data, null, 2) + "\n");
}
