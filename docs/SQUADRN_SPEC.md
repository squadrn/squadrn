# Squadrn - Project Specification

> **Purpose**: This document defines the architecture, scope, and implementation guidelines for
> Squadrn. Use it as the primary context when working with Claude Code.

---

## 1. Vision

**Squadrn** is an open-source, plugin-based orchestration layer for AI agent teams. It enables
developers to run multiple AI agents that collaborate through shared context, tasks, and
communication channels.

### Core Principles

1. **Radical simplicity**: One `curl` command to install, interactive wizard to configure
2. **Plugin-first architecture**: Core is minimal; everything else is an extension
3. **Developer experience**: TypeScript-strict, excellent error messages, comprehensive docs
4. **SaaS-ready design**: Self-hosted first, but architected for future multi-tenancy

### What Squadrn is NOT

- Not a framework for building individual agents (use OpenClaw, LangChain, etc.)
- Not an LLM wrapper (LLMs are plugins)
- Not a chatbot (channels are plugins)

---

## 2. Technical Stack

| Component | Choice                                           | Rationale                                                                                 |
| --------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Runtime   | **Deno 2.x**                                     | Native TypeScript, URL imports for plugins, permission sandbox, single binary compilation |
| Language  | **TypeScript (strict)**                          | Type safety, better DX, self-documenting interfaces                                       |
| Storage   | **SQLite** (via `StorageAdapter` interface)      | Zero config, portable, swappable for Postgres later                                       |
| IPC       | **Unix sockets** (primary) + **HTTP** (fallback) | Fast local communication, HTTP for remote/web                                             |
| Config    | **TOML**                                         | Human-readable, supports comments, better than JSON/YAML for config                       |

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                              CLI                                 │
│         squadrn start | stop | status | plugin | agent | task      │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                           GATEWAY                                │
│                     (Long-running daemon)                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Plugin    │  │   Event     │  │  Scheduler  │              │
│  │   Loader    │  │    Bus      │  │   (Cron)    │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Session   │  │   Storage   │  │   Config    │              │
│  │   Manager   │  │   Adapter   │  │   Manager   │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │  Plugin  │ │  Plugin  │ │  Plugin  │
              │ Channel  │ │   LLM    │ │  Custom  │
              │ Telegram │ │  Claude  │ │   ...    │
              └──────────┘ └──────────┘ └──────────┘
```

---

## 4. Core Components

### 4.1 CLI (`squadrn`)

Entry point for all user interactions.

```bash
# Installation (single command)
curl -fsSL https://squadrn.dev/install.sh | sh

# Core commands
squadrn init                    # Interactive setup wizard
squadrn start                   # Start gateway daemon
squadrn stop                    # Stop gateway daemon
squadrn status                  # Show running agents, tasks, plugins

# Plugin management
squadrn plugin add <github-url> # Install plugin from GitHub
squadrn plugin remove <name>    # Uninstall plugin
squadrn plugin list             # List installed plugins
squadrn plugin update [name]    # Update plugin(s)

# Agent management
squadrn agent create <name>     # Create new agent (interactive)
squadrn agent list              # List all agents
squadrn agent start <name>      # Start specific agent
squadrn agent stop <name>       # Stop specific agent
squadrn agent logs <name>       # Tail agent logs

# Task management
squadrn task create             # Create task (interactive)
squadrn task list               # List tasks by status
squadrn task assign <id> <agent># Assign task to agent
```

### 4.2 Gateway (Daemon)

Long-running process that orchestrates everything.

**Responsibilities**:

- Load and manage plugins
- Maintain agent sessions
- Route messages between channels and agents
- Execute scheduled tasks (cron)
- Persist state to storage

**Lifecycle**:

```
start → load config → load plugins → restore sessions → listen for events → ...
```

### 4.3 Plugin Loader

Handles discovery, validation, and loading of plugins.

**Plugin installation flow**:

```
1. User runs: squadrn plugin add https://github.com/user/mc-plugin-slack
2. CLI fetches manifest.json from repo
3. CLI validates: required permissions, compatibility, signatures (future)
4. CLI adds entry to ~/.squadrn/plugins.json
5. On next gateway start, plugin is loaded
```

**Plugin loading flow**:

```
1. Read plugins.json
2. For each plugin:
   a. Import from URL (Deno's native URL imports)
   b. Validate exported interface
   c. Call plugin.register(core) with sandboxed core access
   d. Subscribe plugin to relevant events
```

### 4.4 Event Bus

Internal pub/sub system for component communication.

**Event categories**:

```typescript
// Lifecycle events
"gateway:started" | "gateway:stopping";
"plugin:loaded" | "plugin:error";
"agent:started" | "agent:stopped" | "agent:error";

// Message events
"message:received"; // From channel (e.g., Telegram)
"message:send"; // To channel
"message:delivered"; // Confirmation

// Task events
"task:created" | "task:assigned" | "task:updated" | "task:completed";

// Agent events
"agent:heartbeat" | "agent:thinking" | "agent:response";
```

### 4.5 Session Manager

Maintains state for each agent session.

**Session structure**:

```typescript
interface Session {
  id: string;
  agentId: string;
  workspaceId: string; // For future multi-tenancy
  status: "idle" | "active" | "blocked";
  context: {
    conversationHistory: Message[];
    workingMemory: Record<string, unknown>;
    currentTaskId?: string;
  };
  createdAt: Date;
  lastActiveAt: Date;
}
```

### 4.6 Storage Adapter

Abstraction layer for persistence.

```typescript
interface StorageAdapter {
  // Key-value operations
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;

  // Query operations (for tasks, agents, etc.)
  query<T>(collection: string, filter: QueryFilter): Promise<T[]>;

  // Transaction support
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
}

// Default implementation: SQLite
// Future: PostgresAdapter, ConvexAdapter, etc.
```

### 4.7 Scheduler

Cron-based task execution.

```typescript
interface ScheduledJob {
  id: string;
  name: string;
  cron: string; // "*/15 * * * *"
  agentId: string;
  action: "heartbeat" | "task" | "custom";
  payload?: unknown;
  enabled: boolean;
}
```

**Heartbeat system**:

- Each agent has a configurable heartbeat interval (default: 15 min)
- On heartbeat, agent checks: @mentions, assigned tasks, activity feed
- If nothing to do, reports "HEARTBEAT_OK" and sleeps

### 4.8 Config Manager

Handles configuration loading and validation.

**Config file location**: `~/.squadrn/config.toml`

```toml
[gateway]
host = "127.0.0.1"
port = 18900
log_level = "info"

[storage]
adapter = "sqlite"
path = "~/.squadrn/data.db"

[agents.jarvis]
name = "Jarvis"
role = "Squad Lead"
llm = "claude"  # References installed LLM plugin
channels = ["telegram"]
heartbeat = "*/15 * * * *"
soul_file = "~/.squadrn/agents/jarvis/SOUL.md"

[agents.loki]
name = "Loki"
role = "Content Writer"
llm = "claude"
channels = []  # No direct channel, only internal
heartbeat = "*/15 * * * *"
```

---

## 5. Plugin System

### 5.1 Plugin Interface

Every plugin must export a default object implementing this interface:

```typescript
// File: types/plugin.ts

interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  repository: string;

  // What this plugin provides
  type: "channel" | "llm" | "storage" | "tool" | "ui" | "custom";

  // Required permissions (Deno permissions)
  permissions: {
    net?: string[]; // Domains: ["api.telegram.org"]
    read?: string[]; // Paths: ["~/.squadrn/"]
    write?: string[];
    env?: string[]; // Env vars: ["TELEGRAM_BOT_TOKEN"]
    run?: string[]; // Executables
  };

  // Minimum Squadrn version
  minCoreVersion: string;
}

interface Plugin {
  manifest: PluginManifest;

  // Called when plugin is loaded
  register(core: PluginAPI): Promise<void>;

  // Called when gateway is shutting down
  unregister?(): Promise<void>;
}

// What the core exposes to plugins (sandboxed)
interface PluginAPI {
  // Event system
  events: {
    on(event: string, handler: EventHandler): void;
    off(event: string, handler: EventHandler): void;
    emit(event: string, payload: unknown): void;
  };

  // Storage (namespaced to plugin)
  storage: {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<boolean>;
  };

  // Config (read-only, plugin's section only)
  config: Record<string, unknown>;

  // Logging
  log: Logger;

  // Registration hooks based on plugin type
  registerChannel?(channel: ChannelProvider): void;
  registerLLM?(llm: LLMProvider): void;
  registerTool?(tool: ToolProvider): void;
}
```

### 5.2 Channel Plugin Interface

```typescript
interface ChannelProvider {
  name: string; // "telegram", "slack", etc.

  // Initialize connection
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Message handling
  onMessage(handler: (msg: IncomingMessage) => void): void;
  sendMessage(msg: OutgoingMessage): Promise<void>;

  // Optional: typing indicators, read receipts, etc.
  sendTyping?(chatId: string): Promise<void>;
}

interface IncomingMessage {
  id: string;
  channelName: string;
  chatId: string;
  userId: string;
  userName?: string;
  content: string;
  attachments?: Attachment[];
  replyTo?: string;
  timestamp: Date;
}

interface OutgoingMessage {
  chatId: string;
  content: string;
  replyTo?: string;
  attachments?: Attachment[];
}
```

### 5.3 LLM Plugin Interface

```typescript
interface LLMProvider {
  name: string; // "claude", "openai", "ollama"

  // Core completion
  complete(request: CompletionRequest): Promise<CompletionResponse>;

  // Streaming support
  stream?(request: CompletionRequest): AsyncIterable<StreamChunk>;

  // Tool/function calling
  supportsTools: boolean;
  completeWithTools?(
    request: CompletionRequest,
    tools: ToolDefinition[],
  ): Promise<CompletionWithToolsResponse>;
}

interface CompletionRequest {
  model?: string; // Plugin can have default
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

interface CompletionResponse {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason: "end" | "max_tokens" | "stop_sequence";
}
```

### 5.4 Plugin Directory Structure

```
mc-plugin-telegram/
├── mod.ts              # Entry point, exports Plugin
├── manifest.json       # Plugin metadata
├── src/
│   ├── client.ts       # Telegram API client
│   └── handlers.ts     # Message handlers
├── README.md
└── deno.json           # Deno config (optional)
```

**manifest.json example**:

```json
{
  "name": "@squadrn/channel-telegram",
  "version": "1.0.0",
  "description": "Telegram channel for Squadrn",
  "author": "Your Name",
  "repository": "https://github.com/you/mc-plugin-telegram",
  "type": "channel",
  "permissions": {
    "net": ["api.telegram.org"],
    "env": ["TELEGRAM_BOT_TOKEN"]
  },
  "minCoreVersion": "0.1.0"
}
```

**mod.ts example**:

```typescript
import { ChannelProvider, Plugin, PluginAPI } from "https://squadrn.dev/types/mod.ts";
import manifest from "./manifest.json" with { type: "json" };
import { TelegramClient } from "./src/client.ts";

const plugin: Plugin = {
  manifest,

  async register(core: PluginAPI) {
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN required");

    const client = new TelegramClient(token, core.log);

    const channel: ChannelProvider = {
      name: "telegram",
      connect: () => client.connect(),
      disconnect: () => client.disconnect(),
      onMessage: (handler) => client.onMessage(handler),
      sendMessage: (msg) => client.send(msg),
      sendTyping: (chatId) => client.sendTyping(chatId),
    };

    core.registerChannel!(channel);
    core.log.info("Telegram channel registered");
  },

  async unregister() {
    // Cleanup
  },
};

export default plugin;
```

---

## 6. Data Models

### 6.1 Agent

```typescript
interface Agent {
  id: string;
  workspaceId: string;
  name: string;
  role: string;
  status: "idle" | "active" | "blocked" | "offline";

  // Configuration
  llm: string; // Plugin name
  channels: string[]; // Plugin names
  heartbeatCron: string;
  soulFile: string; // Path to SOUL.md

  // State
  currentTaskId?: string;
  currentSessionId?: string;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}
```

### 6.2 Task

```typescript
interface Task {
  id: string;
  workspaceId: string;

  title: string;
  description: string;
  status: "inbox" | "assigned" | "in_progress" | "review" | "done" | "blocked";
  priority: "low" | "medium" | "high" | "urgent";

  // Assignment
  assigneeIds: string[]; // Agent IDs
  creatorId?: string; // Agent or user ID

  // Relationships
  parentTaskId?: string;
  dependsOn: string[];

  // Activity
  comments: Comment[];
  attachments: Attachment[];

  // Metadata
  tags: string[];
  dueDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

interface Comment {
  id: string;
  taskId: string;
  authorId: string; // Agent ID
  authorName: string;
  content: string;
  mentions: string[]; // Agent IDs mentioned with @
  createdAt: Date;
}
```

### 6.3 Activity

```typescript
interface Activity {
  id: string;
  workspaceId: string;

  type:
    | "task_created"
    | "task_assigned"
    | "task_status_changed"
    | "task_commented"
    | "agent_started"
    | "agent_stopped"
    | "agent_heartbeat"
    | "message_received"
    | "message_sent";

  actorId: string; // Who did it
  actorType: "agent" | "user" | "system";

  targetType: "task" | "agent" | "message";
  targetId: string;

  data: Record<string, unknown>; // Event-specific data

  createdAt: Date;
}
```

### 6.4 Notification

```typescript
interface Notification {
  id: string;
  workspaceId: string;

  recipientId: string; // Agent ID
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

---

## 7. Directory Structure

```
squadrn/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml
│   │   └── release.yml
│   └── CONTRIBUTING.md
│
├── cli/                        # CLI application
│   ├── mod.ts                  # Entry point
│   ├── commands/
│   │   ├── init.ts
│   │   ├── start.ts
│   │   ├── stop.ts
│   │   ├── status.ts
│   │   ├── plugin.ts
│   │   ├── agent.ts
│   │   └── task.ts
│   └── utils/
│       ├── wizard.ts           # Interactive prompts
│       ├── config.ts
│       └── output.ts           # Formatting, colors
│
├── core/                       # Core gateway
│   ├── mod.ts
│   ├── gateway.ts
│   ├── plugin_loader.ts
│   ├── event_bus.ts
│   ├── session_manager.ts
│   ├── scheduler.ts
│   ├── config_manager.ts
│   └── storage/
│       ├── adapter.ts          # Interface
│       └── sqlite.ts           # Default implementation
│
├── types/                      # Shared types (published)
│   ├── mod.ts                  # Re-exports all
│   ├── plugin.ts
│   ├── channel.ts
│   ├── llm.ts
│   ├── models.ts               # Agent, Task, etc.
│   └── events.ts
│
├── plugins/                    # Official plugins (separate repos, linked here for dev)
│   ├── channel-telegram/
│   └── llm-claude/
│
├── scripts/
│   └── install.sh              # curl installer
│
├── docs/
│   ├── getting-started.md
│   ├── architecture.md
│   ├── plugin-development.md
│   └── api-reference.md
│
├── deno.json                   # Workspace config
├── deno.lock
├── README.md
└── LICENSE                     # MIT
```

---

## 8. MVP Scope (v0.1.0)

### Must Have

1. **CLI**
   - `squadrn init` - Interactive wizard (creates config, dirs)
   - `squadrn start` / `squadrn stop` - Gateway lifecycle
   - `squadrn status` - Show running state
   - `squadrn plugin add/remove/list` - Plugin management

2. **Core Gateway**
   - Plugin loader with URL imports
   - Event bus (in-memory)
   - SQLite storage adapter
   - Basic config manager (TOML)

3. **Plugin System**
   - Types published at URL
   - Channel interface
   - LLM interface
   - Permission validation

4. **Official Plugins**
   - `@squadrn/channel-telegram` (basic: receive/send)
   - `@squadrn/llm-claude` (basic: completion)

5. **Agent Basics**
   - SOUL.md loading
   - Single agent execution
   - Basic heartbeat

### Nice to Have (v0.2.0)

- Multi-agent coordination
- Task management
- @mentions and notifications
- Activity feed
- Dashboard UI plugin

### Future (v0.3.0+)

- Workflow engine
- Agent-to-agent delegation
- Memory/RAG integration
- SaaS multi-tenancy

---

## 9. Development Guidelines

### Code Style

```typescript
// Use explicit types, no `any`
function processMessage(msg: IncomingMessage): ProcessedMessage { ... }

// Prefer interfaces over types for objects
interface Agent { ... }

// Use branded types for IDs
type AgentId = string & { readonly __brand: "AgentId" };
type TaskId = string & { readonly __brand: "TaskId" };

// Errors: use custom error classes
class PluginLoadError extends Error {
  constructor(
    public readonly pluginName: string,
    public readonly cause: Error
  ) {
    super(`Failed to load plugin "${pluginName}": ${cause.message}`);
  }
}

// Async: always use async/await, never raw Promises
async function loadPlugin(url: string): Promise<Plugin> {
  const module = await import(url);
  return module.default;
}
```

### Testing

```typescript
// Use Deno's built-in test runner
// File: core/event_bus_test.ts

import { assertEquals } from "https://deno.land/std/assert/mod.ts";
import { EventBus } from "./event_bus.ts";

Deno.test("EventBus - emits events to subscribers", async () => {
  const bus = new EventBus();
  const received: string[] = [];

  bus.on("test:event", (data) => received.push(data as string));
  await bus.emit("test:event", "hello");

  assertEquals(received, ["hello"]);
});
```

### Logging

```typescript
// Use structured logging
log.info("Plugin loaded", { plugin: manifest.name, version: manifest.version });
log.error("Failed to connect", { channel: "telegram", error: err.message });

// Levels: debug, info, warn, error
// Format: JSON in production, pretty in development
```

### Error Handling

```typescript
// Always handle errors explicitly
try {
  await plugin.register(core);
} catch (err) {
  log.error("Plugin registration failed", { plugin: name, error: err });
  throw new PluginLoadError(name, err);
}

// Use Result type for expected failures
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

async function parseConfig(path: string): Promise<Result<Config, ConfigError>> {
  // ...
}
```

---

## 10. Installation Script

```bash
#!/bin/sh
# install.sh - Squadrn installer

set -e

REPO="squadrn/squadrn"
INSTALL_DIR="${SQUADRN_INSTALL_DIR:-$HOME/.squadrn}"
BIN_DIR="${SQUADRN_BIN_DIR:-$HOME/.local/bin}"

# Detect OS and arch
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case $ARCH in
  x86_64) ARCH="x86_64" ;;
  arm64|aarch64) ARCH="aarch64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

# Get latest version
VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)

# Download binary
URL="https://github.com/$REPO/releases/download/$VERSION/squadrn-$OS-$ARCH"
echo "Downloading Squadrn $VERSION..."
curl -fsSL "$URL" -o "$BIN_DIR/squadrn"
chmod +x "$BIN_DIR/squadrn"

# Create config directory
mkdir -p "$INSTALL_DIR"

echo ""
echo "✓ Squadrn installed!"
echo ""
echo "Run 'squadrn init' to get started."
```

---

## 11. Claude Code Instructions

When working on this project with Claude Code, use these guidelines:

### Starting a Session

```
I'm working on Squadrn, an open-source multi-agent orchestration platform.

Key context:
- Runtime: Deno 2.x with strict TypeScript
- Architecture: Plugin-based, minimal core
- Storage: SQLite via adapter interface
- Current focus: [specific feature]

The full spec is in MISSION_CONTROL_SPEC.md

[Your specific request]
```

### Coding Requests

Be specific about:

1. Which component you're working on (CLI, core, plugin)
2. Whether you need new code or modifications
3. What interfaces/types already exist
4. How it should integrate with existing code

Example:

```
Implement the EventBus class in core/event_bus.ts.

Requirements:
- Follows the interface in types/events.ts
- Supports async handlers
- Handlers for same event run in parallel
- Errors in one handler don't block others
- Include tests in event_bus_test.ts
```

### Architecture Decisions

When you need help with design decisions, frame it as:

```
I need to decide how to [problem].

Options I'm considering:
1. [Option A] - pros/cons
2. [Option B] - pros/cons

Context: [relevant constraints]

What do you recommend and why?
```

---

## 12. Roadmap

### Phase 1: Foundation (Weeks 1-2)

- [ ] Project setup (Deno workspace, CI)
- [ ] CLI skeleton with init, start, stop
- [ ] Core gateway with event bus
- [ ] Plugin loader (basic)
- [ ] SQLite storage adapter

### Phase 2: Plugin System (Weeks 3-4)

- [ ] Type definitions published
- [ ] Permission validation
- [ ] Telegram channel plugin
- [ ] Claude LLM plugin
- [ ] Plugin add/remove commands

### Phase 3: Agents (Weeks 5-6)

- [ ] Agent configuration
- [ ] SOUL.md loading
- [ ] Session management
- [ ] Heartbeat scheduler
- [ ] Basic agent execution

### Phase 4: Polish (Weeks 7-8)

- [ ] Error handling and recovery
- [ ] Logging and observability
- [ ] Documentation
- [ ] Installation script
- [ ] First release (v0.1.0)

---

## Appendix A: Branding

**Final name**: Squadrn (pronounced "squadron")

**Assets to create**:

- Logo (simple, geometric, evokes coordination/teamwork)
- Domain: squadrn.dev
- GitHub org: github.com/squadrn (available)
- Package: deno.land/x/squadrn or jsr.io/@squadrn

---

## Appendix B: Competitive Landscape

| Project   | Overlap       | Differentiation                                         |
| --------- | ------------- | ------------------------------------------------------- |
| OpenClaw  | Agent runtime | MC is orchestration layer, could use OpenClaw as plugin |
| CrewAI    | Multi-agent   | MC is infrastructure, CrewAI is framework               |
| AutoGen   | Multi-agent   | MC focuses on persistent agents, not conversations      |
| LangGraph | Workflows     | MC is higher-level, graph-agnostic                      |

**Positioning**: Squadrn is the "Kubernetes for AI agents" - it doesn't run the agents, it
orchestrates them.

---

_Document version: 1.0.0_ _Last updated: 2026-02-01_
