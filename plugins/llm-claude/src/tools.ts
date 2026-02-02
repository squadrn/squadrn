/**
 * Helpers for extracting tool-use information from Anthropic API responses.
 *
 * @module
 */

import type { ToolCall } from "@squadrn/types";

// ── Anthropic response content blocks ─────────────────────────────────────────

/** A text block in the response. */
export interface TextBlock {
  type: "text";
  text: string;
}

/** A tool_use block in the response. */
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Union of possible content blocks in a Messages API response. */
export type ResponseContentBlock = TextBlock | ToolUseBlock;

// ── Extraction ────────────────────────────────────────────────────────────────

/** Extract concatenated text from response content blocks. */
export function extractText(blocks: ResponseContentBlock[]): string {
  return blocks
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Convert Anthropic tool_use blocks into Squadrn `ToolCall[]`. */
export function extractToolCalls(blocks: ResponseContentBlock[]): ToolCall[] {
  return blocks
    .filter((b): b is ToolUseBlock => b.type === "tool_use")
    .map((b) => ({
      id: b.id,
      name: b.name,
      arguments: b.input,
    }));
}

// ── SSE streaming types ───────────────────────────────────────────────────────

/** Possible event types in the Anthropic streaming SSE response. */
export type StreamEventType =
  | "message_start"
  | "content_block_start"
  | "content_block_delta"
  | "content_block_stop"
  | "message_delta"
  | "message_stop"
  | "ping"
  | "error";

/** A parsed SSE event from the streaming response. */
export interface StreamEvent {
  event: StreamEventType;
  data: Record<string, unknown>;
}

/**
 * Parse a stream of SSE lines into structured events.
 *
 * Handles the standard SSE format:
 * ```
 * event: content_block_delta
 * data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}
 * ```
 */
export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let currentEvent = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;

      const lines = buffer.split("\n");
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const raw = line.slice(6);
          if (raw === "[DONE]") continue;
          try {
            const data = JSON.parse(raw) as Record<string, unknown>;
            yield {
              event: currentEvent as StreamEventType,
              data,
            };
          } catch {
            // Malformed JSON — skip
          }
          currentEvent = "";
        }
        // Empty lines and other prefixes are ignored
      }
    }
  } finally {
    reader.releaseLock();
  }
}
