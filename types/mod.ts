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
  Activity,
  ActivityId,
  ActivityType,
  Agent,
  AgentId,
  Comment,
  CommentId,
  Message,
  Notification,
  NotificationId,
  Result,
  SerializedAgent,
  Session,
  SessionContext,
  SessionId,
  Task,
  TaskId,
  WorkspaceId,
} from "./models.ts";

export {
  createActivityId,
  createAgentId,
  createCommentId,
  createNotificationId,
  createSessionId,
  createTaskId,
  deserializeAgent,
  serializeAgent,
} from "./models.ts";

// ── Events ──────────────────────────────────────────────────────────────────
export type { EventEmitter, EventHandler, EventName } from "./events.ts";

// ── Plugin system ───────────────────────────────────────────────────────────
export type {
  Logger,
  Plugin,
  PluginAPI,
  PluginManifest,
  PluginPermissions,
  PluginType,
} from "./plugin.ts";

// ── Channel plugins ─────────────────────────────────────────────────────────
export type { Attachment, ChannelProvider, IncomingMessage, OutgoingMessage } from "./channel.ts";

// ── LLM plugins ─────────────────────────────────────────────────────────────
export type {
  CompletionRequest,
  CompletionResponse,
  CompletionWithToolsResponse,
  LLMProvider,
  StreamChunk,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "./llm.ts";

// ── Tool plugins ────────────────────────────────────────────────────────────
export type { ToolExecutionResult, ToolProvider } from "./tool.ts";

// ── Configuration ───────────────────────────────────────────────────────────
export type {
  AgentConfig,
  GatewayConfig,
  LogLevel,
  SquadrnConfig,
  StorageConfig,
} from "./config.ts";

// ── Storage ─────────────────────────────────────────────────────────────────
export type { QueryFilter, StorageAdapter, Transaction } from "./storage.ts";
