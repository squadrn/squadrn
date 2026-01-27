import type { EventHandler } from "./events.ts";
import type { ChannelProvider } from "./channel.ts";
import type { LLMProvider } from "./llm.ts";

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  repository: string;
  type: "channel" | "llm" | "storage" | "tool" | "ui" | "custom";
  permissions: {
    net?: string[];
    read?: string[];
    write?: string[];
    env?: string[];
    run?: string[];
  };
  minCoreVersion: string;
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export interface PluginAPI {
  events: {
    on(event: string, handler: EventHandler): void;
    off(event: string, handler: EventHandler): void;
    emit(event: string, payload: unknown): void;
  };
  storage: {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<boolean>;
  };
  config: Record<string, unknown>;
  log: Logger;
  registerChannel?(channel: ChannelProvider): void;
  registerLLM?(llm: LLMProvider): void;
}

export interface Plugin {
  manifest: PluginManifest;
  register(core: PluginAPI): Promise<void>;
  unregister?(): Promise<void>;
}
