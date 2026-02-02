import type {
  AgentId,
  Notification,
  NotificationId,
  StorageAdapter,
  WorkspaceId,
} from "@squadrn/types";
import { createNotificationId } from "@squadrn/types";
import type { EventBus } from "./event_bus.ts";
import type { SessionManager } from "./session_manager.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateNotificationData {
  workspaceId?: WorkspaceId;
  recipientId: string;
  type: Notification["type"];
  content: string;
  sourceType: Notification["sourceType"];
  sourceId?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class NotificationNotFoundError extends Error {
  constructor(public readonly notificationId: string) {
    super(`Notification not found: ${notificationId}`);
  }
}

// ---------------------------------------------------------------------------
// @mention parsing
// ---------------------------------------------------------------------------

/** Extract @mentions from text. Returns unique agent names (lowercase). */
export function parseMentions(text: string): string[] {
  const matches = text.matchAll(/@(\w+)/g);
  return [...new Set([...matches].map((m) => m[1]!))];
}

// ---------------------------------------------------------------------------
// NotificationManager
// ---------------------------------------------------------------------------

const COLLECTION = "notifications";
const SUBSCRIPTIONS_COLLECTION = "task_subscriptions";

export class NotificationManager {
  #storage: StorageAdapter;
  #events: EventBus;
  #sessions: SessionManager;
  #deliveryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(storage: StorageAdapter, events: EventBus, sessions: SessionManager) {
    this.#storage = storage;
    this.#events = events;
    this.#sessions = sessions;
  }

  // -- CRUD -----------------------------------------------------------------

  async create(data: CreateNotificationData): Promise<Notification> {
    const notification: Notification = {
      id: createNotificationId(),
      workspaceId: (data.workspaceId ?? "") as WorkspaceId,
      recipientId: data.recipientId,
      type: data.type,
      content: data.content,
      sourceType: data.sourceType,
      sourceId: data.sourceId,
      delivered: false,
      read: false,
      createdAt: new Date(),
    };

    await this.#persist(notification);
    await this.#events.emit("notification:created", {
      notificationId: notification.id,
      recipientId: notification.recipientId,
      type: notification.type,
    });
    return notification;
  }

  async getForAgent(agentId: string, unreadOnly?: boolean): Promise<Notification[]> {
    const all = await this.#storage.query<Notification>(COLLECTION, {});
    return all.filter((n) => {
      if (n.recipientId !== agentId) return false;
      if (unreadOnly && n.read) return false;
      return true;
    });
  }

  async markDelivered(id: NotificationId): Promise<void> {
    const n = await this.#require(id);
    n.delivered = true;
    n.deliveredAt = new Date();
    await this.#persist(n);
    await this.#events.emit("notification:delivered", { notificationId: id });
  }

  async markRead(id: NotificationId): Promise<void> {
    const n = await this.#require(id);
    n.read = true;
    n.readAt = new Date();
    await this.#persist(n);
  }

  async deleteOld(maxAgeMs: number): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    const all = await this.#storage.query<Notification>(COLLECTION, {});
    let deleted = 0;
    for (const n of all) {
      const createdMs = n.createdAt instanceof Date ? n.createdAt.getTime() : new Date(n.createdAt).getTime();
      if (createdMs < cutoff) {
        await this.#storage.delete(`${COLLECTION}:${n.id}`);
        deleted++;
      }
    }
    return deleted;
  }

  // -- @mention notifications -----------------------------------------------

  /**
   * Create notifications from @mentions found in text.
   * Pass all known agent IDs so "@all" can be expanded.
   */
  async createFromMentions(
    text: string,
    authorId: string,
    allAgentIds: AgentId[],
    sourceType: Notification["sourceType"],
    sourceId?: string,
    workspaceId?: WorkspaceId,
  ): Promise<Notification[]> {
    const mentions = parseMentions(text);
    if (mentions.length === 0) return [];

    const isAll = mentions.includes("all");
    const recipientIds = isAll
      ? allAgentIds.filter((id) => id !== authorId)
      : mentions.filter((m) => m !== authorId);

    const notifications: Notification[] = [];
    for (const recipientId of recipientIds) {
      const n = await this.create({
        workspaceId,
        recipientId,
        type: "mention",
        content: text,
        sourceType,
        sourceId,
      });
      notifications.push(n);
    }
    return notifications;
  }

  // -- Thread subscriptions -------------------------------------------------

  async subscribe(agentId: string, taskId: string): Promise<void> {
    const key = `${SUBSCRIPTIONS_COLLECTION}:${taskId}`;
    const subs = await this.#storage.get<string[]>(key) ?? [];
    if (!subs.includes(agentId)) {
      subs.push(agentId);
      await this.#storage.set(key, subs);
    }
  }

  async getSubscribers(taskId: string): Promise<string[]> {
    const key = `${SUBSCRIPTIONS_COLLECTION}:${taskId}`;
    return await this.#storage.get<string[]>(key) ?? [];
  }

  /**
   * Notify all task subscribers (except the author) about a new comment.
   * Subscribers who are already @mentioned are skipped (they get a mention notification).
   */
  async notifySubscribers(
    taskId: string,
    authorId: string,
    content: string,
    mentionedIds: string[],
    workspaceId?: WorkspaceId,
  ): Promise<Notification[]> {
    const subscribers = await this.getSubscribers(taskId);
    const notifications: Notification[] = [];
    for (const sub of subscribers) {
      if (sub === authorId) continue;
      if (mentionedIds.includes(sub)) continue;
      const n = await this.create({
        workspaceId,
        recipientId: sub,
        type: "comment",
        content,
        sourceType: "task",
        sourceId: taskId,
      });
      notifications.push(n);
    }
    return notifications;
  }

  // -- Delivery daemon ------------------------------------------------------

  startDeliveryDaemon(intervalMs = 2000): void {
    if (this.#deliveryTimer) return;
    this.#deliveryTimer = setInterval(() => {
      this.#deliverPending().catch((err) =>
        console.error("[NotificationManager] delivery error:", err)
      );
    }, intervalMs);
  }

  stopDeliveryDaemon(): void {
    if (this.#deliveryTimer) {
      clearInterval(this.#deliveryTimer);
      this.#deliveryTimer = null;
    }
  }

  get isDeliveryRunning(): boolean {
    return this.#deliveryTimer !== null;
  }

  /**
   * Single delivery pass: find undelivered notifications and push them
   * to active agent sessions.
   */
  async deliverPending(): Promise<number> {
    return await this.#deliverPending();
  }

  async #deliverPending(): Promise<number> {
    const all = await this.#storage.query<Notification>(COLLECTION, {});
    const undelivered = all.filter((n) => !n.delivered);
    let delivered = 0;

    for (const n of undelivered) {
      const session = await this.#sessions.getActiveSessionForAgent(
        n.recipientId as AgentId,
      );
      if (!session) continue; // agent not active; wait for heartbeat

      await this.#sessions.addMessage(session.id, {
        role: "system",
        content: `[Notification] ${n.content}`,
      });
      await this.markDelivered(n.id);
      delivered++;
    }

    return delivered;
  }

  // -- Internal -------------------------------------------------------------

  async #persist(notification: Notification): Promise<void> {
    await this.#storage.set(`${COLLECTION}:${notification.id}`, notification);
  }

  async #require(id: NotificationId): Promise<Notification> {
    const n = await this.#storage.get<Notification>(`${COLLECTION}:${id}`);
    if (!n) throw new NotificationNotFoundError(id);
    return n;
  }
}
