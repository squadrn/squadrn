import type {
  AgentId,
  Comment,
  StorageAdapter,
  Task,
  TaskId,
  WorkspaceId,
} from "@squadrn/types";
import { createCommentId, createTaskId } from "@squadrn/types";
import type { EventBus } from "./event_bus.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateTaskData {
  title: string;
  description?: string;
  priority?: Task["priority"];
  assigneeIds?: AgentId[];
  creatorId?: string;
  parentTaskId?: TaskId;
  dependsOn?: TaskId[];
  tags?: string[];
  dueDate?: Date;
  workspaceId?: WorkspaceId;
}

export interface TaskFilter {
  status?: Task["status"];
  priority?: Task["priority"];
  assigneeId?: AgentId;
  creatorId?: string;
  parentTaskId?: TaskId;
  tag?: string;
}

export interface AddCommentData {
  authorId: string;
  authorName: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Valid status transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<Task["status"], Task["status"][]> = {
  inbox: ["assigned", "blocked"],
  assigned: ["in_progress", "blocked", "inbox"],
  in_progress: ["review", "blocked", "assigned"],
  review: ["done", "in_progress", "blocked"],
  done: ["in_progress"], // reopen
  blocked: ["inbox", "assigned", "in_progress"],
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TaskNotFoundError extends Error {
  constructor(public readonly taskId: string) {
    super(`Task not found: ${taskId}`);
  }
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly from: Task["status"],
    public readonly to: Task["status"],
  ) {
    super(`Invalid transition for task "${taskId}": ${from} → ${to}`);
  }
}

// ---------------------------------------------------------------------------
// TaskManager
// ---------------------------------------------------------------------------

const COLLECTION = "tasks";

export class TaskManager {
  #storage: StorageAdapter;
  #events: EventBus;

  constructor(storage: StorageAdapter, events: EventBus) {
    this.#storage = storage;
    this.#events = events;
  }

  async createTask(data: CreateTaskData): Promise<Task> {
    const now = new Date();
    const task: Task = {
      id: createTaskId(),
      workspaceId: (data.workspaceId ?? "") as WorkspaceId,
      title: data.title,
      description: data.description ?? "",
      status: data.assigneeIds?.length ? "assigned" : "inbox",
      priority: data.priority ?? "medium",
      assigneeIds: data.assigneeIds ?? [],
      creatorId: data.creatorId,
      parentTaskId: data.parentTaskId,
      dependsOn: data.dependsOn ?? [],
      comments: [],
      tags: data.tags ?? [],
      dueDate: data.dueDate,
      createdAt: now,
      updatedAt: now,
    };

    await this.#persist(task);
    await this.#events.emit("task:created", { taskId: task.id, title: task.title });
    return task;
  }

  async getTask(taskId: TaskId): Promise<Task | null> {
    return await this.#storage.get<Task>(`${COLLECTION}:${taskId}`);
  }

  async updateTask(
    taskId: TaskId,
    updates: Partial<Pick<Task, "title" | "description" | "priority" | "tags" | "dueDate" | "dependsOn">>,
  ): Promise<Task> {
    const task = await this.#requireTask(taskId);
    const updated: Task = {
      ...task,
      ...updates,
      updatedAt: new Date(),
    };
    await this.#persist(updated);
    await this.#events.emit("task:updated", { taskId, updates: Object.keys(updates) });
    return updated;
  }

  async deleteTask(taskId: TaskId): Promise<void> {
    await this.#requireTask(taskId);
    await this.#storage.delete(`${COLLECTION}:${taskId}`);
  }

  async listTasks(filter?: TaskFilter): Promise<Task[]> {
    const all = await this.#storage.query<Task>(COLLECTION, {});
    if (!filter) return all;

    return all.filter((t) => {
      if (filter.status && t.status !== filter.status) return false;
      if (filter.priority && t.priority !== filter.priority) return false;
      if (filter.assigneeId && !t.assigneeIds.includes(filter.assigneeId)) return false;
      if (filter.creatorId && t.creatorId !== filter.creatorId) return false;
      if (filter.parentTaskId && t.parentTaskId !== filter.parentTaskId) return false;
      if (filter.tag && !t.tags.includes(filter.tag)) return false;
      return true;
    });
  }

  async assignTask(taskId: TaskId, agentIds: AgentId[]): Promise<Task> {
    const task = await this.#requireTask(taskId);
    task.assigneeIds = agentIds;
    if (task.status === "inbox" && agentIds.length > 0) {
      task.status = "assigned";
    }
    task.updatedAt = new Date();
    await this.#persist(task);
    await this.#events.emit("task:assigned", { taskId, agentIds });
    return task;
  }

  async transitionTask(taskId: TaskId, newStatus: Task["status"]): Promise<Task> {
    const task = await this.#requireTask(taskId);
    const allowed = VALID_TRANSITIONS[task.status];
    if (!allowed?.includes(newStatus)) {
      throw new InvalidTransitionError(taskId, task.status, newStatus);
    }

    const oldStatus = task.status;
    task.status = newStatus;
    task.updatedAt = new Date();

    if (newStatus === "done") {
      task.completedAt = new Date();
    } else {
      task.completedAt = undefined;
    }

    await this.#persist(task);
    await this.#events.emit("task:status_changed", { taskId, from: oldStatus, to: newStatus });

    if (newStatus === "done") {
      await this.#events.emit("task:completed", { taskId });
    }

    return task;
  }

  async addComment(taskId: TaskId, data: AddCommentData): Promise<Comment> {
    const task = await this.#requireTask(taskId);
    const comment: Comment = {
      id: createCommentId(),
      taskId,
      authorId: data.authorId,
      authorName: data.authorName,
      content: data.content,
      mentions: parseMentions(data.content),
      createdAt: new Date(),
    };

    task.comments.push(comment);
    task.updatedAt = new Date();
    await this.#persist(task);
    await this.#events.emit("task:commented", { taskId, commentId: comment.id, mentions: comment.mentions });
    return comment;
  }

  async getTasksForAgent(agentId: AgentId): Promise<Task[]> {
    return await this.listTasks({ assigneeId: agentId });
  }

  // -- Internal -------------------------------------------------------------

  async #persist(task: Task): Promise<void> {
    await this.#storage.set(`${COLLECTION}:${task.id}`, task);
  }

  async #requireTask(taskId: TaskId): Promise<Task> {
    const task = await this.getTask(taskId);
    if (!task) throw new TaskNotFoundError(taskId);
    return task;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseMentions(text: string): string[] {
  const matches = text.matchAll(/@(\w+)/g);
  return [...new Set([...matches].map((m) => m[1]!))];
}
