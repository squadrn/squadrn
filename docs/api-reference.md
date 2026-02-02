# API Reference

## CLI Commands

### Gateway Lifecycle

| Command | Description |
|---------|-------------|
| `squadrn init` | Interactive setup wizard. Creates `~/.squadrn/config.toml` |
| `squadrn start` | Start the gateway daemon |
| `squadrn stop` | Stop the running gateway |
| `squadrn status` | Show gateway status, running agents, loaded plugins |

### Agent Management

| Command | Description |
|---------|-------------|
| `squadrn agent create <name>` | Create a new agent (interactive) |
| `squadrn agent list` | List all agents with status |
| `squadrn agent start <name>` | Start a specific agent |
| `squadrn agent stop <name>` | Stop a specific agent |
| `squadrn agent logs <name>` | Stream agent logs in real time |

### Plugin Management

| Command | Description |
|---------|-------------|
| `squadrn plugin add <github-url>` | Install a plugin from GitHub |
| `squadrn plugin remove <name>` | Uninstall a plugin |
| `squadrn plugin list` | List installed plugins |
| `squadrn plugin update [name]` | Update one or all plugins |

### Task Management

| Command | Description |
|---------|-------------|
| `squadrn task create` | Create a new task (interactive) |
| `squadrn task list` | List tasks grouped by status |
| `squadrn task assign <id> <agent>` | Assign a task to an agent |

## Event Types

All 27 events in the `EventName` union:

### Lifecycle Events

| Event | Payload | Description |
|-------|---------|-------------|
| `gateway:started` | `{}` | Gateway finished initialization |
| `gateway:stopping` | `{}` | Gateway is shutting down |
| `plugin:loaded` | `{ pluginName: string }` | A plugin was loaded |
| `plugin:error` | `{ pluginName: string, error: string }` | A plugin encountered an error |
| `agent:started` | `{ agentId: string }` | An agent was started |
| `agent:stopped` | `{ agentId: string }` | An agent was stopped |
| `agent:error` | `{ agentId: string, error: string }` | An agent encountered an error |

### Message Events

| Event | Payload | Description |
|-------|---------|-------------|
| `message:received` | `IncomingMessage` | Message received from a channel |
| `message:send` | `OutgoingMessage & { channelName: string }` | Message to send through a channel |
| `message:delivered` | `{ channelName: string, chatId: string }` | Delivery confirmation |

### Task Events

| Event | Payload | Description |
|-------|---------|-------------|
| `task:created` | `{ taskId: string, title: string }` | New task created |
| `task:assigned` | `{ taskId: string, agentIds: string[] }` | Task assigned to agent(s) |
| `task:updated` | `{ taskId: string, updates: string[] }` | Task fields updated |
| `task:completed` | `{ taskId: string }` | Task moved to done |
| `task:commented` | `{ taskId: string, commentId: string, mentions: string[] }` | Comment added to task |
| `task:status_changed` | `{ taskId: string, from: string, to: string }` | Task status transition |

### Agent Events

| Event | Payload | Description |
|-------|---------|-------------|
| `agent:heartbeat` | `{ agentId: string }` | Agent heartbeat tick |
| `agent:thinking` | `{ agentId: string }` | Agent is processing via LLM |
| `agent:response` | `{ agentId: string, content: string }` | Agent produced a response |

### Session Events

| Event | Payload | Description |
|-------|---------|-------------|
| `session:created` | `{ sessionId: string, agentId: string }` | New session started |
| `session:updated` | `{ sessionId: string }` | Session state changed |
| `session:ended` | `{ sessionId: string }` | Session terminated |

### Notification Events

| Event | Payload | Description |
|-------|---------|-------------|
| `notification:created` | `{ notificationId: string, recipientId: string }` | New notification |
| `notification:delivered` | `{ notificationId: string }` | Notification delivered |

### Activity Events

| Event | Payload | Description |
|-------|---------|-------------|
| `activity:recorded` | `{ activityId: string, type: string }` | Activity logged |

## Data Models

### Agent

```typescript
interface Agent {
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
```

### Task

```typescript
interface Task {
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
```

### Session

```typescript
interface Session {
  id: SessionId;
  agentId: AgentId;
  workspaceId: WorkspaceId;
  status: "idle" | "active" | "blocked";
  context: SessionContext;
  createdAt: Date;
  lastActiveAt: Date;
}

interface SessionContext {
  conversationHistory: Message[];
  workingMemory: Record<string, unknown>;
  currentTaskId?: TaskId;
}
```

### Notification

```typescript
interface Notification {
  id: NotificationId;
  workspaceId: WorkspaceId;
  recipientId: string;
  type: "mention" | "assignment" | "comment" | "system";
  content: string;
  sourceType: "task" | "message" | "system";
  sourceId?: string;
  delivered: boolean;
  deliveredAt?: Date;
  read: boolean;
  readAt?: Date;
  createdAt: Date;
}
```

### Activity

```typescript
interface Activity {
  id: ActivityId;
  workspaceId: WorkspaceId;
  type: ActivityType;
  actorId: string;
  actorType: "agent" | "user" | "system";
  targetType: "task" | "agent" | "message" | "plugin";
  targetId: string;
  data: Record<string, unknown>;
  createdAt: Date;
}
```

## Storage Schema

The `StorageAdapter` interface provides key-value storage with collection queries:

```typescript
interface StorageAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  query<T>(collection: string, filter: QueryFilter): Promise<T[]>;
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  close(): void;
}

interface QueryFilter {
  where?: Record<string, unknown>;
  orderBy?: string;
  limit?: number;
  offset?: number;
}
```

Keys follow the pattern `collection:id`:
- `agents:abc-123`
- `tasks:def-456`
- `sessions:ghi-789`
- `plugin:telegram:state` (namespaced plugin storage)

## Error Codes

All error codes and their recovery suggestions:

| Code | Suggestion |
|------|------------|
| `CONFIG_READ_FAILED` | Check that the config file exists and is readable. Run `squadrn init` to create one. |
| `CONFIG_PARSE_FAILED` | Check your config file for TOML syntax errors. |
| `CONFIG_VALIDATION_FAILED` | Review the config values against the documentation. |
| `PLUGIN_LOAD_FAILED` | Check that the plugin URL is correct and accessible. |
| `PLUGIN_MANIFEST_INVALID` | Ensure the plugin has a valid manifest.json with all required fields. |
| `PLUGIN_MANIFEST_FETCH_FAILED` | Verify the GitHub URL and that the repository contains a manifest.json. |
| `PLUGIN_NOT_FOUND` | Run `squadrn plugin list` to see installed plugins. |
| `STORAGE_READ_FAILED` | Check that the database file exists and is not corrupted. |
| `STORAGE_WRITE_FAILED` | Ensure the database file is writable and the disk is not full. |
| `STORAGE_MIGRATION_FAILED` | The database may be corrupted. Try backing it up and reinitializing. |
| `AGENT_RUN_FAILED` | Check the agent's LLM plugin configuration and API credentials. |
| `AGENT_SOUL_MISSING` | Create a SOUL.md file for the agent. |
| `TASK_NOT_FOUND` | Run `squadrn task list` to see existing tasks. |
| `TASK_INVALID_TRANSITION` | Check valid transitions: inbox -> assigned -> in_progress -> review -> done. |
| `SESSION_NOT_FOUND` | The session may have expired. Start a new agent session. |
| `SCHEDULER_CRON_INVALID` | Use standard 5-field cron format. |
| `NETWORK_REQUEST_FAILED` | Check your internet connection and verify the URL. |
| `NETWORK_TIMEOUT` | The request timed out. Try again or check the service status. |
