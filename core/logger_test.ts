import { assertEquals, assertStringIncludes } from "@std/assert";
import { createLogger, StructuredLogger } from "./logger.ts";

function captureOutput(): { lines: string[]; output: (line: string) => void } {
  const lines: string[] = [];
  return { lines, output: (line: string) => lines.push(line) };
}

Deno.test("createLogger - returns a Logger instance", () => {
  const log = createLogger("test");
  assertEquals(typeof log.debug, "function");
  assertEquals(typeof log.info, "function");
  assertEquals(typeof log.warn, "function");
  assertEquals(typeof log.error, "function");
});

Deno.test("JSON mode - outputs valid JSON with required fields", () => {
  const { lines, output } = captureOutput();
  const log = createLogger("gateway", { devMode: false, output });

  log.info("Started", { port: 18900 });

  assertEquals(lines.length, 1);
  const entry = JSON.parse(lines[0]!);
  assertEquals(entry.level, "info");
  assertEquals(entry.namespace, "gateway");
  assertEquals(entry.message, "Started");
  assertEquals(entry.port, 18900);
  assertEquals(typeof entry.timestamp, "string");
});

Deno.test("JSON mode - includes extra data fields", () => {
  const { lines, output } = captureOutput();
  const log = createLogger("plugin", { devMode: false, output });

  log.error("Connection failed", { error: "timeout", retry: 3 });

  const entry = JSON.parse(lines[0]!);
  assertEquals(entry.error, "timeout");
  assertEquals(entry.retry, 3);
});

Deno.test("pretty mode - includes level, namespace, and message", () => {
  const { lines, output } = captureOutput();
  const log = createLogger("scheduler", { devMode: true, output });

  log.warn("Job delayed", { jobId: "abc" });

  assertEquals(lines.length, 1);
  assertStringIncludes(lines[0]!, "WARN");
  assertStringIncludes(lines[0]!, "[scheduler]");
  assertStringIncludes(lines[0]!, "Job delayed");
  assertStringIncludes(lines[0]!, "jobId");
});

Deno.test("minLevel - filters out lower levels", () => {
  const { lines, output } = captureOutput();
  const log = createLogger("core", { minLevel: "warn", devMode: false, output });

  log.debug("ignored");
  log.info("ignored");
  log.warn("kept");
  log.error("kept");

  assertEquals(lines.length, 2);
  assertStringIncludes(lines[0]!, "warn");
  assertStringIncludes(lines[1]!, "error");
});

Deno.test("no extra data - works without optional data parameter", () => {
  const { lines, output } = captureOutput();
  const log = createLogger("test", { devMode: false, output });

  log.info("Simple message");

  const entry = JSON.parse(lines[0]!);
  assertEquals(entry.message, "Simple message");
  assertEquals(entry.level, "info");
  assertEquals(entry.namespace, "test");
});

Deno.test("StructuredLogger is exported for direct use", () => {
  const { lines, output } = captureOutput();
  const log = new StructuredLogger("direct", { devMode: false, output });

  log.debug("test");
  assertEquals(lines.length, 1);
});
