import { parse as parseToml, stringify as stringifyToml } from "@std/toml";
import type { Result } from "@squadrn/types";

export interface GatewayConfig {
  host: string;
  port: number;
  log_level: "debug" | "info" | "warn" | "error";
}

export interface StorageConfig {
  adapter: string;
  path: string;
}

export interface AgentConfig {
  name: string;
  role: string;
  llm: string;
  channels: string[];
  heartbeat: string;
  soul_file: string;
}

export interface SquadrnConfig {
  gateway: GatewayConfig;
  storage: StorageConfig;
  agents: Record<string, AgentConfig>;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

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

export async function loadConfig(path: string): Promise<Result<SquadrnConfig, ConfigError>> {
  try {
    const text = await Deno.readTextFile(path);
    const parsed = parseToml(text) as unknown as SquadrnConfig;
    return { ok: true, value: { ...DEFAULT_CONFIG, ...parsed } };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return { ok: false, error: new ConfigError(`Config file not found: ${path}`) };
    }
    return { ok: false, error: new ConfigError(`Failed to parse config: ${(err as Error).message}`) };
  }
}

export function serializeConfig(config: SquadrnConfig): string {
  return stringifyToml(config as unknown as Record<string, unknown>);
}
