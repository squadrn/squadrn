// Branded ID types
export type AgentId = string & { readonly __brand: "AgentId" };
export type TaskId = string & { readonly __brand: "TaskId" };
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

export interface Session {
  id: SessionId;
  agentId: AgentId;
  workspaceId: WorkspaceId;
  status: "idle" | "active" | "blocked";
  context: {
    conversationHistory: Message[];
    workingMemory: Record<string, unknown>;
    currentTaskId?: TaskId;
  };
  createdAt: Date;
  lastActiveAt: Date;
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
  tags: string[];
  dueDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
