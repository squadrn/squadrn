# Squadrn

**Plugin-based orchestration layer for AI agent teams.**

Squadrn enables developers to run multiple persistent AI agents that collaborate through shared context, tasks, and communication channels. It doesn't run agents or wrap LLMs — it orchestrates them. Think "Kubernetes for AI agents."

## Core Principles

- **Radical simplicity** — One command to install, interactive wizard to configure
- **Plugin-first architecture** — Core is minimal; LLMs, channels, and tools are all plugins
- **Developer experience** — Strict TypeScript, clear error messages, comprehensive docs
- **SaaS-ready design** — Self-hosted first, architected for future multi-tenancy

## Architecture

```
┌───────────────────────────────────────────────────┐
│                       CLI                         │
│    squadrn start | stop | status | plugin | agent │
└─────────────────────┬─────────────────────────────┘
                      ▼
┌───────────────────────────────────────────────────┐
│                    GATEWAY                         │
│               (Long-running daemon)                │
├───────────────────────────────────────────────────┤
│  Plugin Loader · Event Bus · Scheduler (Cron)     │
│  Session Manager · Storage Adapter · Config Mgr   │
└─────────────────────┬─────────────────────────────┘
            ┌─────────┼─────────┐
            ▼         ▼         ▼
       ┌─────────┐ ┌───────┐ ┌────────┐
       │ Channel │ │  LLM  │ │ Custom │
       │ plugins │ │plugins│ │plugins │
       └─────────┘ └───────┘ └────────┘
```

## Tech Stack

| Component | Choice |
|-----------|--------|
| Runtime | Deno 2.x |
| Language | TypeScript (strict) |
| Storage | SQLite (swappable via adapter interface) |
| IPC | Unix sockets + HTTP fallback |
| Config | TOML |

## Getting Started

```bash
# Install
curl -fsSL https://squadrn.dev/install.sh | sh

# Setup
squadrn init          # Interactive wizard
squadrn start         # Start gateway daemon
squadrn status        # Check running state
```

## CLI Commands

```bash
# Gateway lifecycle
squadrn start / stop / status

# Plugin management
squadrn plugin add <github-url>
squadrn plugin remove <name>
squadrn plugin list

# Agent management
squadrn agent create <name>
squadrn agent list / start / stop / logs <name>

# Task management
squadrn task create
squadrn task list
squadrn task assign <id> <agent>
```

## Plugin System

Plugins provide channels (Telegram, Slack), LLMs (Claude, OpenAI), storage backends, tools, and more. Each plugin declares its required Deno permissions and receives a sandboxed API with namespaced storage, event access, and logging.

Plugin types: `channel` | `llm` | `storage` | `tool` | `ui` | `custom`

See `docs/SQUADRN_SPEC.md` for the full plugin interface and development guide.

## Project Structure

```
squadrn/
├── cli/          # CLI application (@squadrn/cli)
├── core/         # Gateway daemon engine (@squadrn/core)
├── types/        # Shared interfaces & branded IDs (@squadrn/types)
└── docs/         # Specification & documentation
```

## Development

```bash
deno check cli/mod.ts    # Type-check
deno fmt                 # Format
deno lint                # Lint
deno test                # Run all tests
```

## License

MIT
