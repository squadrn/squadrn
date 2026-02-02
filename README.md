<div align="center">

# Squadrn

### Kubernetes for AI agents.

**Orchestrate persistent AI agent teams with a plugin-first architecture.**
**Squadrn doesn't run agents or wrap LLMs — it coordinates them.**

[Get Started](#getting-started) · [Docs](docs/SQUADRN_SPEC.md) · [Plugins](#plugin-system)

---

</div>

## What is Squadrn?

Squadrn is an orchestration layer that lets multiple AI agents collaborate through shared context, tasks, and communication channels. You bring your own LLMs, your own channels, your own tools — Squadrn wires them together.

```
You define agents → Squadrn assigns tasks, routes messages, manages sessions
Agents think via LLM plugins → Squadrn delivers responses through channel plugins
Everything is a plugin → Swap any piece without touching the rest
```

### Why Squadrn?

| Problem | Squadrn's approach |
|---|---|
| Agent frameworks lock you into one LLM | LLMs are plugins — use Claude, GPT, Llama, or all three |
| No coordination between agents | Shared task board, mentions, activity feed |
| Hard to add new capabilities | `squadrn plugin add <url>` and done |
| Complex deployment | Single daemon, one command to start |

## Getting Started

```bash
# Install
curl -fsSL https://squadrn.dev/install.sh | sh

# Configure interactively
squadrn init

# Launch the gateway daemon
squadrn start
```

That's it. Add agents, connect channels, assign tasks.

## Architecture

```
  CLI ──────────────────────────────────────────────────
  squadrn start | stop | status | plugin | agent
         │
         ▼
  GATEWAY (daemon) ─────────────────────────────────────
  Plugin Loader · Event Bus · Scheduler · Session Manager
  Storage Adapter · Config Manager
         │
         ├──→  Channel plugins   (Telegram, Slack, ...)
         ├──→  LLM plugins       (Claude, OpenAI, ...)
         └──→  Custom plugins    (tools, storage, UI)
```

**Message flow:** Channel receives message → Gateway routes to agent → Agent thinks via LLM → Gateway delivers response through channel.

## CLI

```bash
squadrn start | stop | status       # Gateway lifecycle

squadrn agent create <name>         # Create an agent
squadrn agent list                  # List all agents
squadrn agent logs <name>           # Stream agent logs

squadrn plugin add <github-url>     # Install a plugin
squadrn plugin list                 # List installed plugins

squadrn task create                 # Create a task
squadrn task assign <id> <agent>    # Assign to an agent
```

## Plugin System

Everything beyond the core is a plugin. Six types:

| Type | Examples |
|---|---|
| `channel` | Telegram, Slack, Discord |
| `llm` | Claude, OpenAI, local models |
| `storage` | Postgres, Redis |
| `tool` | Web search, code execution |
| `ui` | Dashboard, monitoring |
| `custom` | Anything else |

Each plugin declares its Deno permissions upfront and gets a sandboxed API with namespaced storage, event bus access, and structured logging. No plugin can touch another plugin's data.

## Tech Stack

**Deno 2.x** · **Strict TypeScript** · **SQLite** (swappable) · **TOML config** · **Unix sockets + HTTP**

## Project Structure

```
squadrn/
├── types/   @squadrn/types   — Branded IDs, shared interfaces (the plugin contract)
├── core/    @squadrn/core    — Gateway daemon engine
├── cli/     @squadrn/cli     — CLI entry point and commands
└── docs/                     — Full specification
```

## Development

```bash
deno check cli/mod.ts    # Type-check
deno fmt                 # Format
deno lint                # Lint
deno task test           # Run all tests (core + CLI, 70 tests)
```

To run a specific test file:

```bash
deno test --allow-all core/gateway_test.ts
deno test --allow-all cli/commands/start_test.ts
```

## License

MIT
