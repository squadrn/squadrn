import { assertEquals } from "jsr:@std/assert";
import type { Agent, Task } from "@squadrn/types";
import { createEmptyState, subscribeToEvents } from "./state.ts";

/** Minimal mock PluginAPI for testing event subscriptions. */
function createMockCore() {
  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  return {
    events: {
      on(event: string, handler: (payload: unknown) => void): void {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event)!.push(handler);
      },
      off(event: string, handler: (payload: unknown) => void): void {
        const list = handlers.get(event);
        if (list) {
          const idx = list.indexOf(handler);
          if (idx >= 0) list.splice(idx, 1);
        }
      },
      emit(event: string, payload: unknown): void {
        for (const h of handlers.get(event) ?? []) {
          h(payload);
        }
      },
    },
    storage: {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(false),
      query: () => Promise.resolve([]),
    },
    config: {},
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    _emit(event: string, payload: unknown): void {
      for (const h of handlers.get(event) ?? []) {
        h(payload);
      }
    },
  };
}

Deno.test("subscribeToEvents updates agents on agent:started", () => {
  const core = createMockCore();
  const state = createEmptyState();
  let updated = false;

  subscribeToEvents(core, state, () => {
    updated = true;
  });

  const agent: Agent = {
    id: "agent-1" as Agent["id"],
    workspaceId: "ws-1" as Agent["workspaceId"],
    name: "Scout",
    role: "Lead",
    status: "idle",
    llm: "claude",
    channels: ["telegram"],
    heartbeatCron: "*/15 * * * *",
    soulFile: "~/.squadrn/agents/scout/SOUL.md",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  core._emit("agent:started", agent);

  assertEquals(updated, true);
  assertEquals(state.agents.size, 1);
  assertEquals(state.agents.get("agent-1")?.status, "active");
});

Deno.test("subscribeToEvents updates tasks on task:created", () => {
  const core = createMockCore();
  const state = createEmptyState();
  let updateCount = 0;

  subscribeToEvents(core, state, () => {
    updateCount++;
  });

  const task: Task = {
    id: "task-1" as Task["id"],
    workspaceId: "ws-1" as Task["workspaceId"],
    title: "Fix bug",
    description: "Something is broken",
    status: "inbox",
    priority: "high",
    assigneeIds: [],
    dependsOn: [],
    comments: [],
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  core._emit("task:created", task);

  assertEquals(updateCount, 1);
  assertEquals(state.tasks.size, 1);
  assertEquals(state.tasks.get("task-1")?.title, "Fix bug");
});

Deno.test("subscribeToEvents caps activities at 100", () => {
  const core = createMockCore();
  const state = createEmptyState();

  subscribeToEvents(core, state, () => {});

  for (let i = 0; i < 110; i++) {
    core._emit("activity:recorded", {
      id: `act-${i}`,
      workspaceId: "ws-1",
      type: "task_created",
      actorId: "user",
      actorType: "user",
      targetType: "task",
      targetId: `task-${i}`,
      data: {},
      createdAt: new Date(),
    });
  }

  assertEquals(state.activities.length, 100);
});

Deno.test("unsubscribe removes event handlers", () => {
  const core = createMockCore();
  const state = createEmptyState();
  let updateCount = 0;

  const unsubscribe = subscribeToEvents(core, state, () => {
    updateCount++;
  });

  core._emit("gateway:started", {});
  assertEquals(updateCount, 1);

  unsubscribe();
  core._emit("gateway:started", {});
  assertEquals(updateCount, 1); // Should not increase
});
