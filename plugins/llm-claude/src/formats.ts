/**
 * Converts between Squadrn's message types and the Anthropic Messages API format.
 *
 * @module
 */

import type { Message, ToolDefinition } from "@squadrn/types";

// ── Anthropic API types (request-side) ────────────────────────────────────────

/** A single content block inside an Anthropic message. */
export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

/** A message in the Anthropic Messages API format. */
export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

/** Tool definition in Anthropic's format. */
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// ── Conversion helpers ────────────────────────────────────────────────────────

/**
 * Split a Squadrn `Message[]` into an optional system prompt and the
 * Anthropic-format `messages` array.
 *
 * Anthropic requires the system prompt as a separate top-level field rather
 * than a message with `role: "system"`.
 */
export function formatMessages(
  messages: Message[],
): { system: string | undefined; messages: AnthropicMessage[] } {
  let system: string | undefined;
  const out: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      // Concatenate multiple system messages (rare but possible)
      system = system ? `${system}\n\n${msg.content}` : msg.content;
    } else {
      out.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: out };
}

/**
 * Convert Squadrn `ToolDefinition[]` to Anthropic's tool format.
 */
export function formatTools(tools: ToolDefinition[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}
