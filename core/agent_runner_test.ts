import { assertEquals, assertGreater } from "jsr:@std/assert";
import type {
  Agent,
  AgentId,
  CompletionRequest,
  CompletionResponse,
  CompletionWithToolsResponse,
  LLMProvider,
  Message,
  QueryFilter,
  StorageAdapter,
  ToolDefinition,
  Transaction,
  WorkspaceId,
} from "@squadrn/types";
import { EventBus } from "./event_bus.ts";
import { SessionManager } from "./session_manager.ts";
import { AgentRunner, parseMentions, parseWorkingMemoryUpdates } from "./agent_runner.ts";

// ── Test helpers ─────────────────────────────────────────────────────────────

function createMemoryStorage(): StorageAdapter {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string): Promise<T | null> {
      return Promise.resolve((store.get(key) as T) ?? null);
    },
    set<T>(key: string, value: T): Promise<void> {
      store.set(key, value);
      return Promise.resolve();
    },
    delete(key: string): Promise<boolean> {
      return Promise.resolve(store.delete(key));
    },
    query<T>(collection: string, filter: QueryFilter): Promise<T[]> {
      const results: T[] = [];
      for (const [key, value] of store) {
        if (!key.startsWith(`${collection}:`)) continue;
        const item = value as Record<string, unknown>;
        let match = true;
        if (filter.where) {
          for (const [k, v] of Object.entries(filter.where)) {
            if (item[k] !== v) {
              match = false;
              break;
            }
          }
        }
        if (match) results.push(value as T);
      }
      return Promise.resolve(results);
    },
    transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
      const tx: Transaction = {
        get: <U>(key: string) => Promise.resolve((store.get(key) as U) ?? null),
        set: <U>(key: string, value: U) => {
          store.set(key, value);
          return Promise.resolve();
        },
        delete: (key: string) => Promise.resolve(store.delete(key)),
      };
      return fn(tx);
    },
    close() {},
  };
}

function createMockLLM(responses: string[]): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    supportsTools: false,
    complete(_req: CompletionRequest): Promise<CompletionResponse> {
      const content = responses[callIndex] ?? "no response";
      callIndex++;
      return Promise.resolve({
        content,
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: "end",
      });
    },
  };
}

function createMockLLMWithTools(
  steps: Array<{
    content: string;
    toolCalls?: CompletionWithToolsResponse["toolCalls"];
    stopReason?: CompletionWithToolsResponse["stopReason"];
  }>,
): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock-tools",
    supportsTools: true,
    complete(_req: CompletionRequest): Promise<CompletionResponse> {
      const step = steps[callIndex] ?? { content: "final", stopReason: "end" };
      callIndex++;
      return Promise.resolve({
        content: step.content,
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: "end",
      });
    },
    completeWithTools(
      _req: CompletionRequest,
      _tools: ToolDefinition[],
    ): Promise<CompletionWithToolsResponse> {
      const step = steps[callIndex] ?? { content: "final", toolCalls: [], stopReason: "end" };
      callIndex++;
      return Promise.resolve({
        content: step.content,
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: step.stopReason ?? "end",
        toolCalls: step.toolCalls ?? [],
      });
    },
  };
}

const AGENT_ID = "agent-test" as AgentId;

function createTestAgent(): Agent {
  return {
    id: AGENT_ID,
    workspaceId: "ws-1" as WorkspaceId,
    name: "TestBot",
    role: "tester",
    status: "active",
    llm: "mock",
    channels: [],
    heartbeatCron: "*/15 * * * *",
    soulFile: "/tmp/squadrn-test-soul/SOUL.md",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function setupRunner(
  llm?: LLMProvider,
  options?: import("./agent_runner.ts").AgentRunnerOptions,
) {
  const storage = createMemoryStorage();
  const events = new EventBus();
  const sessionManager = new SessionManager(storage, events);
  const agent = createTestAgent();

  // Write SOUL.md
  await Deno.mkdir("/tmp/squadrn-test-soul", { recursive: true });
  await Deno.writeTextFile(agent.soulFile, "You are a helpful test assistant.");

  const session = await sessionManager.createSession(AGENT_ID);

  const provider = llm ?? createMockLLM(["Hello, I'm TestBot!"]);
  const runner = new AgentRunner(agent, session, provider, events, sessionManager, options);

  return { runner, events, session, sessionManager, agent };
}

// ── Unit tests for parsers ───────────────────────────────────────────────────

Deno.test("parseMentions extracts @mentions from text", () => {
  const mentions = parseMentions("Hey @alice and @bob, check this out. @alice again.");
  assertEquals(mentions.sort(), ["alice", "bob"]);
});

Deno.test("parseMentions returns empty for no mentions", () => {
  assertEquals(parseMentions("No mentions here"), []);
});

Deno.test("parseWorkingMemoryUpdates parses update block", () => {
  const text = `Some text
\`\`\`working_memory
status: thinking
topic: testing
\`\`\`
More text`;
  const result = parseWorkingMemoryUpdates(text);
  assertEquals(result, { status: "thinking", topic: "testing" });
});

Deno.test("parseWorkingMemoryUpdates returns null for no block", () => {
  assertEquals(parseWorkingMemoryUpdates("No memory block here"), null);
});

// ── Integration tests ────────────────────────────────────────────────────────

Deno.test("run() returns LLM response", async () => {
  const { runner } = await setupRunner();
  const result = await runner.run("Hi there");
  assertEquals(result, "Hello, I'm TestBot!");
});

Deno.test("run() emits agent:thinking and agent:response events", async () => {
  const { runner, events } = await setupRunner();
  const emitted: string[] = [];
  events.on("agent:thinking", () => {
    emitted.push("thinking");
  });
  events.on("agent:response", () => {
    emitted.push("response");
  });

  await runner.run("Hi");
  assertEquals(emitted, ["thinking", "response"]);
});

Deno.test("run() saves messages to session history", async () => {
  const { runner, session, sessionManager } = await setupRunner();
  await runner.run("Hello");

  const history = await sessionManager.getHistory(session.id);
  // Should have user + assistant messages
  assertEquals(history.length, 2);
  assertEquals(history[0]?.role, "user");
  assertEquals(history[0]?.content, "Hello");
  assertEquals(history[1]?.role, "assistant");
  assertEquals(history[1]?.content, "Hello, I'm TestBot!");
});

Deno.test("run() includes conversation history in LLM request", async () => {
  let capturedMessages: Message[] = [];
  const llm: LLMProvider = {
    name: "spy",
    supportsTools: false,
    complete(req: CompletionRequest): Promise<CompletionResponse> {
      capturedMessages = req.messages;
      return Promise.resolve({ content: "ok", usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end" });
    },
  };

  const { runner, session, sessionManager } = await setupRunner(llm);

  // Seed some history
  await sessionManager.addMessage(session.id, { role: "user", content: "first" });
  await sessionManager.addMessage(session.id, { role: "assistant", content: "reply" });

  await runner.run("second");

  // System message + history + new user message
  assertGreater(capturedMessages.length, 1);
  assertEquals(capturedMessages[0]?.role, "system");
});

Deno.test("run() with tool calling executes search_memory", async () => {
  const { runner, session, sessionManager, events: _events } = await setupRunner(
    createMockLLMWithTools([
      {
        content: "",
        toolCalls: [{ id: "c1", name: "search_memory", arguments: { key: "topic" } }],
        stopReason: "tool_use",
      },
      { content: "Found the topic!", stopReason: "end" },
    ]),
  );

  await sessionManager.setWorkingMemory(session.id, "topic", "AI testing");
  const result = await runner.run("What's the topic?");
  assertEquals(result, "Found the topic!");
});

Deno.test("run() respects maxIterations for tool loops", async () => {
  // Create an LLM that always requests tool calls
  let callCount = 0;
  const infiniteToolLLM: LLMProvider = {
    name: "infinite",
    supportsTools: true,
    complete(): Promise<CompletionResponse> {
      return Promise.resolve({ content: "stopped", usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end" });
    },
    completeWithTools(): Promise<CompletionWithToolsResponse> {
      callCount++;
      return Promise.resolve({
        content: "",
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: "tool_use",
        toolCalls: [{ id: `c${callCount}`, name: "search_memory", arguments: { key: "x" } }],
      });
    },
  };

  const { runner } = await setupRunner(infiniteToolLLM, { maxIterations: 3 });
  const result = await runner.run("loop");

  // Should have been called 3 times for tools + 1 final complete()
  assertEquals(callCount, 3);
  assertEquals(result, "stopped");
});

Deno.test("stop() aborts tool loop between iterations", async () => {
  let callCount = 0;
  const stopRef: { fn: (() => void) | undefined } = { fn: undefined };

  const toolLLM: LLMProvider = {
    name: "stoppable",
    supportsTools: true,
    complete(): Promise<CompletionResponse> {
      return Promise.resolve({ content: "final", usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end" });
    },
    completeWithTools(): Promise<CompletionWithToolsResponse> {
      callCount++;
      // After first iteration, call stop
      if (callCount === 2 && stopRef.fn) stopRef.fn();
      return Promise.resolve({
        content: "",
        usage: { inputTokens: 1, outputTokens: 1 },
        stopReason: "tool_use",
        toolCalls: [{ id: `c${callCount}`, name: "search_memory", arguments: { key: "x" } }],
      });
    },
  };

  const { runner } = await setupRunner(toolLLM, { maxIterations: 10 });
  stopRef.fn = () => runner.stop();

  const result = await runner.run("test");
  // Should have stopped after 2-3 iterations, not 10
  assertEquals(result, "");
  assertGreater(5, callCount);
});

Deno.test("run() detects working memory updates in response", async () => {
  const responseWithMemory = `Here's my analysis.

\`\`\`working_memory
current_topic: architecture review
mood: focused
\`\`\`

Let me continue.`;

  const { runner, session, sessionManager } = await setupRunner(
    createMockLLM([responseWithMemory]),
  );

  await runner.run("Analyze the code");

  const topic = await sessionManager.getWorkingMemory(session.id, "current_topic");
  assertEquals(topic, "architecture review");
  const mood = await sessionManager.getWorkingMemory(session.id, "mood");
  assertEquals(mood, "focused");
});

Deno.test("run() detects @mentions in response", async () => {
  const { runner, events } = await setupRunner(
    createMockLLM(["Hey @loki, can you help with this?"]),
  );

  const mentionEvents: unknown[] = [];
  events.on("message:received", (data) => {
    mentionEvents.push(data);
  });

  await runner.run("I need help");

  assertEquals(mentionEvents.length, 1);
  const payload = mentionEvents[0] as Record<string, unknown>;
  assertEquals((payload.mentions as string[]).includes("loki"), true);
});

Deno.test("rate limiting delays between calls", async () => {
  const callTimes: number[] = [];
  const timedLLM: LLMProvider = {
    name: "timed",
    supportsTools: false,
    complete(): Promise<CompletionResponse> {
      callTimes.push(Date.now());
      return Promise.resolve({ content: "ok", usage: { inputTokens: 1, outputTokens: 1 }, stopReason: "end" });
    },
  };

  const { runner } = await setupRunner(timedLLM, { rateLimitMs: 50 });

  await runner.run("first");
  await runner.run("second");

  if (callTimes.length === 2) {
    const gap = callTimes[1]! - callTimes[0]!;
    // Gap should be at least ~50ms (allow some tolerance)
    assertGreater(gap, 30);
  }
});

// Cleanup temp files
Deno.test({
  name: "cleanup temp files",
  fn: async () => {
    try {
      await Deno.remove("/tmp/squadrn-test-soul", { recursive: true });
    } catch { /* ignore */ }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
