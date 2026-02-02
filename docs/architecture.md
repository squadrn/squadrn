# Architecture

Squadrn is structured as three workspace modules that form a layered architecture: types
(contracts), core (engine), and CLI (interface).

## System Overview

```
┌────────────────────────────────────────────────────────────────┐
│                              CLI                               │
│      squadrn start | stop | status | plugin | agent | task     │
└───────────────────────────────┬────────────────────────────────┘
                                │  IPC (Unix socket / HTTP)
                                ▼
┌────────────────────────────────────────────────────────────────┐
│                           GATEWAY                              │
│                     (Long-running daemon)                      │
├────────────────────────────────────────────────────────────────┤
│      ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│      │   Plugin    │  │   Event     │  │  Scheduler  │         │
│      │   Loader    │  │    Bus      │  │   (Cron)    │         │
│      └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                                │
│      ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│      │   Session   │  │   Storage   │  │   Config    │         │
│      │   Manager   │  │   Adapter   │  │   Manager   │         │
│      └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                                │
│      ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│      │    Task     │  │  Activity   │  │ Notification│         │
│      │   Manager   │  │   Logger    │  │   Manager   │         │
│      └─────────────┘  └─────────────┘  └─────────────┘         │
└────────────────────────────────────────────────────────────────┘
                                 │
                    ┌────────────┼─────────────┐
                    ▼            ▼             ▼
            ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
            │  Plugin  │   │  Plugin  │   │  Plugin  │   │  Plugin  │
            │ Channel  │   │   LLM    │   │   UI     │   │  Custom  │
            │ Telegram │   │  Claude  │   │ Terminal │   │   ...    │
            └──────────┘   └──────────┘   └──────────┘   └──────────┘
```

## Workspace Modules

### `types/` — `@squadrn/types`

The plugin contract. Shared interfaces and branded ID types consumed by core, CLI, and external
plugins. Published at [jsr.io/@squadrn/types](https://jsr.io/@squadrn/types).

Key exports:

- **Branded IDs**: `AgentId`, `TaskId`, `SessionId`, `CommentId`, `NotificationId`, `ActivityId`,
  `WorkspaceId`
- **Core entities**: `Agent`, `Task`, `Session`, `Notification`, `Activity`, `Comment`, `Message`
- **Plugin interfaces**: `Plugin`, `PluginAPI`, `PluginManifest`, `ChannelProvider`, `LLMProvider`,
  `ToolProvider`
- **Config types**: `SquadrnConfig`, `GatewayConfig`, `StorageConfig`, `AgentConfig`
- **Events**: `EventName`, `EventHandler`, `EventEmitter`

### `core/` — `@squadrn/core`

The gateway daemon engine. Contains all runtime logic.

Components:

- **Gateway** — Orchestrates startup and shutdown: loads config, initializes storage, loads plugins,
  starts scheduler
- **EventBus** — In-memory pub/sub with typed events. Handlers for the same event run in parallel;
  one handler's error doesn't block others
- **PluginLoader** — Fetches plugins from GitHub URLs, validates manifest permissions, loads via
  Deno URL imports
- **SessionManager** — Per-agent state: conversation history, working memory, current task
- **TaskManager** — Task CRUD with status transitions and comment system
- **Scheduler** — Cron-based job execution. Manages agent heartbeats
- **ConfigManager** — Loads/validates `~/.squadrn/config.toml`, merges with defaults
- **ActivityLogger** — Audit log of all system actions
- **NotificationManager** — Mention tracking, assignment alerts, delivery/read status
- **AgentRunner** — Coordinates LLM calls for agent reasoning

### `cli/` — `@squadrn/cli`

Entry point and command handlers. Parses arguments and communicates with the gateway via IPC.

## Message Flow

The core flow when a user sends a message through a channel:

```
1. Channel plugin (e.g., Telegram) receives message from user
   │
2. Plugin emits "message:received" event with IncomingMessage payload
   │
3. Gateway routes message to the assigned agent
   │
4. AgentRunner loads agent's session (conversation history + working memory)
   │
5. Agent processes message via its configured LLM plugin
   │  ├── LLM may invoke tools (via completeWithTools)
   │  └── Tool results are fed back to LLM for final response
   │
6. Gateway emits "message:send" event with OutgoingMessage payload
   │
7. Channel plugin delivers the response to the user
   │
8. Channel plugin emits "message:delivered" confirmation
```

## Gateway Lifecycle

```
squadrn start
  │
  ├── Load config from ~/.squadrn/config.toml
  ├── Initialize SQLite storage adapter
  ├── Start EventBus
  ├── Load plugins from registry
  │   ├── Fetch manifest.json from each plugin URL
  │   ├── Validate permissions
  │   ├── Call plugin.register(core) with sandboxed PluginAPI
  │   └── Emit "plugin:loaded" for each
  ├── Restore agent sessions
  ├── Start scheduler (cron jobs + heartbeats)
  ├── Emit "gateway:started"
  └── Listen for events...

squadrn stop
  │
  ├── Emit "gateway:stopping"
  ├── Stop scheduler
  ├── Call plugin.unregister() on all plugins
  ├── Persist sessions
  ├── Close storage
  └── Exit
```

## Event System

The EventBus uses typed event names organized by category:

| Category      | Events                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Lifecycle     | `gateway:started`, `gateway:stopping`, `plugin:loaded`, `plugin:error`, `agent:started`, `agent:stopped`, `agent:error` |
| Messages      | `message:received`, `message:send`, `message:delivered`                                                                 |
| Tasks         | `task:created`, `task:assigned`, `task:updated`, `task:completed`, `task:commented`, `task:status_changed`              |
| Agent         | `agent:heartbeat`, `agent:thinking`, `agent:response`                                                                   |
| Sessions      | `session:created`, `session:updated`, `session:ended`                                                                   |
| Notifications | `notification:created`, `notification:delivered`                                                                        |
| Activities    | `activity:recorded`                                                                                                     |

All 27 event types are defined in the `EventName` union type.

## Storage Model

Storage uses a key-value table with a `collection` column for namespace queries. Keys follow the
pattern `collection:id` (e.g., `agents:abc-123`, `tasks:def-456`).

The default SQLite adapter stores all data in `~/.squadrn/data.db`. The `StorageAdapter` interface
allows swapping to Postgres, Redis, or any other backend via a storage plugin.

## IPC: CLI ↔ Gateway

The CLI communicates with the running gateway daemon through:

1. **Unix sockets** (primary) — fast local communication
2. **HTTP** (fallback) — for remote or web-based access

Gateway lifecycle is tracked via a PID file at `~/.squadrn/gateway.pid`.

## Plugin Sandboxing

Each plugin receives a `PluginAPI` instance that provides:

- **Namespaced storage** — keys are automatically prefixed (e.g., `plugin:telegram:state`)
- **Collection queries** — `storage.query()` for reading agents, tasks, activities, and other
  entities across the system
- **Scoped event access** — subscribe to and emit gateway events
- **Read-only config** — only the plugin's own section from `config.toml`
- **Structured logger** — auto-tagged with plugin name
- **Type-specific hooks** — `registerChannel()`, `registerLLM()`, `registerTool()` based on declared
  type

Plugins declare required Deno permissions upfront in `manifest.json`. The gateway enforces these at
load time.

## Branded ID Types

All entity IDs use TypeScript branded types to prevent accidental mixing:

```typescript
type AgentId = string & { readonly __brand: "AgentId" };
type TaskId = string & { readonly __brand: "TaskId" };
```

This means you cannot pass an `AgentId` where a `TaskId` is expected, even though both are strings
at runtime. Factory functions like `createAgentId()` and `createTaskId()` generate new UUIDs with
the correct brand.
