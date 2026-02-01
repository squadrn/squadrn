/**
 * LLM plugin types for Squadrn.
 *
 * An LLM plugin wraps a language model backend (Claude, OpenAI, Ollama, etc.)
 * and exposes a uniform completion interface to the gateway.
 *
 * @module
 */

import type { Message } from "./models.ts";

/**
 * JSON Schema description of a tool/function that an LLM can invoke.
 *
 * Used with {@link LLMProvider.completeWithTools} to enable function-calling.
 */
export interface ToolDefinition {
  /** Unique name the LLM uses to reference this tool (e.g. `"web_search"`). */
  name: string;

  /** Human-readable description of what the tool does. Sent to the LLM as context. */
  description: string;

  /**
   * JSON Schema object describing the tool's input parameters.
   *
   * @example
   * ```json
   * {
   *   "type": "object",
   *   "properties": {
   *     "query": { "type": "string", "description": "Search query" }
   *   },
   *   "required": ["query"]
   * }
   * ```
   */
  parameters: Record<string, unknown>;
}

/**
 * A tool invocation requested by the LLM during a completion.
 *
 * The gateway executes the tool and feeds the result back via {@link ToolResult}.
 */
export interface ToolCall {
  /** Unique identifier for this call, used to correlate with {@link ToolResult}. */
  id: string;

  /** Name of the tool to invoke (must match a {@link ToolDefinition.name}). */
  name: string;

  /** Arguments for the tool, parsed from the LLM's JSON output. */
  arguments: Record<string, unknown>;
}

/**
 * The result of executing a {@link ToolCall}, fed back to the LLM.
 */
export interface ToolResult {
  /** The {@link ToolCall.id} this result corresponds to. */
  callId: string;

  /** Serialised output of the tool execution. */
  content: string;

  /** Whether the tool execution failed. The LLM may retry or adjust. */
  isError?: boolean;
}

/**
 * A request sent to an LLM provider for text completion.
 */
export interface CompletionRequest {
  /**
   * Model identifier to use (e.g. `"claude-sonnet-4-20250514"`, `"gpt-4o"`).
   * If omitted, the plugin uses its configured default.
   */
  model?: string;

  /** Conversation messages forming the prompt. */
  messages: Message[];

  /** Maximum number of tokens to generate. */
  maxTokens?: number;

  /**
   * Sampling temperature (0–2). Lower values are more deterministic,
   * higher values are more creative.
   */
  temperature?: number;

  /** Sequences that cause the model to stop generating. */
  stopSequences?: string[];
}

/**
 * The result of a standard text completion (no tool use).
 */
export interface CompletionResponse {
  /** Generated text content. */
  content: string;

  /** Token usage statistics for billing and monitoring. */
  usage: {
    /** Number of tokens in the prompt. */
    inputTokens: number;
    /** Number of tokens generated. */
    outputTokens: number;
  };

  /** Why the model stopped generating. */
  stopReason: "end" | "max_tokens" | "stop_sequence";
}

/**
 * The result of a completion that may include tool calls.
 *
 * When `toolCalls` is non-empty, the gateway should execute the tools
 * and feed the results back to the LLM in a follow-up request.
 */
export interface CompletionWithToolsResponse {
  /** Generated text content (may be empty if the model only produced tool calls). */
  content: string;

  /** Token usage statistics. */
  usage: {
    /** Number of tokens in the prompt. */
    inputTokens: number;
    /** Number of tokens generated. */
    outputTokens: number;
  };

  /** Why the model stopped generating. */
  stopReason: "end" | "max_tokens" | "stop_sequence" | "tool_use";

  /** Tool invocations requested by the model. Empty array if none. */
  toolCalls: ToolCall[];
}

/**
 * A single chunk in a streaming completion response.
 */
export interface StreamChunk {
  /** Incremental text content. */
  content: string;

  /** `true` when this is the final chunk and the stream is complete. */
  done: boolean;
}

/**
 * Interface that LLM plugins must implement and register via `core.registerLLM()`.
 *
 * @example
 * ```ts
 * const llm: LLMProvider = {
 *   name: "claude",
 *   supportsTools: true,
 *   async complete(req) { ... },
 *   async *stream(req) { ... },
 *   async completeWithTools(req, tools) { ... },
 * };
 * ```
 */
export interface LLMProvider {
  /** Unique name that identifies this LLM backend (e.g. `"claude"`, `"openai"`). */
  name: string;

  /**
   * Perform a text completion.
   *
   * @param request - The completion request with messages and parameters.
   * @returns The model's response.
   */
  complete(request: CompletionRequest): Promise<CompletionResponse>;

  /**
   * Stream a completion token-by-token.
   *
   * Optional — if not implemented, the gateway falls back to non-streaming `complete()`.
   *
   * @param request - The completion request.
   * @returns An async iterable of chunks.
   */
  stream?(request: CompletionRequest): AsyncIterable<StreamChunk>;

  /** Whether this provider supports function/tool calling. */
  supportsTools: boolean;

  /**
   * Perform a completion with tool-use capabilities.
   *
   * Only required when `supportsTools` is `true`.
   *
   * @param request - The completion request.
   * @param tools - Available tool definitions the model may invoke.
   * @returns The model's response, potentially including tool calls.
   */
  completeWithTools?(
    request: CompletionRequest,
    tools: ToolDefinition[],
  ): Promise<CompletionWithToolsResponse>;
}
