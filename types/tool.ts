/**
 * Tool plugin types for Squadrn.
 *
 * A tool plugin exposes a capability that agents can invoke during their reasoning
 * (e.g. web search, code execution, file manipulation). Tools are registered via
 * `core.registerTool()` and made available to LLM providers as function definitions.
 *
 * @module
 */

import type { ToolDefinition } from "./llm.ts";

/**
 * Interface that tool plugins must implement and register via `core.registerTool()`.
 *
 * A tool provider declares its schema (as a {@link ToolDefinition}) and implements
 * an `execute` method that the gateway calls when an agent invokes the tool.
 *
 * @example
 * ```ts
 * const tool: ToolProvider = {
 *   name: "web_search",
 *   definition: {
 *     name: "web_search",
 *     description: "Search the web for information",
 *     parameters: {
 *       type: "object",
 *       properties: { query: { type: "string" } },
 *       required: ["query"],
 *     },
 *   },
 *   async execute(args) {
 *     const results = await search(args.query as string);
 *     return { content: JSON.stringify(results) };
 *   },
 * };
 * ```
 */
export interface ToolProvider {
  /** Unique name that identifies this tool (e.g. `"web_search"`, `"code_exec"`). */
  name: string;

  /**
   * JSON Schema definition sent to the LLM so it knows how to invoke this tool.
   */
  definition: ToolDefinition;

  /**
   * Execute the tool with the given arguments.
   *
   * @param args - Parsed arguments matching {@link ToolDefinition.parameters}.
   * @returns The tool's output. Set `isError` to `true` if execution failed.
   */
  execute(args: Record<string, unknown>): Promise<ToolExecutionResult>;
}

/**
 * The result returned by a {@link ToolProvider.execute} call.
 */
export interface ToolExecutionResult {
  /** Serialised output of the tool execution. */
  content: string;

  /** Whether the execution failed. The LLM may retry or adjust its approach. */
  isError?: boolean;
}
