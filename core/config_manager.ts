import { parse as parseToml, stringify as stringifyToml } from "@std/toml";
import type { Result } from "@squadrn/types";
import type {
  AgentConfig,
  GatewayConfig,
  LogLevel,
  SquadrnConfig,
  StorageConfig,
} from "@squadrn/types/config";

export type { AgentConfig, GatewayConfig, LogLevel, SquadrnConfig, StorageConfig };

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const VALID_LOG_LEVELS: ReadonlySet<string> = new Set(["debug", "info", "warn", "error"]);

const DEFAULT_CONFIG: SquadrnConfig = {
  gateway: {
    host: "127.0.0.1",
    port: 18900,
    log_level: "info",
  },
  storage: {
    adapter: "sqlite",
    path: "~/.squadrn/data.db",
  },
  agents: {},
};

export function defaultConfig(): SquadrnConfig {
  return structuredClone(DEFAULT_CONFIG);
}

/** Validate a parsed config object, returning a list of errors. */
function validate(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];

  // gateway
  const gw = raw["gateway"];
  if (gw !== undefined) {
    if (typeof gw !== "object" || gw === null || Array.isArray(gw)) {
      errors.push("[gateway] must be a table");
    } else {
      const g = gw as Record<string, unknown>;
      if (g["host"] !== undefined && typeof g["host"] !== "string") {
        errors.push("[gateway.host] must be a string");
      }
      if (g["port"] !== undefined) {
        if (typeof g["port"] !== "number" || !Number.isInteger(g["port"])) {
          errors.push("[gateway.port] must be an integer");
        } else if (g["port"] < 1 || g["port"] > 65535) {
          errors.push("[gateway.port] must be between 1 and 65535");
        }
      }
      if (g["log_level"] !== undefined) {
        if (typeof g["log_level"] !== "string" || !VALID_LOG_LEVELS.has(g["log_level"])) {
          errors.push(`[gateway.log_level] must be one of: debug, info, warn, error`);
        }
      }
    }
  }

  // storage
  const st = raw["storage"];
  if (st !== undefined) {
    if (typeof st !== "object" || st === null || Array.isArray(st)) {
      errors.push("[storage] must be a table");
    } else {
      const s = st as Record<string, unknown>;
      if (s["adapter"] !== undefined && typeof s["adapter"] !== "string") {
        errors.push("[storage.adapter] must be a string");
      }
      if (s["path"] !== undefined && typeof s["path"] !== "string") {
        errors.push("[storage.path] must be a string");
      }
    }
  }

  // agents
  const ag = raw["agents"];
  if (ag !== undefined) {
    if (typeof ag !== "object" || ag === null || Array.isArray(ag)) {
      errors.push("[agents] must be a table");
    } else {
      for (const [key, val] of Object.entries(ag)) {
        if (typeof val !== "object" || val === null || Array.isArray(val)) {
          errors.push(`[agents.${key}] must be a table`);
          continue;
        }
        const a = val as Record<string, unknown>;
        if (typeof a["name"] !== "string") {
          errors.push(`[agents.${key}.name] is required and must be a string`);
        }
        if (typeof a["role"] !== "string") {
          errors.push(`[agents.${key}.role] is required and must be a string`);
        }
        if (typeof a["llm"] !== "string") {
          errors.push(`[agents.${key}.llm] is required and must be a string`);
        }
        if (!Array.isArray(a["channels"])) {
          errors.push(`[agents.${key}.channels] is required and must be an array`);
        }
        if (typeof a["heartbeat"] !== "string") {
          errors.push(`[agents.${key}.heartbeat] is required and must be a string`);
        }
        if (typeof a["soul_file"] !== "string") {
          errors.push(`[agents.${key}.soul_file] is required and must be a string`);
        }
      }
    }
  }

  return errors;
}

/** Merge parsed TOML with defaults, producing a typed config. */
function mergeWithDefaults(raw: Record<string, unknown>): SquadrnConfig {
  const def = defaultConfig();
  const rawGw = (raw["gateway"] ?? {}) as Record<string, unknown>;
  const rawSt = (raw["storage"] ?? {}) as Record<string, unknown>;
  const rawAg = (raw["agents"] ?? {}) as Record<string, Record<string, unknown>>;

  return {
    gateway: {
      host: (rawGw["host"] as string | undefined) ?? def.gateway.host,
      port: (rawGw["port"] as number | undefined) ?? def.gateway.port,
      log_level: (rawGw["log_level"] as LogLevel | undefined) ?? def.gateway.log_level,
    },
    storage: {
      adapter: (rawSt["adapter"] as string | undefined) ?? def.storage.adapter,
      path: (rawSt["path"] as string | undefined) ?? def.storage.path,
    },
    agents: Object.fromEntries(
      Object.entries(rawAg).map(([key, val]) => [key, {
        name: val["name"] as string,
        role: val["role"] as string,
        llm: val["llm"] as string,
        channels: val["channels"] as string[],
        heartbeat: val["heartbeat"] as string,
        soul_file: val["soul_file"] as string,
      }]),
    ),
  };
}

/** Load and validate a config file. Returns defaults if file not found. */
export async function loadConfig(
  path: string,
): Promise<Result<SquadrnConfig, ConfigError>> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return { ok: true, value: defaultConfig() };
    }
    return {
      ok: false,
      error: new ConfigError(`Failed to read config: ${(err as Error).message}`),
    };
  }

  let raw: Record<string, unknown>;
  try {
    raw = parseToml(text) as Record<string, unknown>;
  } catch (err) {
    return {
      ok: false,
      error: new ConfigError(`Invalid TOML: ${(err as Error).message}`),
    };
  }

  const errors = validate(raw);
  if (errors.length > 0) {
    return {
      ok: false,
      error: new ConfigError(`Config validation failed:\n  - ${errors.join("\n  - ")}`),
    };
  }

  return { ok: true, value: mergeWithDefaults(raw) };
}

export function serializeConfig(config: SquadrnConfig): string {
  return stringifyToml(config as unknown as Record<string, unknown>);
}

/** Writes default config to disk. No-op if file already exists. */
export async function createDefaultConfig(path: string): Promise<void> {
  try {
    await Deno.stat(path);
    // File exists, don't overwrite
  } catch {
    const dir = path.substring(0, path.lastIndexOf("/"));
    if (dir) {
      await Deno.mkdir(dir, { recursive: true });
    }
    await Deno.writeTextFile(path, serializeConfig(defaultConfig()));
  }
}

/**
 * Stateful config manager. Holds the current config, supports reload.
 */
export class ConfigManager {
  #config: SquadrnConfig;
  #path: string;

  private constructor(config: SquadrnConfig, path: string) {
    this.#config = config;
    this.#path = path;
  }

  /** Load config from path. Returns defaults if file missing. */
  static async load(path: string): Promise<Result<ConfigManager, ConfigError>> {
    const result = await loadConfig(path);
    if (!result.ok) return result;
    return { ok: true, value: new ConfigManager(result.value, path) };
  }

  /** Create a ConfigManager with default config (no file needed). */
  static fromDefaults(path: string): ConfigManager {
    return new ConfigManager(defaultConfig(), path);
  }

  get config(): SquadrnConfig {
    return this.#config;
  }

  get path(): string {
    return this.#path;
  }

  /** Reload config from disk. */
  async reload(): Promise<Result<SquadrnConfig, ConfigError>> {
    const result = await loadConfig(this.#path);
    if (result.ok) {
      this.#config = result.value;
    }
    return result;
  }
}
