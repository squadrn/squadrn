import type { Message } from "./models.ts";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface CompletionRequest {
  model?: string;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface CompletionResponse {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason: "end" | "max_tokens" | "stop_sequence";
}

export interface StreamChunk {
  content: string;
  done: boolean;
}

export interface LLMProvider {
  name: string;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream?(request: CompletionRequest): AsyncIterable<StreamChunk>;
  supportsTools: boolean;
  completeWithTools?(
    request: CompletionRequest,
    tools: ToolDefinition[],
  ): Promise<CompletionResponse>;
}
