// ── Error codes ─────────────────────────────────────────────────────────────

export type ErrorCode =
  // Config
  | "CONFIG_READ_FAILED"
  | "CONFIG_PARSE_FAILED"
  | "CONFIG_VALIDATION_FAILED"
  // Plugin
  | "PLUGIN_LOAD_FAILED"
  | "PLUGIN_MANIFEST_INVALID"
  | "PLUGIN_MANIFEST_FETCH_FAILED"
  | "PLUGIN_NOT_FOUND"
  | "PLUGIN_REGISTER_FAILED"
  // Storage
  | "STORAGE_READ_FAILED"
  | "STORAGE_WRITE_FAILED"
  | "STORAGE_MIGRATION_FAILED"
  | "STORAGE_TRANSACTION_FAILED"
  // Agent
  | "AGENT_RUN_FAILED"
  | "AGENT_NOT_FOUND"
  | "AGENT_SOUL_MISSING"
  // Network
  | "NETWORK_REQUEST_FAILED"
  | "NETWORK_TIMEOUT"
  // Task
  | "TASK_NOT_FOUND"
  | "TASK_INVALID_TRANSITION"
  // Session
  | "SESSION_NOT_FOUND"
  // Scheduler
  | "SCHEDULER_CRON_INVALID"
  | "SCHEDULER_JOB_NOT_FOUND"
  // Notification
  | "NOTIFICATION_NOT_FOUND";

// ── Recovery suggestions ────────────────────────────────────────────────────

export const RECOVERY_SUGGESTIONS: Partial<Record<ErrorCode, string>> = {
  CONFIG_READ_FAILED:
    "Check that the config file exists and is readable. Run 'squadrn init' to create one.",
  CONFIG_PARSE_FAILED: "Check your config file for TOML syntax errors.",
  CONFIG_VALIDATION_FAILED: "Review the config values against the documentation.",
  PLUGIN_LOAD_FAILED: "Check that the plugin URL is correct and accessible.",
  PLUGIN_MANIFEST_INVALID: "Ensure the plugin has a valid manifest.json with all required fields.",
  PLUGIN_MANIFEST_FETCH_FAILED:
    "Verify the GitHub URL and that the repository contains a manifest.json.",
  PLUGIN_NOT_FOUND: "Run 'squadrn plugin list' to see installed plugins.",
  STORAGE_READ_FAILED: "Check that the database file exists and is not corrupted.",
  STORAGE_WRITE_FAILED: "Ensure the database file is writable and the disk is not full.",
  STORAGE_MIGRATION_FAILED: "The database may be corrupted. Try backing it up and reinitializing.",
  AGENT_RUN_FAILED: "Check the agent's LLM plugin configuration and API credentials.",
  AGENT_SOUL_MISSING: "Create a SOUL.md file for the agent.",
  NETWORK_REQUEST_FAILED: "Check your internet connection and verify the URL is correct.",
  NETWORK_TIMEOUT: "The request timed out. Try again or check the service status.",
  TASK_NOT_FOUND: "Run 'squadrn task list' to see existing tasks.",
  TASK_INVALID_TRANSITION:
    "Check valid task status transitions: inbox → assigned → in_progress → review → done.",
  SESSION_NOT_FOUND: "The session may have expired. Start a new agent session.",
  SCHEDULER_CRON_INVALID:
    "Use standard 5-field cron format: minute hour day-of-month month day-of-week.",
  SCHEDULER_JOB_NOT_FOUND: "The scheduled job may have been removed.",
  NOTIFICATION_NOT_FOUND: "The notification may have been deleted.",
};

// ── Base error ──────────────────────────────────────────────────────────────

export class SquadrnError extends Error {
  readonly code: ErrorCode;
  declare readonly cause?: Error;
  readonly context?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> },
  ) {
    super(message);
    this.name = "SquadrnError";
    this.code = code;
    this.cause = options?.cause;
    this.context = options?.context;
  }

  get suggestion(): string | undefined {
    return RECOVERY_SUGGESTIONS[this.code];
  }
}

// ── Domain errors ───────────────────────────────────────────────────────────

export class ConfigError extends SquadrnError {
  constructor(
    code: Extract<ErrorCode, `CONFIG_${string}`>,
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> },
  ) {
    super(code, message, options);
    this.name = "ConfigError";
  }
}

export class PluginError extends SquadrnError {
  readonly pluginName: string;

  constructor(
    pluginName: string,
    code: Extract<ErrorCode, `PLUGIN_${string}`>,
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> },
  ) {
    super(code, `Plugin "${pluginName}": ${message}`, options);
    this.name = "PluginError";
    this.pluginName = pluginName;
  }
}

export class StorageError extends SquadrnError {
  constructor(
    code: Extract<ErrorCode, `STORAGE_${string}`>,
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> },
  ) {
    super(code, message, options);
    this.name = "StorageError";
  }
}

export class AgentError extends SquadrnError {
  readonly agentId: string;

  constructor(
    agentId: string,
    code: Extract<ErrorCode, `AGENT_${string}`>,
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> },
  ) {
    super(code, `Agent "${agentId}": ${message}`, options);
    this.name = "AgentError";
    this.agentId = agentId;
  }
}

export class NetworkError extends SquadrnError {
  readonly url: string;
  readonly statusCode?: number;

  constructor(
    url: string,
    code: Extract<ErrorCode, `NETWORK_${string}`>,
    message: string,
    options?: { cause?: Error; statusCode?: number; context?: Record<string, unknown> },
  ) {
    super(code, message, options);
    this.name = "NetworkError";
    this.url = url;
    this.statusCode = options?.statusCode;
  }
}

export class TaskError extends SquadrnError {
  readonly taskId: string;

  constructor(
    taskId: string,
    code: Extract<ErrorCode, `TASK_${string}`>,
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> },
  ) {
    super(code, message, options);
    this.name = "TaskError";
    this.taskId = taskId;
  }
}

export class SessionError extends SquadrnError {
  readonly sessionId: string;

  constructor(
    sessionId: string,
    code: Extract<ErrorCode, `SESSION_${string}`>,
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> },
  ) {
    super(code, message, options);
    this.name = "SessionError";
    this.sessionId = sessionId;
  }
}

export class SchedulerError extends SquadrnError {
  constructor(
    code: Extract<ErrorCode, `SCHEDULER_${string}`>,
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> },
  ) {
    super(code, message, options);
    this.name = "SchedulerError";
  }
}

export class NotificationError extends SquadrnError {
  constructor(
    code: Extract<ErrorCode, `NOTIFICATION_${string}`>,
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> },
  ) {
    super(code, message, options);
    this.name = "NotificationError";
  }
}

// ── Formatting ──────────────────────────────────────────────────────────────

/**
 * Format any error for CLI display.
 * Shows the message, error code, recovery suggestion, and optionally stack trace.
 */
export function formatError(err: unknown, verbose = false): string {
  if (err instanceof SquadrnError) {
    const parts: string[] = [err.message];
    parts.push(`  Code: ${err.code}`);
    const suggestion = err.suggestion;
    if (suggestion) {
      parts.push(`  Hint: ${suggestion}`);
    }
    if (err.context && Object.keys(err.context).length > 0) {
      parts.push(`  Context: ${JSON.stringify(err.context)}`);
    }
    if (verbose && err.stack) {
      parts.push("");
      parts.push(err.stack);
    }
    if (verbose && err.cause) {
      parts.push(`  Caused by: ${err.cause.message}`);
    }
    return parts.join("\n");
  }

  if (err instanceof Error) {
    const parts: string[] = [err.message];
    if (verbose && err.stack) {
      parts.push("");
      parts.push(err.stack);
    }
    return parts.join("\n");
  }

  return String(err);
}
