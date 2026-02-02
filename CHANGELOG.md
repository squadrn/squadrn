# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-02

### Added

- CLI with `init`, `start`, `stop`, `status`, `plugin`, `agent`, and `task` commands
- Gateway daemon with event bus, plugin loader, session manager, scheduler, and config manager
- SQLite storage adapter with key-value and collection query support
- Plugin system supporting `channel`, `llm`, `storage`, `tool`, `ui`, and `custom` types
- Sandboxed plugin API with namespaced storage, event bus access, and structured logging
- Official plugin: `@squadrn/channel-telegram` (receive/send messages)
- Official plugin: `@squadrn/llm-claude` (completion via Anthropic API)
- Shared type definitions (`@squadrn/types`) with branded ID types
- TOML-based configuration (`~/.squadrn/config.toml`)
- Agent SOUL.md loading and heartbeat scheduler
- Task management with status workflow (inbox -> assigned -> in_progress -> review -> done)
- Activity logging and notification system
- CI/CD workflows (lint, format, type check, test across OS matrix; release with compiled binaries)
- Documentation: getting started, architecture, configuration, plugin development, agents, API reference
- Install script for Linux and macOS

[0.1.0]: https://github.com/squadrn/squadrn/releases/tag/v0.1.0
