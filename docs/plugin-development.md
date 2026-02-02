# Plugin Development

This guide covers building Squadrn plugins from scratch. Plugins extend Squadrn's capabilities —
channels, LLMs, tools, storage, UI, or custom functionality.

## Plugin Types

| Type      | Purpose                                | Registration Hook        |
| --------- | -------------------------------------- | ------------------------ |
| `channel` | Messaging platform integrations        | `core.registerChannel()` |
| `llm`     | Language model backends                | `core.registerLLM()`     |
| `tool`    | Agent capabilities (search, code exec) | `core.registerTool()`    |
| `storage` | Alternative persistence backends       | —                        |
| `ui`      | Dashboards, monitoring                 | —                        |
| `custom`  | Anything else                          | —                        |

## Directory Structure

```
mc-plugin-<name>/
├── mod.ts              # Entry point — exports Plugin
├── manifest.json       # Plugin metadata and permissions
├── src/
│   ├── client.ts       # Platform-specific logic
│   └── handlers.ts     # Event handlers
├── README.md
└── deno.json           # Optional Deno config
```

## Step 1: Create the Manifest

Every plugin needs a `manifest.json`:

```json
{
  "name": "@yourname/channel-slack",
  "version": "1.0.0",
  "description": "Slack channel for Squadrn",
  "author": "Your Name",
  "repository": "https://github.com/yourname/mc-plugin-slack",
  "type": "channel",
  "permissions": {
    "net": ["slack.com", "api.slack.com"],
    "env": ["SLACK_BOT_TOKEN"]
  },
  "minCoreVersion": "0.1.0"
}
```

### Permissions

Plugins declare required Deno permissions upfront. Users can audit these before installing.

```typescript
interface PluginPermissions {
  net?: string[]; // Allowed network domains
  read?: string[]; // File-system read paths
  write?: string[]; // File-system write paths
  env?: string[]; // Required environment variables
  run?: string[]; // Executables the plugin may spawn
}
```

## Step 2: Implement the Plugin

The entry point (`mod.ts`) must default-export an object implementing the `Plugin` interface:

```typescript
import type { Plugin, PluginAPI } from "@squadrn/types";
import manifest from "./manifest.json" with { type: "json" };

const plugin: Plugin = {
  manifest,

  async register(core: PluginAPI) {
    core.log.info("Plugin loaded");
    // Initialize and register providers here
  },

  async unregister() {
    // Cleanup: close connections, release resources
  },
};

export default plugin;
```

## The PluginAPI

Each plugin receives a sandboxed `PluginAPI` instance during registration:

### Events

Subscribe to and emit gateway events:

```typescript
async register(core: PluginAPI) {
  core.events.on("message:received", async (payload) => {
    // Handle incoming messages
  });

  core.events.emit("message:send", {
    chatId: "123",
    content: "Hello!",
  });
}
```

### Storage

Key-value storage automatically namespaced to your plugin:

```typescript
await core.storage.set("last_sync", Date.now());
const lastSync = await core.storage.get<number>("last_sync");
await core.storage.delete("last_sync");

// Query entities by collection with optional filters
const agents = await core.storage.query<Agent>("agents", { limit: 10 });
const urgentTasks = await core.storage.query<Task>("tasks", {
  where: { priority: "urgent" },
  orderBy: "createdAt",
});
```

Keys are prefixed internally — `core.storage.get("state")` in plugin `channel-telegram` resolves to
`plugin:channel-telegram:state`. The `query()` method operates on global collections (e.g.,
`"agents"`, `"tasks"`, `"activities"`) and is not namespaced — useful for UI and monitoring plugins
that need to read cross-cutting data.

### Config

Read-only access to your plugin's section from `config.toml`:

```typescript
const model = core.config.model as string ?? "default-model";
```

### Logger

Structured logging tagged with your plugin name:

```typescript
core.log.debug("Verbose detail", { key: "value" });
core.log.info("Normal operation");
core.log.warn("Something unexpected");
core.log.error("Something failed", { error: err.message });
```

Output is JSON in production, pretty-printed in development.

## Building a Channel Plugin

Implement the `ChannelProvider` interface and register it:

```typescript
import type { ChannelProvider, Plugin, PluginAPI } from "@squadrn/types";
import manifest from "./manifest.json" with { type: "json" };

const plugin: Plugin = {
  manifest,

  async register(core: PluginAPI) {
    const token = Deno.env.get("SLACK_BOT_TOKEN");
    if (!token) throw new Error("SLACK_BOT_TOKEN required");

    const channel: ChannelProvider = {
      name: "slack",

      async connect() {
        // Establish WebSocket connection to Slack
      },

      async disconnect() {
        // Close connection gracefully
      },

      onMessage(handler) {
        // Wire incoming Slack messages to the handler
      },

      async sendMessage(msg) {
        // Send msg.content to msg.chatId via Slack API
      },

      async sendTyping(chatId) {
        // Optional: show typing indicator
      },
    };

    core.registerChannel!(channel);
    core.log.info("Slack channel registered");
  },
};

export default plugin;
```

### ChannelProvider Interface

```typescript
interface ChannelProvider {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => void): void;
  sendMessage(msg: OutgoingMessage): Promise<void>;
  sendTyping?(chatId: string): Promise<void>;
}
```

## Building an LLM Plugin

Implement the `LLMProvider` interface:

```typescript
import type { LLMProvider, Plugin, PluginAPI } from "@squadrn/types";
import manifest from "./manifest.json" with { type: "json" };

const plugin: Plugin = {
  manifest,

  async register(core: PluginAPI) {
    const apiKey = Deno.env.get("API_KEY");

    const llm: LLMProvider = {
      name: "my-llm",
      supportsTools: true,

      async complete(request) {
        // Call your LLM API and return CompletionResponse
        return {
          content: "response text",
          usage: { inputTokens: 100, outputTokens: 50 },
          stopReason: "end",
        };
      },

      async *stream(request) {
        // Optional: yield StreamChunk objects
        yield { content: "partial ", done: false };
        yield { content: "response", done: true };
      },

      async completeWithTools(request, tools) {
        // Handle tool/function calling
        return {
          content: "",
          usage: { inputTokens: 100, outputTokens: 50 },
          stopReason: "tool_use",
          toolCalls: [{
            id: "call_1",
            name: "web_search",
            arguments: { query: "example" },
          }],
        };
      },
    };

    core.registerLLM!(llm);
  },
};

export default plugin;
```

### LLMProvider Interface

```typescript
interface LLMProvider {
  name: string;
  supportsTools: boolean;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream?(request: CompletionRequest): AsyncIterable<StreamChunk>;
  completeWithTools?(
    request: CompletionRequest,
    tools: ToolDefinition[],
  ): Promise<CompletionWithToolsResponse>;
}
```

## Building a Tool Plugin

Tools give agents new capabilities:

```typescript
import type { Plugin, PluginAPI, ToolProvider } from "@squadrn/types";
import manifest from "./manifest.json" with { type: "json" };

const plugin: Plugin = {
  manifest,

  async register(core: PluginAPI) {
    const tool: ToolProvider = {
      name: "web_search",

      definition: {
        name: "web_search",
        description: "Search the web for information",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
          },
          required: ["query"],
        },
      },

      async execute(args) {
        const query = args.query as string;
        const results = await performSearch(query);
        return { content: JSON.stringify(results) };
      },
    };

    core.registerTool!(tool);
  },
};

export default plugin;
```

## Building a UI Plugin

UI plugins render dashboards, monitoring views, or interactive interfaces. They subscribe to gateway
events for real-time updates and use `storage.query()` to load initial state.

```typescript
import type { Agent, Plugin, PluginAPI, Task } from "@squadrn/types";
import manifest from "./manifest.json" with { type: "json" };

const plugin: Plugin = {
  manifest, // type: "ui"

  async register(core: PluginAPI) {
    // Load current state from storage
    const agents = await core.storage.query<Agent>("agents", {});
    const tasks = await core.storage.query<Task>("tasks", {});

    // Subscribe to real-time events
    core.events.on("agent:started", async (payload) => {
      // Update UI with new agent status
    });

    core.events.on("task:created", async (payload) => {
      // Update UI with new task
    });

    // Launch your rendering loop (TUI, web server, etc.)
    core.log.info("UI plugin started");
  },

  async unregister() {
    // Stop rendering, restore terminal, close server
  },
};

export default plugin;
```

The official `@squadrn/ui-terminal` plugin is a full example of this pattern — an interactive
terminal UI with keyboard navigation, multiple views (dashboard, agents, tasks, activity log), and
real-time event updates. See `plugins/ui-terminal/` in the repository.

## Installing Your Plugin

During development, test locally by pointing to your repo:

```bash
squadrn plugin add https://github.com/yourname/mc-plugin-slack
```

The gateway fetches `manifest.json` from the repo, validates permissions, and registers the plugin
in `~/.squadrn/plugins.json`. On the next start, the plugin is loaded.

## Best Practices

1. **Declare minimal permissions** — only request what you actually need
2. **Handle errors gracefully** — use structured logging, don't crash the gateway
3. **Clean up in `unregister()`** — close connections, stop polling, release resources
4. **Use namespaced storage** — the API handles prefixing, but keep your keys organized
5. **Follow the naming convention** — `mc-plugin-<name>/` for the directory
6. **Include a README** — document config options, required env vars, and usage
7. **Use `@squadrn/types`** — import all types from the published package for type safety
