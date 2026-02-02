/**
 * In-memory UI state store, updated via gateway events.
 * @module
 */

import type { Activity, Agent, Notification, PluginAPI, Task } from "@squadrn/types";

/** Snapshot of all data the TUI needs to render. */
export interface UIState {
  agents: Map<string, Agent>;
  tasks: Map<string, Task>;
  activities: Activity[];
  notifications: Notification[];
  gatewayRunning: boolean;
}

export function createEmptyState(): UIState {
  return {
    agents: new Map(),
    tasks: new Map(),
    activities: [],
    notifications: [],
    gatewayRunning: false,
  };
}

/** Load initial state from storage via the query API. */
export async function loadInitialState(core: PluginAPI): Promise<UIState> {
  const state = createEmptyState();

  const agents = await core.storage.query<Agent>("agents", {});
  for (const agent of agents) {
    state.agents.set(agent.id, agent);
  }

  const tasks = await core.storage.query<Task>("tasks", {});
  for (const task of tasks) {
    state.tasks.set(task.id, task);
  }

  const activities = await core.storage.query<Activity>("activities", {
    orderBy: "createdAt",
    limit: 100,
  });
  state.activities = activities;

  const notifications = await core.storage.query<Notification>("notifications", {
    limit: 50,
  });
  state.notifications = notifications;

  state.gatewayRunning = true;
  return state;
}

/** Subscribe to gateway events and update state in place. Returns unsubscribe function. */
export function subscribeToEvents(
  core: PluginAPI,
  state: UIState,
  onUpdate: () => void,
): () => void {
  const handlers: Array<[string, (payload: unknown) => void]> = [];

  function on(event: string, handler: (payload: unknown) => void): void {
    core.events.on(event, handler);
    handlers.push([event, handler]);
  }

  on("gateway:started", () => {
    state.gatewayRunning = true;
    onUpdate();
  });

  on("gateway:stopping", () => {
    state.gatewayRunning = false;
    onUpdate();
  });

  on("agent:started", (payload) => {
    const agent = payload as Agent;
    state.agents.set(agent.id, { ...agent, status: "active" });
    onUpdate();
  });

  on("agent:stopped", (payload) => {
    const agent = payload as Agent;
    state.agents.set(agent.id, { ...agent, status: "offline" });
    onUpdate();
  });

  on("agent:heartbeat", (payload) => {
    const data = payload as { agentId: string };
    const agent = state.agents.get(data.agentId);
    if (agent) {
      state.agents.set(agent.id, { ...agent, updatedAt: new Date() });
      onUpdate();
    }
  });

  on("task:created", (payload) => {
    const task = payload as Task;
    state.tasks.set(task.id, task);
    onUpdate();
  });

  on("task:updated", (payload) => {
    const task = payload as Task;
    state.tasks.set(task.id, task);
    onUpdate();
  });

  on("task:status_changed", (payload) => {
    const task = payload as Task;
    state.tasks.set(task.id, task);
    onUpdate();
  });

  on("task:completed", (payload) => {
    const task = payload as Task;
    state.tasks.set(task.id, { ...task, status: "done" });
    onUpdate();
  });

  on("activity:recorded", (payload) => {
    const activity = payload as Activity;
    state.activities.unshift(activity);
    if (state.activities.length > 100) {
      state.activities.pop();
    }
    onUpdate();
  });

  on("notification:created", (payload) => {
    const notification = payload as Notification;
    state.notifications.unshift(notification);
    if (state.notifications.length > 50) {
      state.notifications.pop();
    }
    onUpdate();
  });

  return () => {
    for (const [event, handler] of handlers) {
      core.events.off(event, handler);
    }
  };
}
