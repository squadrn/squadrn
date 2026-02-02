// ── Errors (centralized) ────────────────────────────────────────────────────
export {
  AgentError,
  ConfigError,
  formatError,
  NetworkError,
  NotificationError,
  PluginError,
  RECOVERY_SUGGESTIONS,
  SchedulerError,
  SessionError,
  SquadrnError,
  StorageError,
  TaskError,
} from "./errors.ts";
export type { ErrorCode } from "./errors.ts";

// ── Backward-compatible aliases ─────────────────────────────────────────────
export { PluginLoadError } from "./plugin_loader.ts";
export { AgentRunError } from "./agent_runner.ts";
export { SessionNotFoundError } from "./session_manager.ts";
export { InvalidTransitionError, TaskNotFoundError } from "./task_manager.ts";
export { CronParseError, JobNotFoundError } from "./scheduler.ts";
export { NotificationNotFoundError } from "./notification_manager.ts";

// ── Core components ─────────────────────────────────────────────────────────
export { Gateway } from "./gateway.ts";
export type { GatewayCommand, GatewayResponse, GatewayStatus } from "./gateway.ts";
export { GatewayClient } from "./gateway_client.ts";
export { cleanupIpcFiles, IS_WINDOWS, isProcessAlive, needsSocketCleanup } from "./ipc.ts";
export { EventBus } from "./event_bus.ts";
export {
  ConfigManager,
  createDefaultConfig,
  defaultConfig,
  loadConfig,
  serializeConfig,
} from "./config_manager.ts";
export type {
  AgentConfig,
  GatewayConfig,
  LogLevel,
  SquadrnConfig,
  StorageConfig,
} from "./config_manager.ts";
export type { QueryFilter, StorageAdapter, Transaction } from "./storage/adapter.ts";
export { SqliteStorage } from "./storage/sqlite.ts";
export { createLogger, StructuredLogger } from "./logger.ts";
export {
  isLocalPath,
  PluginLoader,
  readPluginsJson,
  toRawManifestUrl,
  validateManifest,
  writePluginsJson,
} from "./plugin_loader.ts";
export type { InstalledPlugin } from "./plugin_loader.ts";
export { SessionManager } from "./session_manager.ts";
export { AgentRunner, parseMentions, parseWorkingMemoryUpdates } from "./agent_runner.ts";
export type { AgentRunnerOptions } from "./agent_runner.ts";
export { nextCronDate, parseCron, Scheduler } from "./scheduler.ts";
export type { ScheduledJob } from "./scheduler.ts";
export { TaskManager } from "./task_manager.ts";
export type { AddCommentData, CreateTaskData, TaskFilter } from "./task_manager.ts";
export {
  NotificationManager,
  parseMentions as parseNotificationMentions,
} from "./notification_manager.ts";
export type { CreateNotificationData } from "./notification_manager.ts";
export { ActivityManager } from "./activity_manager.ts";
export type { ActivityFilter, RecordActivityData } from "./activity_manager.ts";
