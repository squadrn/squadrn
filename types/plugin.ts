/**
 * Plugin system types for Squadrn.
 *
 * These types define the contract between Squadrn's core gateway and external plugins.
 * Plugin authors import these types to build channel, LLM, storage, tool, UI, or custom plugins.
 *
 * @module
 */

import type { EventHandler } from "./events.ts";
import type { ChannelProvider } from "./channel.ts";
import type { LLMProvider } from "./llm.ts";
import type { ToolProvider } from "./tool.ts";

/**
 * Supported plugin categories.
 *
 * - `"channel"` — Messaging integrations (Telegram, Slack, Discord).
 * - `"llm"` — Language model backends (Claude, OpenAI, Ollama).
 * - `"storage"` — Persistence engines (Postgres, Redis).
 * - `"tool"` — Capabilities agents can invoke (web search, code execution).
 * - `"ui"` — Dashboards and monitoring interfaces.
 * - `"custom"` — Anything that doesn't fit the categories above.
 */
export type PluginType = "channel" | "llm" | "storage" | "tool" | "ui" | "custom";

/**
 * Deno permissions a plugin requires to operate.
 *
 * Declared upfront in the plugin manifest so users can audit permissions
 * before installing. The gateway enforces these at load time.
 */
export interface PluginPermissions {
  /** Allowed network domains (e.g. `["api.telegram.org"]`). */
  net?: string[];
  /** File-system paths the plugin may read (e.g. `["~/.squadrn/"]`). */
  read?: string[];
  /** File-system paths the plugin may write. */
  write?: string[];
  /** Environment variables the plugin needs (e.g. `["TELEGRAM_BOT_TOKEN"]`). */
  env?: string[];
  /** Executables the plugin may spawn. */
  run?: string[];
}

/**
 * Metadata that every plugin must declare in its `manifest.json`.
 *
 * The gateway reads this manifest when the plugin is installed
 * (`squadrn plugin add <url>`) and again when the plugin is loaded at startup.
 *
 * @example
 * ```json
 * {
 *   "name": "@squadrn/channel-telegram",
 *   "version": "1.0.0",
 *   "description": "Telegram channel for Squadrn",
 *   "author": "Squadrn",
 *   "repository": "https://github.com/squadrn/channel-telegram",
 *   "type": "channel",
 *   "permissions": { "net": ["api.telegram.org"], "env": ["TELEGRAM_BOT_TOKEN"] },
 *   "minCoreVersion": "0.1.0"
 * }
 * ```
 */
export interface PluginManifest {
  /** Unique plugin name, conventionally scoped (e.g. `"@squadrn/channel-telegram"`). */
  name: string;
  /** SemVer version string. */
  version: string;
  /** Human-readable summary of what the plugin does. */
  description: string;
  /** Plugin author or organisation. */
  author: string;
  /** URL of the plugin's source repository. */
  repository: string;
  /** Category that determines which registration hooks are available. */
  type: PluginType;
  /** Deno permissions required by this plugin. */
  permissions: PluginPermissions;
  /** Minimum Squadrn core version this plugin is compatible with (SemVer). */
  minCoreVersion: string;
}

/**
 * Structured logger provided to each plugin.
 *
 * All log entries are tagged with the plugin name automatically.
 * In production the output is JSON; in development it is pretty-printed.
 */
export interface Logger {
  /** Verbose output useful during development. */
  debug(msg: string, data?: Record<string, unknown>): void;
  /** Normal operational messages. */
  info(msg: string, data?: Record<string, unknown>): void;
  /** Potentially harmful situations that don't prevent operation. */
  warn(msg: string, data?: Record<string, unknown>): void;
  /** Errors that may require intervention. */
  error(msg: string, data?: Record<string, unknown>): void;
}

/**
 * Sandboxed API surface exposed to a plugin during registration.
 *
 * Each plugin receives its own `PluginAPI` instance with:
 * - **Namespaced storage** — keys are automatically prefixed so plugins can't collide.
 * - **Scoped event access** — plugins can subscribe to and emit gateway events.
 * - **Read-only config** — only the plugin's own config section.
 * - **Registration hooks** — type-specific methods (`registerChannel`, `registerLLM`, `registerTool`)
 *   that are present only when the plugin's declared type matches.
 */
export interface PluginAPI {
  /**
   * Event bus access for subscribing to and emitting gateway events.
   *
   * @example
   * ```ts
   * core.events.on("message:received", async (payload) => { ... });
   * core.events.emit("message:send", { chatId, content });
   * ```
   */
  events: {
    /** Subscribe to an event. */
    on(event: string, handler: EventHandler): void;
    /** Unsubscribe from an event. */
    off(event: string, handler: EventHandler): void;
    /** Emit an event to all subscribers. */
    emit(event: string, payload: unknown): void;
  };

  /**
   * Key-value storage namespaced to this plugin.
   *
   * Keys are automatically prefixed with the plugin name, so
   * `storage.get("state")` in `@squadrn/channel-telegram` resolves
   * to the key `"plugin:channel-telegram:state"` in the underlying store.
   */
  storage: {
    /** Retrieve a value by key, or `null` if not found. */
    get<T>(key: string): Promise<T | null>;
    /** Store a value under the given key. */
    set<T>(key: string, value: T): Promise<void>;
    /** Delete a key. Returns `true` if the key existed. */
    delete(key: string): Promise<boolean>;
  };

  /** Read-only configuration for this plugin (from `config.toml`). */
  config: Record<string, unknown>;

  /** Structured logger tagged with the plugin name. */
  log: Logger;

  /**
   * Register a channel provider. Only available when `manifest.type === "channel"`.
   *
   * @param channel - The channel provider to register.
   */
  registerChannel?(channel: ChannelProvider): void;

  /**
   * Register an LLM provider. Only available when `manifest.type === "llm"`.
   *
   * @param llm - The LLM provider to register.
   */
  registerLLM?(llm: LLMProvider): void;

  /**
   * Register a tool provider. Only available when `manifest.type === "tool"`.
   *
   * @param tool - The tool provider to register.
   */
  registerTool?(tool: ToolProvider): void;
}

/**
 * The interface every Squadrn plugin must implement.
 *
 * A plugin's default export must satisfy this interface.
 *
 * @example
 * ```ts
 * import type { Plugin, PluginAPI } from "@squadrn/types";
 * import manifest from "./manifest.json" with { type: "json" };
 *
 * const plugin: Plugin = {
 *   manifest,
 *   async register(core: PluginAPI) {
 *     core.log.info("Hello from my plugin!");
 *   },
 * };
 *
 * export default plugin;
 * ```
 */
export interface Plugin {
  /** Static metadata loaded from `manifest.json`. */
  manifest: PluginManifest;

  /**
   * Called once when the gateway loads this plugin.
   *
   * Use this to initialise connections, register providers, and subscribe to events.
   *
   * @param core - Sandboxed API for interacting with the gateway.
   */
  register(core: PluginAPI): Promise<void>;

  /**
   * Called when the gateway is shutting down.
   *
   * Use this to close connections and release resources gracefully.
   * Optional — if omitted, the gateway assumes no cleanup is needed.
   */
  unregister?(): Promise<void>;
}
