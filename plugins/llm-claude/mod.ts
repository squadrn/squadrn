/**
 * @squadrn/llm-claude — Official Claude (Anthropic) LLM plugin for Squadrn.
 *
 * Provides completions, streaming, and tool use via the Anthropic Messages API.
 *
 * @module
 */

import type {
  CompletionRequest,
  CompletionResponse,
  CompletionWithToolsResponse,
  LLMProvider,
  Plugin,
  PluginAPI,
  PluginManifest,
  StreamChunk,
  ToolDefinition,
} from "@squadrn/types";
import rawManifest from "./manifest.json" with { type: "json" };
import { AnthropicClient } from "./src/client.ts";
import type { MessagesRequest } from "./src/client.ts";
import { formatMessages, formatTools } from "./src/formats.ts";
import { extractText, extractToolCalls, parseSSE } from "./src/tools.ts";

const manifest = rawManifest as unknown as PluginManifest;

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_TOKENS = 4096;

/** Map Anthropic stop_reason to Squadrn's stopReason. */
function mapStopReason(
  reason: string | null,
): CompletionResponse["stopReason"] {
  switch (reason) {
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    default:
      return "end";
  }
}

/** Map Anthropic stop_reason to the tool-aware variant. */
function mapStopReasonWithTools(
  reason: string | null,
): CompletionWithToolsResponse["stopReason"] {
  if (reason === "tool_use") return "tool_use";
  return mapStopReason(reason);
}

const plugin: Plugin = {
  manifest,

  // deno-lint-ignore require-await
  async register(core: PluginAPI) {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is required. " +
          "Get an API key at https://console.anthropic.com/",
      );
    }

    const defaultModel = (core.config["model"] as string | undefined) ?? DEFAULT_MODEL;
    const defaultMaxTokens = (core.config["maxTokens"] as number | undefined) ?? DEFAULT_MAX_TOKENS;
    const defaultTemperature = core.config["temperature"] as number | undefined;

    const client = new AnthropicClient(apiKey, core.log);

    /** Build the common request params from a CompletionRequest. */
    function buildRequest(req: CompletionRequest): MessagesRequest {
      const { system, messages } = formatMessages(req.messages);
      const params: MessagesRequest = {
        model: req.model ?? defaultModel,
        max_tokens: req.maxTokens ?? defaultMaxTokens,
        messages,
      };
      if (system) params.system = system;
      if (req.temperature !== undefined) {
        params.temperature = req.temperature;
      } else if (defaultTemperature !== undefined) {
        params.temperature = defaultTemperature;
      }
      if (req.stopSequences?.length) params.stop_sequences = req.stopSequences;
      return params;
    }

    const llm: LLMProvider = {
      name: "claude",
      supportsTools: true,

      async complete(request: CompletionRequest): Promise<CompletionResponse> {
        const params = buildRequest(request);
        const res = await client.createMessage(params);

        return {
          content: extractText(res.content),
          usage: {
            inputTokens: res.usage.input_tokens,
            outputTokens: res.usage.output_tokens,
          },
          stopReason: mapStopReason(res.stop_reason),
        };
      },

      async *stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
        const params = buildRequest(request);
        const body = await client.createMessageStream(params);

        for await (const event of parseSSE(body)) {
          if (event.event === "content_block_delta") {
            const delta = event.data["delta"] as Record<string, unknown> | undefined;
            if (delta?.["type"] === "text_delta" && typeof delta["text"] === "string") {
              yield { content: delta["text"], done: false };
            }
          } else if (event.event === "message_stop") {
            yield { content: "", done: true };
          } else if (event.event === "error") {
            const errData = event.data["error"] as Record<string, unknown> | undefined;
            throw new Error(
              `Anthropic stream error: ${errData?.["message"] ?? "unknown"}`,
            );
          }
        }
      },

      async completeWithTools(
        request: CompletionRequest,
        tools: ToolDefinition[],
      ): Promise<CompletionWithToolsResponse> {
        const params = buildRequest(request);
        params.tools = formatTools(tools);
        const res = await client.createMessage(params);

        return {
          content: extractText(res.content),
          usage: {
            inputTokens: res.usage.input_tokens,
            outputTokens: res.usage.output_tokens,
          },
          stopReason: mapStopReasonWithTools(res.stop_reason),
          toolCalls: extractToolCalls(res.content),
        };
      },
    };

    core.registerLLM!(llm);
    core.log.info("Claude LLM registered", { model: defaultModel });
  },

  unregister(): Promise<void> {
    return Promise.resolve();
  },
};

export default plugin;
