/**
 * Anthropic Messages API client using native `fetch`.
 *
 * Handles completions, streaming (SSE), and tool use. Includes automatic
 * retry with exponential backoff for rate-limit (429) and server (5xx) errors.
 *
 * @module
 */

import type { Logger } from "@squadrn/types";
import type { AnthropicMessage, AnthropicTool } from "./formats.ts";
import type { ResponseContentBlock } from "./tools.ts";

const BASE_URL = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1_000;

/** Error thrown when the Anthropic API returns a non-OK response. */
export class AnthropicApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: string,
  ) {
    super(`Anthropic API error [${statusCode}]: ${body}`);
    this.name = "AnthropicApiError";
  }

  /** Whether this error is retryable (rate limit or server error). */
  get retryable(): boolean {
    return this.statusCode === 429 || this.statusCode >= 500;
  }
}

/** Shape of a successful Messages API response. */
export interface MessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: ResponseContentBlock[];
  model: string;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
  usage: { input_tokens: number; output_tokens: number };
}

/** Parameters for a Messages API request. */
export interface MessagesRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  temperature?: number;
  stop_sequences?: string[];
  tools?: AnthropicTool[];
  stream?: boolean;
}

export class AnthropicClient {
  readonly #apiKey: string;
  readonly #log: Logger;

  constructor(apiKey: string, log: Logger) {
    this.#apiKey = apiKey;
    this.#log = log;
  }

  /** Send a non-streaming completion request. */
  async createMessage(params: MessagesRequest): Promise<MessagesResponse> {
    return await this.#request<MessagesResponse>({ ...params, stream: false });
  }

  /**
   * Send a streaming completion request.
   * Returns the raw `ReadableStream` of SSE bytes for the caller to parse.
   */
  async createMessageStream(params: MessagesRequest): Promise<ReadableStream<Uint8Array>> {
    const body = JSON.stringify({ ...params, stream: true });
    const res = await this.#fetchWithRetry(body);

    if (!res.body) {
      throw new AnthropicApiError(res.status, "No response body for streaming request");
    }

    return res.body;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  async #request<T>(params: MessagesRequest): Promise<T> {
    const body = JSON.stringify(params);
    const res = await this.#fetchWithRetry(body);
    const text = await res.text();

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AnthropicApiError(res.status, text);
    }
  }

  async #fetchWithRetry(body: string): Promise<Response> {
    let lastError: AnthropicApiError | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = this.#retryDelay(attempt, lastError);
        this.#log.warn("Retrying Anthropic request", { attempt, delayMs: delay });
        await this.#sleep(delay);
      }

      const res = await fetch(`${BASE_URL}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.#apiKey,
          "anthropic-version": API_VERSION,
        },
        body,
      });

      if (res.ok) return res;

      const errBody = await res.text();
      lastError = new AnthropicApiError(res.status, errBody);

      if (!lastError.retryable || attempt === MAX_RETRIES) {
        throw lastError;
      }
    }

    // Unreachable, but TypeScript needs it
    throw lastError;
  }

  /** Compute retry delay, honouring `retry-after` header if present. */
  #retryDelay(attempt: number, error: AnthropicApiError | undefined): number {
    // Exponential backoff: 1s, 2s, 4s
    const exponential = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
    // Rate-limit errors from Anthropic sometimes include retry-after,
    // but since we only have the error body we use exponential backoff.
    void error;
    return exponential;
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
