/** Configuration types for Squadrn. */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface GatewayConfig {
  host: string;
  port: number;
  log_level: LogLevel;
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
  plugins?: Record<string, Record<string, unknown>>;
}
