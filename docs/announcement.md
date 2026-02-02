# Announcement Drafts — v0.1.0

## Twitter / X

```
Introducing Squadrn — open-source orchestration for AI agent teams.

- Plugin-first: LLMs, channels, tools are all extensions
- Persistent agents with roles, memory, heartbeats
- Shared task board, @mentions, activity feed
- Built on Deno 2.x, strict TypeScript

curl -fsSL https://squadrn.dev/install.sh | sh

https://github.com/squadrn/squadrn
```

## Hacker News

**Title:** Show HN: Squadrn – Open-source Kubernetes for AI agents

**Text:**

Hey HN, I built Squadrn, an orchestration layer for persistent AI agent teams.

The idea: you define agents (each with a role, an LLM, and channels), and Squadrn handles task routing, session management, heartbeats, and inter-agent coordination. Everything beyond the minimal core is a plugin — LLMs, channels (Telegram, Slack), storage, tools.

Key decisions:
- Deno 2.x with strict TypeScript
- SQLite by default (swappable via adapter interface)
- TOML config
- Plugins declare Deno permissions upfront and get sandboxed API access

What it is NOT: not an agent framework (use LangChain, CrewAI for that), not an LLM wrapper, not a chatbot. It's the infrastructure layer that wires agents together.

v0.1.0 ships with a CLI (init/start/stop/status/plugin/agent/task), a gateway daemon, and two official plugins (Telegram channel + Claude LLM).

GitHub: https://github.com/squadrn/squadrn
Docs: https://github.com/squadrn/squadrn/tree/main/docs

MIT licensed. Feedback welcome.

## Reddit (r/programming, r/artificial, r/selfhosted)

**Title:** Squadrn: open-source orchestration for persistent AI agent teams (plugin-first, Deno/TypeScript)

**Body:**

I've been working on Squadrn, an open-source tool that orchestrates teams of AI agents. Think of it as Kubernetes for AI agents — it doesn't run agents or wrap LLMs, it coordinates them.

Everything is a plugin: LLMs (Claude, OpenAI, local models), channels (Telegram, Slack), storage, tools. The core is minimal. Agents are persistent, have roles, memory, and cron-based heartbeats.

Tech stack: Deno 2.x, strict TypeScript, SQLite, TOML config.

v0.1.0 just shipped. Would love feedback from the community.

https://github.com/squadrn/squadrn
