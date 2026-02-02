// Branded ID types
export type AgentId = string & { readonly __brand: "AgentId" };
export type TaskId = string & { readonly __brand: "TaskId" };
export type CommentId = string & { readonly __brand: "CommentId" };
export type SessionId = string & { readonly __brand: "SessionId" };
export type WorkspaceId = string & { readonly __brand: "WorkspaceId" };

export interface Agent {
  id: AgentId;
  workspaceId: WorkspaceId;
  name: string;
  role: string;
  status: "idle" | "active" | "blocked" | "offline";
  llm: string;
  channels: string[];
  heartbeatCron: string;
  soulFile: string;
  currentTaskId?: TaskId;
  currentSessionId?: SessionId;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface SessionContext {
  conversationHistory: Message[];
  workingMemory: Record<string, unknown>;
  currentTaskId?: TaskId;
}

export interface Session {
  id: SessionId;
  agentId: AgentId;
  workspaceId: WorkspaceId;
  status: "idle" | "active" | "blocked";
  context: SessionContext;
  createdAt: Date;
  lastActiveAt: Date;
}

export interface Comment {
  id: CommentId;
  taskId: TaskId;
  authorId: string;
  authorName: string;
  content: string;
  mentions: string[];
  createdAt: Date;
}

export interface Task {
  id: TaskId;
  workspaceId: WorkspaceId;
  title: string;
  description: string;
  status: "inbox" | "assigned" | "in_progress" | "review" | "done" | "blocked";
  priority: "low" | "medium" | "high" | "urgent";
  assigneeIds: AgentId[];
  creatorId?: string;
  parentTaskId?: TaskId;
  dependsOn: TaskId[];
  comments: Comment[];
  tags: string[];
  dueDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

// ── Helper functions ─────────────────────────────────────────────────────────

export function createAgentId(): AgentId {
  return crypto.randomUUID() as AgentId;
}

export function createTaskId(): TaskId {
  return crypto.randomUUID() as TaskId;
}

export function createCommentId(): CommentId {
  return crypto.randomUUID() as CommentId;
}

export function createSessionId(): SessionId {
  return crypto.randomUUID() as SessionId;
}

export interface SerializedAgent {
  id: string;
  workspaceId: string;
  name: string;
  role: string;
  status: Agent["status"];
  llm: string;
  channels: string[];
  heartbeatCron: string;
  soulFile: string;
  currentTaskId?: string;
  currentSessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export function serializeAgent(agent: Agent): SerializedAgent {
  return {
    id: agent.id,
    workspaceId: agent.workspaceId,
    name: agent.name,
    role: agent.role,
    status: agent.status,
    llm: agent.llm,
    channels: agent.channels,
    heartbeatCron: agent.heartbeatCron,
    soulFile: agent.soulFile,
    currentTaskId: agent.currentTaskId,
    currentSessionId: agent.currentSessionId,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

export function deserializeAgent(data: SerializedAgent): Agent {
  return {
    id: data.id as AgentId,
    workspaceId: data.workspaceId as WorkspaceId,
    name: data.name,
    role: data.role,
    status: data.status,
    llm: data.llm,
    channels: data.channels,
    heartbeatCron: data.heartbeatCron,
    soulFile: data.soulFile,
    currentTaskId: data.currentTaskId as TaskId | undefined,
    currentSessionId: data.currentSessionId as SessionId | undefined,
    createdAt: new Date(data.createdAt),
    updatedAt: new Date(data.updatedAt),
  };
}
