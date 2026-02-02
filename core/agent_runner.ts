import type {
  Agent,
  CompletionRequest,
  LLMProvider,
  Message,
  Session,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "@squadrn/types";
import type { EventBus } from "./event_bus.ts";
import type { SessionManager } from "./session_manager.ts";

// ── Configuration ────────────────────────────────────────────────────────────

export interface AgentRunnerOptions {
  /** Maximum tool-call iterations before forcing a stop (default: 10). */
  maxIterations?: number;
  /** Minimum milliseconds between LLM calls (default: 0 = no limit). */
  rateLimitMs?: number;
  /** Maximum tokens for LLM responses. */
  maxTokens?: number;
  /** LLM temperature. */
  temperature?: number;
}

const DEFAULT_MAX_ITERATIONS = 10;

// ── Built-in tool definitions ────────────────────────────────────────────────

const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read the contents of a file at the given path.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Absolute file path" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file at the given path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute file path" },
        content: { type: "string", description: "File content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "search_memory",
    description: "Search the agent's working memory for a key.",
    parameters: {
      type: "object",
      properties: { key: { type: "string", description: "Memory key to look up" } },
      required: ["key"],
    },
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function expandHome(p: string): string {
  return p.startsWith("~") ? p.replace(/^~/, Deno.env.get("HOME") ?? "") : p;
}

/** Extract @mentions from text. Returns unique agent names. */
export function parseMentions(text: string): string[] {
  const matches = text.matchAll(/@(\w+)/g);
  return [...new Set([...matches].map((m) => m[1]!))];
}

/** Detect if the response contains a WORKING_MEMORY update block. */
export function parseWorkingMemoryUpdates(
  text: string,
): Record<string, string> | null {
  const match = text.match(
    /```working[_-]?memory\n([\s\S]*?)```/i,
  );
  if (!match) return null;

  const updates: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const sep = line.indexOf(":");
    if (sep > 0) {
      const key = line.slice(0, sep).trim();
      const value = line.slice(sep + 1).trim();
      if (key) updates[key] = value;
    }
  }
  return Object.keys(updates).length > 0 ? updates : null;
}

// ── AgentRunner ──────────────────────────────────────────────────────────────

export class AgentRunner {
  #agent: Agent;
  #session: Session;
  #llm: LLMProvider;
  #events: EventBus;
  #sessionManager: SessionManager;
  #options: Required<AgentRunnerOptions>;
  #aborted = false;
  #lastCallTime = 0;

  constructor(
    agent: Agent,
    session: Session,
    llmProvider: LLMProvider,
    eventBus: EventBus,
    sessionManager: SessionManager,
    options?: AgentRunnerOptions,
  ) {
    this.#agent = agent;
    this.#session = session;
    this.#llm = llmProvider;
    this.#events = eventBus;
    this.#sessionManager = sessionManager;
    this.#options = {
      maxIterations: options?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      rateLimitMs: options?.rateLimitMs ?? 0,
      maxTokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
    };
  }

  /** Process a user message and return the agent's final text response. */
  async run(input: string): Promise<string> {
    this.#aborted = false;

    await this.#events.emit("agent:thinking", {
      agentId: this.#agent.id,
      sessionId: this.#session.id,
    });

    // 1. Load SOUL.md
    const soul = await this.#loadFile(this.#agent.soulFile);

    // 2. Load WORKING.md (sibling of SOUL.md)
    const workingPath = this.#agent.soulFile.replace(/SOUL\.md$/i, "WORKING.md");
    const working = await this.#loadFile(workingPath);

    // 3. Build conversation
    const history = this.#session.context.conversationHistory;

    const systemContent = [
      soul,
      working ? `\n\n## Working Memory\n\n${working}` : "",
    ].join("");

    const messages: Message[] = [
      { role: "system", content: systemContent },
      ...history,
      { role: "user", content: input },
    ];

    // 4. Save user message to session
    await this.#sessionManager.addMessage(this.#session.id, {
      role: "user",
      content: input,
    });

    // 5. Complete (with or without tools)
    let responseText: string;

    if (this.#aborted) return "";

    if (this.#llm.supportsTools && this.#llm.completeWithTools) {
      responseText = await this.#runWithTools(messages);
    } else {
      await this.#enforceRateLimit();
      const response = await this.#llm.complete(this.#buildRequest(messages));
      responseText = response.content;
    }

    if (this.#aborted) return "";

    // 6. Parse @mentions
    const mentions = parseMentions(responseText);
    if (mentions.length > 0) {
      await this.#events.emit("message:received", {
        agentId: this.#agent.id,
        mentions,
        content: responseText,
      });
    }

    // 7. Parse and persist working memory updates
    const memUpdates = parseWorkingMemoryUpdates(responseText);
    if (memUpdates) {
      await this.#updateWorkingFile(workingPath, memUpdates);
      for (const [key, value] of Object.entries(memUpdates)) {
        await this.#sessionManager.setWorkingMemory(this.#session.id, key, value);
      }
    }

    // 8. Save assistant message
    await this.#sessionManager.addMessage(this.#session.id, {
      role: "assistant",
      content: responseText,
    });

    // 9. Emit response event
    await this.#events.emit("agent:response", {
      agentId: this.#agent.id,
      sessionId: this.#session.id,
      content: responseText,
      mentions,
    });

    return responseText;
  }

  /** Abort a running execution. */
  stop(): void {
    this.#aborted = true;
  }

  // ── Tool loop ──────────────────────────────────────────────────────────

  async #runWithTools(messages: Message[]): Promise<string> {
    const tools = [...BUILTIN_TOOLS];
    let iterations = 0;
    const currentMessages = [...messages];

    while (iterations < this.#options.maxIterations) {
      if (this.#aborted) return "";

      iterations++;
      await this.#enforceRateLimit();

      const response = await this.#llm.completeWithTools!(
        this.#buildRequest(currentMessages),
        tools,
      );

      if (response.stopReason !== "tool_use" || response.toolCalls.length === 0) {
        return response.content;
      }

      // Add assistant message with tool calls indicator
      currentMessages.push({
        role: "assistant",
        content: response.content ||
          `[tool calls: ${response.toolCalls.map((t) => t.name).join(", ")}]`,
      });

      // Execute each tool call
      const results = await this.#executeToolCalls(response.toolCalls);

      // Add tool results as user messages
      for (const result of results) {
        currentMessages.push({
          role: "user",
          content: `[tool result for ${result.callId}]: ${result.content}${
            result.isError ? " (error)" : ""
          }`,
        });
      }
    }

    // Max iterations reached — do one final completion without tools
    await this.#enforceRateLimit();
    const final = await this.#llm.complete(this.#buildRequest(currentMessages));
    return final.content;
  }

  async #executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const call of toolCalls) {
      const result = await this.#executeSingleTool(call);
      results.push(result);
    }

    return results;
  }

  async #executeSingleTool(call: ToolCall): Promise<ToolResult> {
    try {
      switch (call.name) {
        case "read_file": {
          const filePath = expandHome(call.arguments.path as string);
          const content = await Deno.readTextFile(filePath);
          return { callId: call.id, content };
        }
        case "write_file": {
          const filePath = expandHome(call.arguments.path as string);
          const content = call.arguments.content as string;
          await Deno.writeTextFile(filePath, content);
          return { callId: call.id, content: "File written successfully." };
        }
        case "search_memory": {
          const key = call.arguments.key as string;
          const value = await this.#sessionManager.getWorkingMemory(
            this.#session.id,
            key,
          );
          return {
            callId: call.id,
            content: value !== undefined ? JSON.stringify(value) : "Key not found.",
          };
        }
        default:
          return { callId: call.id, content: `Unknown tool: ${call.name}`, isError: true };
      }
    } catch (err) {
      return {
        callId: call.id,
        content: err instanceof Error ? err.message : String(err),
        isError: true,
      };
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  #buildRequest(messages: Message[]): CompletionRequest {
    return {
      messages,
      maxTokens: this.#options.maxTokens,
      temperature: this.#options.temperature,
    };
  }

  async #loadFile(filePath: string): Promise<string> {
    try {
      return await Deno.readTextFile(expandHome(filePath));
    } catch {
      return "";
    }
  }

  async #updateWorkingFile(
    filePath: string,
    updates: Record<string, string>,
  ): Promise<void> {
    try {
      const expanded = expandHome(filePath);
      let existing = "";
      try {
        existing = await Deno.readTextFile(expanded);
      } catch {
        // File doesn't exist yet
      }

      // Append/update key-value pairs
      const lines = existing.split("\n");
      for (const [key, value] of Object.entries(updates)) {
        const idx = lines.findIndex((l) => l.startsWith(`${key}:`));
        if (idx >= 0) {
          lines[idx] = `${key}: ${value}`;
        } else {
          lines.push(`${key}: ${value}`);
        }
      }

      await Deno.writeTextFile(expanded, lines.join("\n"));
    } catch {
      // Best effort — don't crash the run if file write fails
    }
  }

  async #enforceRateLimit(): Promise<void> {
    if (this.#options.rateLimitMs <= 0) return;
    const elapsed = Date.now() - this.#lastCallTime;
    if (elapsed < this.#options.rateLimitMs) {
      await new Promise((r) => setTimeout(r, this.#options.rateLimitMs - elapsed));
    }
    this.#lastCallTime = Date.now();
  }
}

import { AgentError } from "./errors.ts";
export { AgentError as AgentRunError };
