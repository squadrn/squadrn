import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  NotificationManager,
  NotificationNotFoundError,
  parseMentions,
} from "./notification_manager.ts";
import { EventBus } from "./event_bus.ts";
import type {
  AgentId,
  Message,
  Notification,
  NotificationId,
  QueryFilter,
  Session,
  SessionId,
  StorageAdapter,
  Transaction,
} from "@squadrn/types";
import type { SessionManager } from "./session_manager.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStorage(): StorageAdapter {
  const store = new Map<string, unknown>();
  return {
    async get<T>(key: string): Promise<T | null> {
      return (store.get(key) as T) ?? null;
    },
    async set<T>(key: string, value: T): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<boolean> {
      return store.delete(key);
    },
    async query<T>(collection: string, _filter: QueryFilter): Promise<T[]> {
      const results: T[] = [];
      for (const [k, v] of store) {
        if (k.startsWith(`${collection}:`)) results.push(v as T);
      }
      return results;
    },
    async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
      const tx: Transaction = {
        get: async <U>(key: string) => (store.get(key) as U) ?? null,
        set: async <U>(key: string, value: U) => { store.set(key, value); },
        delete: async (key: string) => store.delete(key),
      };
      return fn(tx);
    },
    close() {},
  };
}

/** Minimal mock SessionManager for delivery tests. */
function makeSessionManager(opts?: {
  activeAgents?: Set<string>;
  messages?: Message[];
}): SessionManager {
  const activeAgents = opts?.activeAgents ?? new Set<string>();
  const messages = opts?.messages ?? [];
  return {
    getActiveSessionForAgent(agentId: AgentId): Promise<Session | null> {
      if (activeAgents.has(agentId)) {
        return Promise.resolve({
          id: `session-${agentId}` as SessionId,
          agentId,
        } as Session);
      }
      return Promise.resolve(null);
    },
    addMessage(_sessionId: SessionId, msg: Message): Promise<void> {
      messages.push(msg);
      return Promise.resolve();
    },
  } as unknown as SessionManager;
}

function setup(sessionOpts?: Parameters<typeof makeSessionManager>[0]) {
  const storage = makeStorage();
  const events = new EventBus();
  const sessions = makeSessionManager(sessionOpts);
  const mgr = new NotificationManager(storage, events, sessions);
  return { storage, events, sessions, mgr };
}

// ---------------------------------------------------------------------------
// parseMentions
// ---------------------------------------------------------------------------

Deno.test("parseMentions - extracts unique mentions", () => {
  assertEquals(parseMentions("Hey @alice and @bob"), ["alice", "bob"]);
});

Deno.test("parseMentions - deduplicates", () => {
  assertEquals(parseMentions("@alice @alice @bob"), ["alice", "bob"]);
});

Deno.test("parseMentions - returns empty for no mentions", () => {
  assertEquals(parseMentions("no mentions here"), []);
});

Deno.test("parseMentions - handles @all", () => {
  const result = parseMentions("Hey @all, check this");
  assertEquals(result, ["all"]);
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

Deno.test("create - creates notification with defaults", async () => {
  const { mgr } = setup();
  const n = await mgr.create({
    recipientId: "agent-1",
    type: "mention",
    content: "Hello @agent-1",
    sourceType: "task",
    sourceId: "task-123",
  });

  assertEquals(n.recipientId, "agent-1");
  assertEquals(n.type, "mention");
  assertEquals(n.delivered, false);
  assertEquals(n.read, false);
  assertEquals(typeof n.id, "string");
});

Deno.test("create - emits notification:created", async () => {
  const { mgr, events } = setup();
  const emitted: unknown[] = [];
  events.on("notification:created", (payload) => { emitted.push(payload); });

  await mgr.create({
    recipientId: "agent-1",
    type: "system",
    content: "test",
    sourceType: "system",
  });

  assertEquals(emitted.length, 1);
});

// ---------------------------------------------------------------------------
// getForAgent
// ---------------------------------------------------------------------------

Deno.test("getForAgent - returns only matching agent", async () => {
  const { mgr } = setup();
  await mgr.create({ recipientId: "a1", type: "mention", content: "x", sourceType: "task" });
  await mgr.create({ recipientId: "a2", type: "mention", content: "y", sourceType: "task" });
  await mgr.create({ recipientId: "a1", type: "comment", content: "z", sourceType: "task" });

  const result = await mgr.getForAgent("a1");
  assertEquals(result.length, 2);
});

Deno.test("getForAgent - unreadOnly filters read notifications", async () => {
  const { mgr } = setup();
  const n1 = await mgr.create({ recipientId: "a1", type: "mention", content: "x", sourceType: "task" });
  await mgr.create({ recipientId: "a1", type: "mention", content: "y", sourceType: "task" });
  await mgr.markRead(n1.id);

  const unread = await mgr.getForAgent("a1", true);
  assertEquals(unread.length, 1);
});

// ---------------------------------------------------------------------------
// markDelivered / markRead
// ---------------------------------------------------------------------------

Deno.test("markDelivered - sets delivered flag and timestamp", async () => {
  const { mgr } = setup();
  const n = await mgr.create({ recipientId: "a1", type: "system", content: "x", sourceType: "system" });
  await mgr.markDelivered(n.id);

  const all = await mgr.getForAgent("a1");
  assertEquals(all[0]!.delivered, true);
  assertEquals(typeof all[0]!.deliveredAt, "object"); // Date
});

Deno.test("markRead - sets read flag and timestamp", async () => {
  const { mgr } = setup();
  const n = await mgr.create({ recipientId: "a1", type: "system", content: "x", sourceType: "system" });
  await mgr.markRead(n.id);

  const all = await mgr.getForAgent("a1");
  assertEquals(all[0]!.read, true);
});

Deno.test("markDelivered - throws for missing notification", async () => {
  const { mgr } = setup();
  await assertRejects(
    () => mgr.markDelivered("nonexistent" as NotificationId),
    NotificationNotFoundError,
  );
});

// ---------------------------------------------------------------------------
// deleteOld
// ---------------------------------------------------------------------------

Deno.test("deleteOld - removes notifications older than maxAge", async () => {
  const { mgr, storage } = setup();
  // Create a notification, then backdate it
  const n = await mgr.create({ recipientId: "a1", type: "system", content: "old", sourceType: "system" });
  const oldDate = new Date(Date.now() - 100_000);
  const stored = await storage.get<Notification>(`notifications:${n.id}`);
  if (stored) {
    stored.createdAt = oldDate;
    await storage.set(`notifications:${n.id}`, stored);
  }

  await mgr.create({ recipientId: "a1", type: "system", content: "new", sourceType: "system" });

  const deleted = await mgr.deleteOld(50_000);
  assertEquals(deleted, 1);

  const remaining = await mgr.getForAgent("a1");
  assertEquals(remaining.length, 1);
  assertEquals(remaining[0]!.content, "new");
});

// ---------------------------------------------------------------------------
// createFromMentions
// ---------------------------------------------------------------------------

Deno.test("createFromMentions - creates notifications for mentioned agents", async () => {
  const { mgr } = setup();
  const agents = ["alice", "bob", "charlie"] as AgentId[];
  const notifications = await mgr.createFromMentions(
    "Hey @alice and @bob, check this",
    "charlie",
    agents,
    "task",
    "task-1",
  );

  assertEquals(notifications.length, 2);
  assertEquals(notifications[0]!.recipientId, "alice");
  assertEquals(notifications[1]!.recipientId, "bob");
});

Deno.test("createFromMentions - @all expands to all agents except author", async () => {
  const { mgr } = setup();
  const agents = ["a1", "a2", "a3"] as AgentId[];
  const notifications = await mgr.createFromMentions("@all look", "a1", agents, "message");

  assertEquals(notifications.length, 2);
  const ids = notifications.map((n) => n.recipientId);
  assertEquals(ids.includes("a1"), false);
});

Deno.test("createFromMentions - no mentions returns empty", async () => {
  const { mgr } = setup();
  const result = await mgr.createFromMentions("no mentions", "a1", ["a2"] as AgentId[], "task");
  assertEquals(result.length, 0);
});

// ---------------------------------------------------------------------------
// Thread subscriptions
// ---------------------------------------------------------------------------

Deno.test("subscribe - adds agent to task subscribers", async () => {
  const { mgr } = setup();
  await mgr.subscribe("agent-1", "task-1");
  await mgr.subscribe("agent-2", "task-1");
  await mgr.subscribe("agent-1", "task-1"); // duplicate

  const subs = await mgr.getSubscribers("task-1");
  assertEquals(subs, ["agent-1", "agent-2"]);
});

Deno.test("notifySubscribers - notifies subscribers except author and mentioned", async () => {
  const { mgr } = setup();
  await mgr.subscribe("a1", "task-1");
  await mgr.subscribe("a2", "task-1");
  await mgr.subscribe("a3", "task-1");

  const notifications = await mgr.notifySubscribers(
    "task-1",
    "a1",        // author - skip
    "New comment",
    ["a3"],      // already mentioned - skip
  );

  assertEquals(notifications.length, 1);
  assertEquals(notifications[0]!.recipientId, "a2");
  assertEquals(notifications[0]!.type, "comment");
});

// ---------------------------------------------------------------------------
// Delivery daemon
// ---------------------------------------------------------------------------

Deno.test("deliverPending - delivers to active sessions", async () => {
  const messages: Message[] = [];
  const { mgr } = setup({ activeAgents: new Set(["a1"]), messages });

  await mgr.create({ recipientId: "a1", type: "mention", content: "ping", sourceType: "task" });
  await mgr.create({ recipientId: "a2", type: "mention", content: "pong", sourceType: "task" }); // not active

  const delivered = await mgr.deliverPending();
  assertEquals(delivered, 1);
  assertEquals(messages.length, 1);
  assertEquals(messages[0]!.content, "[Notification] ping");
});

Deno.test("deliverPending - skips already delivered", async () => {
  const messages: Message[] = [];
  const { mgr } = setup({ activeAgents: new Set(["a1"]), messages });

  await mgr.create({ recipientId: "a1", type: "mention", content: "ping", sourceType: "task" });
  await mgr.deliverPending();
  const secondPass = await mgr.deliverPending();

  assertEquals(secondPass, 0);
  assertEquals(messages.length, 1);
});

Deno.test("startDeliveryDaemon / stopDeliveryDaemon - lifecycle", () => {
  const { mgr } = setup();
  assertEquals(mgr.isDeliveryRunning, false);

  mgr.startDeliveryDaemon(100_000); // long interval so it won't fire
  assertEquals(mgr.isDeliveryRunning, true);

  mgr.stopDeliveryDaemon();
  assertEquals(mgr.isDeliveryRunning, false);
});
