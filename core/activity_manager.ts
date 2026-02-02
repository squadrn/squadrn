import type { Activity, ActivityType, StorageAdapter, WorkspaceId } from "@squadrn/types";
import { createActivityId } from "@squadrn/types";
import type { EventBus } from "./event_bus.ts";
import type { EventName } from "@squadrn/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecordActivityData {
  workspaceId?: WorkspaceId;
  type: ActivityType;
  actorId: string;
  actorType: Activity["actorType"];
  targetType: Activity["targetType"];
  targetId: string;
  data?: Record<string, unknown>;
}

export interface ActivityFilter {
  type?: ActivityType;
  actorId?: string;
  actorType?: Activity["actorType"];
  targetType?: Activity["targetType"];
  targetId?: string;
}

// ---------------------------------------------------------------------------
// Event → Activity mapping
// ---------------------------------------------------------------------------

interface EventMapping {
  activityType: ActivityType;
  targetType: Activity["targetType"];
  extract: (payload: Record<string, unknown>) => {
    actorId: string;
    actorType: Activity["actorType"];
    targetId: string;
    data: Record<string, unknown>;
  };
}

const EVENT_MAP: Partial<Record<EventName, EventMapping>> = {
  "task:created": {
    activityType: "task_created",
    targetType: "task",
    extract: (p) => ({
      actorId: (p["creatorId"] as string) ?? "system",
      actorType: "system",
      targetId: p["taskId"] as string,
      data: { title: p["title"] },
    }),
  },
  "task:assigned": {
    activityType: "task_assigned",
    targetType: "task",
    extract: (p) => ({
      actorId: "system",
      actorType: "system",
      targetId: p["taskId"] as string,
      data: { agentIds: p["agentIds"] },
    }),
  },
  "task:status_changed": {
    activityType: "task_status_changed",
    targetType: "task",
    extract: (p) => ({
      actorId: "system",
      actorType: "system",
      targetId: p["taskId"] as string,
      data: { from: p["from"], to: p["to"] },
    }),
  },
  "task:commented": {
    activityType: "task_commented",
    targetType: "task",
    extract: (p) => ({
      actorId: (p["authorId"] as string) ?? "system",
      actorType: "agent",
      targetId: p["taskId"] as string,
      data: { commentId: p["commentId"], mentions: p["mentions"] },
    }),
  },
  "agent:started": {
    activityType: "agent_started",
    targetType: "agent",
    extract: (p) => ({
      actorId: p["agentId"] as string,
      actorType: "system",
      targetId: p["agentId"] as string,
      data: {},
    }),
  },
  "agent:stopped": {
    activityType: "agent_stopped",
    targetType: "agent",
    extract: (p) => ({
      actorId: p["agentId"] as string,
      actorType: "system",
      targetId: p["agentId"] as string,
      data: {},
    }),
  },
  "agent:heartbeat": {
    activityType: "agent_heartbeat",
    targetType: "agent",
    extract: (p) => ({
      actorId: p["agentId"] as string,
      actorType: "agent",
      targetId: p["agentId"] as string,
      data: {},
    }),
  },
  "message:received": {
    activityType: "message_received",
    targetType: "message",
    extract: (p) => ({
      actorId: (p["userId"] as string) ?? "unknown",
      actorType: "user",
      targetId: (p["messageId"] as string) ?? (p["id"] as string) ?? "",
      data: { channelName: p["channelName"] },
    }),
  },
  "message:send": {
    activityType: "message_sent",
    targetType: "message",
    extract: (p) => ({
      actorId: (p["agentId"] as string) ?? "system",
      actorType: "agent",
      targetId: (p["messageId"] as string) ?? (p["id"] as string) ?? "",
      data: { chatId: p["chatId"] },
    }),
  },
  "plugin:loaded": {
    activityType: "plugin_loaded",
    targetType: "plugin",
    extract: (p) => ({
      actorId: "system",
      actorType: "system",
      targetId: (p["pluginName"] as string) ?? (p["name"] as string) ?? "",
      data: { version: p["version"] },
    }),
  },
  "plugin:error": {
    activityType: "plugin_error",
    targetType: "plugin",
    extract: (p) => ({
      actorId: "system",
      actorType: "system",
      targetId: (p["pluginName"] as string) ?? (p["name"] as string) ?? "",
      data: { error: p["error"] },
    }),
  },
};

// ---------------------------------------------------------------------------
// ActivityManager
// ---------------------------------------------------------------------------

const COLLECTION = "activities";

export class ActivityManager {
  #storage: StorageAdapter;
  #events: EventBus;
  #listening = false;

  constructor(storage: StorageAdapter, events: EventBus) {
    this.#storage = storage;
    this.#events = events;
  }

  // -- Recording ------------------------------------------------------------

  async record(data: RecordActivityData): Promise<Activity> {
    const activity: Activity = {
      id: createActivityId(),
      workspaceId: (data.workspaceId ?? "") as WorkspaceId,
      type: data.type,
      actorId: data.actorId,
      actorType: data.actorType,
      targetType: data.targetType,
      targetId: data.targetId,
      data: data.data ?? {},
      createdAt: new Date(),
    };

    await this.#storage.set(`${COLLECTION}:${activity.id}`, activity);
    await this.#events.emit("activity:recorded", {
      activityId: activity.id,
      type: activity.type,
    });
    return activity;
  }

  // -- Querying -------------------------------------------------------------

  async getFeed(filter?: ActivityFilter, limit?: number, offset?: number): Promise<Activity[]> {
    const all = await this.#storage.query<Activity>(COLLECTION, {});

    let results = all;
    if (filter) {
      results = results.filter((a) => {
        if (filter.type && a.type !== filter.type) return false;
        if (filter.actorId && a.actorId !== filter.actorId) return false;
        if (filter.actorType && a.actorType !== filter.actorType) return false;
        if (filter.targetType && a.targetType !== filter.targetType) return false;
        if (filter.targetId && a.targetId !== filter.targetId) return false;
        return true;
      });
    }

    // Sort newest first
    results.sort((a, b) => {
      const ta = a.createdAt instanceof Date
        ? a.createdAt.getTime()
        : new Date(a.createdAt).getTime();
      const tb = b.createdAt instanceof Date
        ? b.createdAt.getTime()
        : new Date(b.createdAt).getTime();
      return tb - ta;
    });

    if (offset) results = results.slice(offset);
    if (limit) results = results.slice(0, limit);

    return results;
  }

  async getForTask(taskId: string): Promise<Activity[]> {
    return this.getFeed({ targetType: "task", targetId: taskId });
  }

  async getForAgent(agentId: string): Promise<Activity[]> {
    return this.getFeed({ actorId: agentId });
  }

  async getRecent(since: Date): Promise<Activity[]> {
    const sinceMs = since.getTime();
    const all = await this.#storage.query<Activity>(COLLECTION, {});
    return all.filter((a) => {
      const ms = a.createdAt instanceof Date
        ? a.createdAt.getTime()
        : new Date(a.createdAt).getTime();
      return ms >= sinceMs;
    }).sort((a, b) => {
      const ta = a.createdAt instanceof Date
        ? a.createdAt.getTime()
        : new Date(a.createdAt).getTime();
      const tb = b.createdAt instanceof Date
        ? b.createdAt.getTime()
        : new Date(b.createdAt).getTime();
      return tb - ta;
    });
  }

  // -- Auto-recording from EventBus -----------------------------------------

  startListening(): void {
    if (this.#listening) return;
    this.#listening = true;

    for (const [eventName, mapping] of Object.entries(EVENT_MAP)) {
      if (!mapping) continue;
      const m = mapping;
      this.#events.on(eventName as EventName, (payload) => {
        const p = (payload ?? {}) as Record<string, unknown>;
        const extracted = m.extract(p);
        this.record({
          type: m.activityType,
          actorId: extracted.actorId,
          actorType: extracted.actorType,
          targetType: m.targetType,
          targetId: extracted.targetId,
          data: extracted.data,
        }).catch((err) =>
          console.error(`[ActivityManager] Failed to record ${m.activityType}:`, err)
        );
      });
    }
  }

  get isListening(): boolean {
    return this.#listening;
  }

  // -- Formatting -----------------------------------------------------------

  static formatActivity(activity: Activity): string {
    const actor = activity.actorId;
    const target = activity.targetId;

    switch (activity.type) {
      case "task_created":
        return `${actor} created task ${target}${
          activity.data["title"] ? `: "${activity.data["title"]}"` : ""
        }`;
      case "task_assigned":
        return `${actor} assigned task ${target} to ${
          formatList(activity.data["agentIds"] as string[] | undefined)
        }`;
      case "task_status_changed":
        return `Task ${target} moved from ${activity.data["from"]} to ${activity.data["to"]}`;
      case "task_commented":
        return `${actor} commented on task ${target}`;
      case "agent_started":
        return `Agent ${target} started`;
      case "agent_stopped":
        return `Agent ${target} stopped`;
      case "agent_heartbeat":
        return `Agent ${target} heartbeat`;
      case "message_received":
        return `Message received from ${actor}${
          activity.data["channelName"] ? ` via ${activity.data["channelName"]}` : ""
        }`;
      case "message_sent":
        return `${actor} sent a message${
          activity.data["chatId"] ? ` to ${activity.data["chatId"]}` : ""
        }`;
      case "plugin_loaded":
        return `Plugin ${target} loaded${
          activity.data["version"] ? ` (v${activity.data["version"]})` : ""
        }`;
      case "plugin_error":
        return `Plugin ${target} error: ${activity.data["error"] ?? "unknown"}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatList(items: string[] | undefined): string {
  if (!items || items.length === 0) return "nobody";
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
