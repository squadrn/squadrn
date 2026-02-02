import { assertEquals, assertRejects } from "@std/assert";
import { InvalidTransitionError, TaskManager, TaskNotFoundError } from "./task_manager.ts";
import { EventBus } from "./event_bus.ts";
import type { AgentId, QueryFilter, StorageAdapter, TaskId, Transaction } from "@squadrn/types";

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
  const mgr = new TaskManager(storage, events);
  return { storage, events, mgr };
}

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------

Deno.test("createTask - creates with defaults", async () => {
  const { mgr } = setup();
  const task = await mgr.createTask({ title: "Test task" });

  assertEquals(task.title, "Test task");
  assertEquals(task.description, "");
  assertEquals(task.status, "inbox");
  assertEquals(task.priority, "medium");
  assertEquals(task.assigneeIds, []);
  assertEquals(task.comments, []);
  assertEquals(task.tags, []);
  assertEquals(task.dependsOn, []);
});

Deno.test("createTask - auto-assigns status when assignees provided", async () => {
  const { mgr } = setup();
  const task = await mgr.createTask({
    title: "Assigned task",
    assigneeIds: ["agent-1" as AgentId],
  });
  assertEquals(task.status, "assigned");
});

Deno.test("createTask - emits task:created", async () => {
  const { mgr, events } = setup();
  const received: unknown[] = [];
  events.on("task:created", (p: unknown) => {
    received.push(p);
  });

  await mgr.createTask({ title: "Test" });
  assertEquals(received.length, 1);
});

// ---------------------------------------------------------------------------
// getTask
// ---------------------------------------------------------------------------

Deno.test("getTask - returns task", async () => {
  const { mgr } = setup();
  const created = await mgr.createTask({ title: "Find me" });
  const found = await mgr.getTask(created.id);
  assertEquals(found?.title, "Find me");
});

Deno.test("getTask - returns null for missing", async () => {
  const { mgr } = setup();
  const result = await mgr.getTask("nonexistent" as TaskId);
  assertEquals(result, null);
});

// ---------------------------------------------------------------------------
// updateTask
// ---------------------------------------------------------------------------

Deno.test("updateTask - updates fields", async () => {
  const { mgr } = setup();
  const task = await mgr.createTask({ title: "Original" });
  const updated = await mgr.updateTask(task.id, { title: "Changed", priority: "high" });

  assertEquals(updated.title, "Changed");
  assertEquals(updated.priority, "high");
});

Deno.test("updateTask - throws for missing task", async () => {
  const { mgr } = setup();
  await assertRejects(
    () => mgr.updateTask("nope" as TaskId, { title: "X" }),
    TaskNotFoundError,
  );
});

Deno.test("updateTask - emits task:updated", async () => {
  const { mgr, events } = setup();
  const received: unknown[] = [];
  events.on("task:updated", (p: unknown) => {
    received.push(p);
  });

  const task = await mgr.createTask({ title: "T" });
  await mgr.updateTask(task.id, { title: "T2" });
  assertEquals(received.length, 1);
});

// ---------------------------------------------------------------------------
// deleteTask
// ---------------------------------------------------------------------------

Deno.test("deleteTask - removes task", async () => {
  const { mgr } = setup();
  const task = await mgr.createTask({ title: "Delete me" });
  await mgr.deleteTask(task.id);
  assertEquals(await mgr.getTask(task.id), null);
});

Deno.test("deleteTask - throws for missing", async () => {
  const { mgr } = setup();
  await assertRejects(
    () => mgr.deleteTask("nope" as TaskId),
    TaskNotFoundError,
  );
});

// ---------------------------------------------------------------------------
// listTasks / filter
// ---------------------------------------------------------------------------

Deno.test("listTasks - returns all tasks", async () => {
  const { mgr } = setup();
  await mgr.createTask({ title: "A" });
  await mgr.createTask({ title: "B" });
  const list = await mgr.listTasks();
  assertEquals(list.length, 2);
});

Deno.test("listTasks - filters by status", async () => {
  const { mgr } = setup();
  await mgr.createTask({ title: "Inbox" });
  await mgr.createTask({ title: "Assigned", assigneeIds: ["a" as AgentId] });

  const inbox = await mgr.listTasks({ status: "inbox" });
  assertEquals(inbox.length, 1);
  assertEquals(inbox[0]!.title, "Inbox");
});

Deno.test("listTasks - filters by priority", async () => {
  const { mgr } = setup();
  await mgr.createTask({ title: "Low", priority: "low" });
  await mgr.createTask({ title: "Urgent", priority: "urgent" });

  const urgent = await mgr.listTasks({ priority: "urgent" });
  assertEquals(urgent.length, 1);
  assertEquals(urgent[0]!.title, "Urgent");
});

Deno.test("listTasks - filters by assigneeId", async () => {
  const { mgr } = setup();
  await mgr.createTask({ title: "Mine", assigneeIds: ["a1" as AgentId] });
  await mgr.createTask({ title: "Theirs", assigneeIds: ["a2" as AgentId] });

  const mine = await mgr.listTasks({ assigneeId: "a1" as AgentId });
  assertEquals(mine.length, 1);
  assertEquals(mine[0]!.title, "Mine");
});

Deno.test("listTasks - filters by tag", async () => {
  const { mgr } = setup();
  await mgr.createTask({ title: "Tagged", tags: ["bug"] });
  await mgr.createTask({ title: "Untagged" });

  const bugs = await mgr.listTasks({ tag: "bug" });
  assertEquals(bugs.length, 1);
});

// ---------------------------------------------------------------------------
// assignTask
// ---------------------------------------------------------------------------

Deno.test("assignTask - assigns agents", async () => {
  const { mgr } = setup();
  const task = await mgr.createTask({ title: "Assign me" });
  assertEquals(task.status, "inbox");

  const updated = await mgr.assignTask(task.id, ["a1" as AgentId]);
  assertEquals(updated.assigneeIds, ["a1" as AgentId]);
  assertEquals(updated.status, "assigned");
});

Deno.test("assignTask - emits task:assigned", async () => {
  const { mgr, events } = setup();
  const received: unknown[] = [];
  events.on("task:assigned", (p: unknown) => {
    received.push(p);
  });

  const task = await mgr.createTask({ title: "T" });
  await mgr.assignTask(task.id, ["a1" as AgentId]);
  assertEquals(received.length, 1);
});

// ---------------------------------------------------------------------------
// transitionTask
// ---------------------------------------------------------------------------

Deno.test("transitionTask - valid: inbox → assigned", async () => {
  const { mgr } = setup();
  const task = await mgr.createTask({ title: "T" });
  const updated = await mgr.transitionTask(task.id, "assigned");
  assertEquals(updated.status, "assigned");
});

Deno.test("transitionTask - valid: assigned → in_progress → review → done", async () => {
  const { mgr } = setup();
  const task = await mgr.createTask({ title: "T", assigneeIds: ["a" as AgentId] });
  assertEquals(task.status, "assigned");

  await mgr.transitionTask(task.id, "in_progress");
  await mgr.transitionTask(task.id, "review");
  const done = await mgr.transitionTask(task.id, "done");
  assertEquals(done.status, "done");
  assertEquals(done.completedAt instanceof Date, true);
});

Deno.test("transitionTask - invalid: inbox → done throws", async () => {
  const { mgr } = setup();
  const task = await mgr.createTask({ title: "T" });

  await assertRejects(
    () => mgr.transitionTask(task.id, "done"),
    InvalidTransitionError,
  );
});

Deno.test("transitionTask - invalid: inbox → in_progress throws", async () => {
  const { mgr } = setup();
  const task = await mgr.createTask({ title: "T" });

  await assertRejects(
    () => mgr.transitionTask(task.id, "in_progress"),
    InvalidTransitionError,
  );
});

Deno.test("transitionTask - invalid: inbox → review throws", async () => {
  const { mgr } = setup();
  const task = await mgr.createTask({ title: "T" });

  await assertRejects(
    () => mgr.transitionTask(task.id, "review"),
    InvalidTransitionError,
  );
});

Deno.test("transitionTask - reopen: done → in_progress", async () => {
  const { mgr } = setup();
  const task = await mgr.createTask({ title: "T", assigneeIds: ["a" as AgentId] });
  await mgr.transitionTask(task.id, "in_progress");
  await mgr.transitionTask(task.id, "review");
  await mgr.transitionTask(task.id, "done");
  const reopened = await mgr.transitionTask(task.id, "in_progress");

  assertEquals(reopened.status, "in_progress");
  assertEquals(reopened.completedAt, undefined);
});

Deno.test("transitionTask - emits task:status_changed and task:completed", async () => {
  const { mgr, events } = setup();
  const statusEvents: unknown[] = [];
  const completedEvents: unknown[] = [];
  events.on("task:status_changed", (p: unknown) => {
    statusEvents.push(p);
  });
  events.on("task:completed", (p: unknown) => {
    completedEvents.push(p);
  });

  const task = await mgr.createTask({ title: "T", assigneeIds: ["a" as AgentId] });
  await mgr.transitionTask(task.id, "in_progress");
  await mgr.transitionTask(task.id, "review");
  await mgr.transitionTask(task.id, "done");

  assertEquals(statusEvents.length, 3);
  assertEquals(completedEvents.length, 1);
});

// ---------------------------------------------------------------------------
// addComment
// ---------------------------------------------------------------------------

Deno.test("addComment - adds comment to task", async () => {
  const { mgr } = setup();
  const task = await mgr.createTask({ title: "T" });

  const comment = await mgr.addComment(task.id, {
    authorId: "agent-1",
    authorName: "Jarvis",
    content: "Working on it!",
  });

  assertEquals(comment.authorName, "Jarvis");
  assertEquals(comment.content, "Working on it!");
  assertEquals(comment.mentions, []);

  const updated = await mgr.getTask(task.id);
  assertEquals(updated!.comments.length, 1);
});

Deno.test("addComment - parses @mentions", async () => {
  const { mgr } = setup();
  const task = await mgr.createTask({ title: "T" });

  const comment = await mgr.addComment(task.id, {
    authorId: "agent-1",
    authorName: "Jarvis",
    content: "Hey @loki, can you review? Also cc @nova",
  });

  assertEquals(comment.mentions.sort(), ["loki", "nova"]);
});

Deno.test("addComment - emits task:commented", async () => {
  const { mgr, events } = setup();
  const received: unknown[] = [];
  events.on("task:commented", (p: unknown) => {
    received.push(p);
  });

  const task = await mgr.createTask({ title: "T" });
  await mgr.addComment(task.id, {
    authorId: "a",
    authorName: "A",
    content: "Hello",
  });

  assertEquals(received.length, 1);
});

// ---------------------------------------------------------------------------
// getTasksForAgent
// ---------------------------------------------------------------------------

Deno.test("getTasksForAgent - returns agent's tasks", async () => {
  const { mgr } = setup();
  await mgr.createTask({ title: "Mine", assigneeIds: ["a1" as AgentId] });
  await mgr.createTask({ title: "Also mine", assigneeIds: ["a1" as AgentId, "a2" as AgentId] });
  await mgr.createTask({ title: "Not mine", assigneeIds: ["a2" as AgentId] });

  const tasks = await mgr.getTasksForAgent("a1" as AgentId);
  assertEquals(tasks.length, 2);
});
