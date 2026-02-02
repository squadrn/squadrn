import type { Logger } from "@squadrn/types";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[36m", // cyan
  info: "\x1b[32m", // green
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
};

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

function detectDevMode(): boolean {
  try {
    const env = Deno.env.get("SQUADRN_ENV");
    if (env === "development") return true;
    if (env === "production") return false;
  } catch {
    // Permission denied — default to production
  }
  try {
    return Deno.args.includes("--dev");
  } catch {
    return false;
  }
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  namespace: string;
  message: string;
  [key: string]: unknown;
}

function formatJson(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function formatPretty(entry: LogEntry): string {
  const { timestamp, level, namespace, message, ...extra } = entry;
  const color = LEVEL_COLORS[level];
  const tag = level.toUpperCase().padEnd(5);
  const extraStr = Object.keys(extra).length > 0 ? ` ${DIM}${JSON.stringify(extra)}${RESET}` : "";
  return `${DIM}${timestamp}${RESET} ${color}${tag}${RESET} ${DIM}[${namespace}]${RESET} ${message}${extraStr}`;
}

export class StructuredLogger implements Logger {
  #namespace: string;
  #minLevel: LogLevel;
  #devMode: boolean;
  #output: (line: string) => void;

  constructor(
    namespace: string,
    options?: {
      minLevel?: LogLevel;
      devMode?: boolean;
      output?: (line: string) => void;
    },
  ) {
    this.#namespace = namespace;
    this.#minLevel = options?.minLevel ?? "debug";
    this.#devMode = options?.devMode ?? detectDevMode();
    this.#output = options?.output ?? ((line: string) => console.log(line));
  }

  #log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.#minLevel]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      namespace: this.#namespace,
      message,
      ...data,
    };

    const line = this.#devMode ? formatPretty(entry) : formatJson(entry);
    this.#output(line);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.#log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.#log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.#log("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.#log("error", message, data);
  }
}

export function createLogger(
  namespace: string,
  options?: {
    minLevel?: LogLevel;
    devMode?: boolean;
    output?: (line: string) => void;
  },
): Logger {
  return new StructuredLogger(namespace, options);
}
