import { assertEquals } from "@std/assert";
import { ActivityManager } from "./activity_manager.ts";
import { EventBus } from "./event_bus.ts";
import type { Activity, QueryFilter, StorageAdapter, Transaction } from "@squadrn/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStorage(): StorageAdapter {
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
    query<T>(collection: string, _filter: QueryFilter): Promise<T[]> {
      const results: T[] = [];
      for (const [k, v] of store) {
        if (k.startsWith(`${collection}:`)) results.push(v as T);
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

function setup() {
  const storage = makeStorage();
  const events = new EventBus();
  const mgr = new ActivityManager(storage, events);
  return { storage, events, mgr };
}

// ---------------------------------------------------------------------------
// record
// ---------------------------------------------------------------------------

Deno.test("record - creates activity with defaults", async () => {
  const { mgr } = setup();
  const a = await mgr.record({
    type: "task_created",
    actorId: "user-1",
    actorType: "user",
    targetType: "task",
    targetId: "task-1",
    data: { title: "My task" },
  });

  assertEquals(a.type, "task_created");
  assertEquals(a.actorId, "user-1");
  assertEquals(a.targetId, "task-1");
  assertEquals(a.data["title"], "My task");
  assertEquals(typeof a.id, "string");
});

Deno.test("record - emits activity:recorded", async () => {
  const { mgr, events } = setup();
  const emitted: unknown[] = [];
  events.on("activity:recorded", (p) => {
    emitted.push(p);
  });

  await mgr.record({
    type: "agent_started",
    actorId: "system",
    actorType: "system",
    targetType: "agent",
    targetId: "agent-1",
  });

  assertEquals(emitted.length, 1);
});

// ---------------------------------------------------------------------------
// getFeed
// ---------------------------------------------------------------------------

Deno.test("getFeed - returns all activities", async () => {
  const { mgr } = setup();
  await mgr.record({
    type: "task_created",
    actorId: "u1",
    actorType: "user",
    targetType: "task",
    targetId: "t1",
  });
  await mgr.record({
    type: "agent_started",
    actorId: "s",
    actorType: "system",
    targetType: "agent",
    targetId: "a1",
  });

  const feed = await mgr.getFeed();
  assertEquals(feed.length, 2);
});

Deno.test("getFeed - filters by type", async () => {
  const { mgr } = setup();
  await mgr.record({
    type: "task_created",
    actorId: "u1",
    actorType: "user",
    targetType: "task",
    targetId: "t1",
  });
  await mgr.record({
    type: "agent_started",
    actorId: "s",
    actorType: "system",
    targetType: "agent",
    targetId: "a1",
  });

  const feed = await mgr.getFeed({ type: "task_created" });
  assertEquals(feed.length, 1);
  assertEquals(feed[0]!.type, "task_created");
});

Deno.test("getFeed - respects limit and offset", async () => {
  const { mgr } = setup();
  for (let i = 0; i < 5; i++) {
    await mgr.record({
      type: "agent_heartbeat",
      actorId: `a${i}`,
      actorType: "agent",
      targetType: "agent",
      targetId: `a${i}`,
    });
  }

  const page = await mgr.getFeed(undefined, 2, 1);
  assertEquals(page.length, 2);
});

// ---------------------------------------------------------------------------
// getForTask / getForAgent
// ---------------------------------------------------------------------------

Deno.test("getForTask - returns activities for a specific task", async () => {
  const { mgr } = setup();
  await mgr.record({
    type: "task_created",
    actorId: "u1",
    actorType: "user",
    targetType: "task",
    targetId: "t1",
  });
  await mgr.record({
    type: "task_commented",
    actorId: "a1",
    actorType: "agent",
    targetType: "task",
    targetId: "t1",
  });
  await mgr.record({
    type: "task_created",
    actorId: "u1",
    actorType: "user",
    targetType: "task",
    targetId: "t2",
  });

  const result = await mgr.getForTask("t1");
  assertEquals(result.length, 2);
});

Deno.test("getForAgent - returns activities by actor", async () => {
  const { mgr } = setup();
  await mgr.record({
    type: "agent_heartbeat",
    actorId: "a1",
    actorType: "agent",
    targetType: "agent",
    targetId: "a1",
  });
  await mgr.record({
    type: "task_commented",
    actorId: "a1",
    actorType: "agent",
    targetType: "task",
    targetId: "t1",
  });
  await mgr.record({
    type: "agent_heartbeat",
    actorId: "a2",
    actorType: "agent",
    targetType: "agent",
    targetId: "a2",
  });

  const result = await mgr.getForAgent("a1");
  assertEquals(result.length, 2);
});

// ---------------------------------------------------------------------------
// getRecent
// ---------------------------------------------------------------------------

Deno.test("getRecent - returns activities since a given date", async () => {
  const { mgr, storage } = setup();
  const old = await mgr.record({
    type: "agent_started",
    actorId: "s",
    actorType: "system",
    targetType: "agent",
    targetId: "a1",
  });

  // Backdate the first one
  const stored = await storage.get<Activity>(`activities:${old.id}`);
  if (stored) {
    stored.createdAt = new Date(Date.now() - 100_000);
    await storage.set(`activities:${old.id}`, stored);
  }

  await mgr.record({
    type: "agent_stopped",
    actorId: "s",
    actorType: "system",
    targetType: "agent",
    targetId: "a1",
  });

  const recent = await mgr.getRecent(new Date(Date.now() - 50_000));
  assertEquals(recent.length, 1);
  assertEquals(recent[0]!.type, "agent_stopped");
});

// ---------------------------------------------------------------------------
// Auto-recording from EventBus
// ---------------------------------------------------------------------------

Deno.test("startListening - records activity on task:created event", async () => {
  const { mgr, events } = setup();
  mgr.startListening();

  await events.emit("task:created", { taskId: "t1", title: "Test", creatorId: "user-1" });

  // Give the async handler a tick to complete
  await new Promise((r) => setTimeout(r, 10));

  const feed = await mgr.getFeed();
  assertEquals(feed.length, 1);
  assertEquals(feed[0]!.type, "task_created");
  assertEquals(feed[0]!.targetId, "t1");
});

Deno.test("startListening - records activity on agent:heartbeat event", async () => {
  const { mgr, events } = setup();
  mgr.startListening();

  await events.emit("agent:heartbeat", { agentId: "jarvis" });
  await new Promise((r) => setTimeout(r, 10));

  const feed = await mgr.getFeed();
  assertEquals(feed.length, 1);
  assertEquals(feed[0]!.type, "agent_heartbeat");
  assertEquals(feed[0]!.actorId, "jarvis");
});

Deno.test("startListening - records plugin:loaded event", async () => {
  const { mgr, events } = setup();
  mgr.startListening();

  await events.emit("plugin:loaded", { pluginName: "telegram", version: "1.0.0" });
  await new Promise((r) => setTimeout(r, 10));

  const feed = await mgr.getFeed();
  assertEquals(feed.length, 1);
  assertEquals(feed[0]!.type, "plugin_loaded");
  assertEquals(feed[0]!.data["version"], "1.0.0");
});

Deno.test("startListening - idempotent (does not double-subscribe)", async () => {
  const { mgr, events } = setup();
  mgr.startListening();
  mgr.startListening(); // second call should be a no-op

  await events.emit("agent:heartbeat", { agentId: "a1" });
  await new Promise((r) => setTimeout(r, 10));

  const feed = await mgr.getFeed();
  assertEquals(feed.length, 1);
});

Deno.test("isListening - reflects listening state", () => {
  const { mgr } = setup();
  assertEquals(mgr.isListening, false);
  mgr.startListening();
  assertEquals(mgr.isListening, true);
});

// ---------------------------------------------------------------------------
// formatActivity
// ---------------------------------------------------------------------------

Deno.test("formatActivity - task_created", () => {
  const a: Activity = {
    id: "x",
    workspaceId: "",
    type: "task_created",
    actorId: "Jarvis",
    actorType: "agent",
    targetType: "task",
    targetId: "#123",
    data: { title: "Write report" },
    createdAt: new Date(),
  } as unknown as Activity;

  assertEquals(ActivityManager.formatActivity(a), 'Jarvis created task #123: "Write report"');
});

Deno.test("formatActivity - task_assigned", () => {
  const a = {
    id: "x",
    workspaceId: "",
    type: "task_assigned",
    actorId: "system",
    actorType: "system",
    targetType: "task",
    targetId: "#1",
    data: { agentIds: ["Loki", "Jarvis"] },
    createdAt: new Date(),
  } as unknown as Activity;

  assertEquals(ActivityManager.formatActivity(a), "system assigned task #1 to Loki and Jarvis");
});

Deno.test("formatActivity - task_status_changed", () => {
  const a = {
    id: "x",
    workspaceId: "",
    type: "task_status_changed",
    actorId: "system",
    actorType: "system",
    targetType: "task",
    targetId: "#1",
    data: { from: "in_progress", to: "review" },
    createdAt: new Date(),
  } as unknown as Activity;

  assertEquals(ActivityManager.formatActivity(a), "Task #1 moved from in_progress to review");
});

Deno.test("formatActivity - agent_started", () => {
  const a = {
    id: "x",
    workspaceId: "",
    type: "agent_started",
    actorId: "Jarvis",
    actorType: "system",
    targetType: "agent",
    targetId: "Jarvis",
    data: {},
    createdAt: new Date(),
  } as unknown as Activity;

  assertEquals(ActivityManager.formatActivity(a), "Agent Jarvis started");
});

Deno.test("formatActivity - plugin_loaded with version", () => {
  const a = {
    id: "x",
    workspaceId: "",
    type: "plugin_loaded",
    actorId: "system",
    actorType: "system",
    targetType: "plugin",
    targetId: "telegram",
    data: { version: "1.2.0" },
    createdAt: new Date(),
  } as unknown as Activity;

  assertEquals(ActivityManager.formatActivity(a), "Plugin telegram loaded (v1.2.0)");
});
