/**
 * @squadrn/types — Public type definitions for the Squadrn plugin system.
 *
 * Plugin authors should import all types from this single entry point:
 *
 * ```ts
 * import type { Plugin, PluginAPI, ChannelProvider } from "@squadrn/types";
 * ```
 *
 * Published at: https://jsr.io/@squadrn/types
 *
 * @module
 */

// ── Models (branded IDs, core entities) ─────────────────────────────────────
export type {
  AgentId,
  TaskId,
  SessionId,
  WorkspaceId,
  Agent,
  Message,
  SessionContext,
  Session,
  Task,
  Result,
  SerializedAgent,
} from "./models.ts";

export {
  createAgentId,
  createSessionId,
  serializeAgent,
  deserializeAgent,
} from "./models.ts";

// ── Events ──────────────────────────────────────────────────────────────────
export type { EventName, EventHandler, EventEmitter } from "./events.ts";

// ── Plugin system ───────────────────────────────────────────────────────────
export type {
  PluginType,
  PluginPermissions,
  PluginManifest,
  Logger,
  PluginAPI,
  Plugin,
} from "./plugin.ts";

// ── Channel plugins ─────────────────────────────────────────────────────────
export type {
  Attachment,
  IncomingMessage,
  OutgoingMessage,
  ChannelProvider,
} from "./channel.ts";

// ── LLM plugins ─────────────────────────────────────────────────────────────
export type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  CompletionRequest,
  CompletionResponse,
  CompletionWithToolsResponse,
  StreamChunk,
  LLMProvider,
} from "./llm.ts";

// ── Tool plugins ────────────────────────────────────────────────────────────
export type {
  ToolProvider,
  ToolExecutionResult,
} from "./tool.ts";

// ── Configuration ───────────────────────────────────────────────────────────
export type {
  LogLevel,
  GatewayConfig,
  StorageConfig,
  AgentConfig,
  SquadrnConfig,
} from "./config.ts";

// ── Storage ─────────────────────────────────────────────────────────────────
export type {
  QueryFilter,
  Transaction,
  StorageAdapter,
} from "./storage.ts";
