# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Squadrn is a plugin-based orchestration layer for AI agent teams built on Deno 2.x with strict TypeScript. It orchestrates persistent AI agents — it doesn't run them (LLMs are plugins). Channels (Telegram, Slack) are also plugins. The full specification lives in `docs/SQUADRN_SPEC.md`.

## Commands

```bash
deno check cli/mod.ts          # Type-check the project
deno fmt                       # Format (100 char lines, 2-space indent)
deno lint                      # Lint with recommended rules
deno test                      # Run all tests
deno test core/event_bus_test.ts  # Run a single test file

# Run the CLI locally
deno run --allow-all cli/mod.ts init
deno run --allow-all cli/mod.ts start
deno run --allow-all cli/mod.ts stop
deno run --allow-all cli/mod.ts status
```

## Architecture

Three workspace modules (`types`, `core`, `cli`) configured in the root `deno.json`:

- **`types/`** (`@squadrn/types`) — Shared interfaces consumed by core, CLI, and external plugins. Branded ID types (`AgentId`, `TaskId`, etc.) prevent mixing identifiers. Published as the plugin contract (plugins import from this).
- **`core/`** (`@squadrn/core`) — Gateway daemon engine. `Gateway` orchestrates startup: loads TOML config → initializes SQLite storage → emits lifecycle events via `EventBus`. Storage uses a key-value table with a `collection` column for namespace queries (e.g., `"agents:xyz"`).
- **`cli/`** (`@squadrn/cli`) — Entry point (`mod.ts`) parses args and routes to command handlers in `commands/`. Gateway lifecycle is managed via PID file at `~/.squadrn/gateway.pid`.

### Gateway internals

The gateway is a long-running daemon with these core components:

- **EventBus** — In-memory pub/sub. Events are typed (`EventName` union). Handlers for the same event run in parallel; one handler's error doesn't block others.
- **PluginLoader** — Fetches plugin from GitHub URL, validates manifest permissions, loads via Deno URL imports, calls `plugin.register(core)` with sandboxed API.
- **SessionManager** — Maintains per-agent state: conversation history, working memory, current task.
- **Scheduler** — Cron-based. Each agent has a heartbeat (default `*/15 * * * *`). On heartbeat, agents check mentions, assigned tasks, activity feed.
- **ConfigManager** — Loads/validates `~/.squadrn/config.toml`. Merges with defaults.
- **StorageAdapter** — Interface with SQLite default. Swappable for Postgres, etc.

### Plugin system

Plugins have a `type`: `channel`, `llm`, `storage`, `tool`, `ui`, or `custom`. Each declares required Deno permissions in its manifest. Plugins receive a sandboxed `PluginAPI` with namespaced storage, event access, read-only config, and a logger. Type-specific hooks: `registerChannel()`, `registerLLM()`.

Plugin directory convention: `mc-plugin-<name>/` with `mod.ts` (entry), `manifest.json` (metadata), and `src/`.

### Message flow

```
Channel plugin (e.g., Telegram) receives message
  → emits "message:received"
  → Gateway routes to assigned agent
  → Agent processes via LLM plugin
  → emits "message:send"
  → Channel plugin delivers response
  → emits "message:delivered"
```

### Data model

Core entities: `Agent` (has role, LLM, channels, SOUL.md file, heartbeat cron), `Task` (inbox → assigned → in_progress → review → done/blocked, with priorities, dependencies, parent tasks), `Session` (conversation history + working memory per agent), `Activity` (audit log of all actions), `Notification` (mentions, assignments, delivered/read tracking).

All IDs are branded string types to prevent misuse across entity boundaries.

## Conventions

- `Result<T, E>` type for expected failures (not exceptions). Exceptions for unexpected errors only.
- Custom error classes with context (e.g., `PluginLoadError` includes plugin name and cause).
- Prefer interfaces over type aliases for objects.
- Explicit types everywhere, no `any`.
- Always `async/await`, never raw Promises.
- Structured logging: `log.info("msg", { key: value })`. JSON in production, pretty in dev.
- Config format is TOML (supports comments, human-readable).
- All dependencies from JSR (`@std/*`, `@db/sqlite`). Plugin imports use Deno URL imports.
- `noUncheckedIndexedAccess: true` — index access returns `T | undefined`.
- IPC: Unix sockets (primary) + HTTP (fallback) for CLI ↔ Gateway communication.
- `workspaceId` field on all entities prepares for future multi-tenancy.
