# @squadrn/llm-claude

Official Claude (Anthropic) LLM plugin for [Squadrn](https://github.com/squadrn/squadrn). Provides
completions, streaming, and tool use via the Anthropic Messages API.

## Setup

### 1. Get an API Key

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Create an account or sign in
3. Navigate to **API Keys** and create a new key

### 2. Set the Key

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

### 3. Install the Plugin

```bash
squadrn plugin add https://github.com/squadrn/llm-claude
```

### 4. Configure an Agent

In `~/.squadrn/config.toml`:

```toml
[agents.scout]
name = "Scout"
role = "Squad Lead"
llm = "claude"
channels = ["telegram"]
heartbeat = "*/15 * * * *"

# Optional: override defaults per-agent
[plugins.llm-claude]
model = "claude-sonnet-4-20250514"
maxTokens = 4096
temperature = 0.7
```

## Features

- **Completions** — standard request/response via the Messages API
- **Streaming** — SSE-based token-by-token streaming via async generators
- **Tool use** — full function-calling support (`tool_use` / `tool_result` blocks)
- **Rate-limit handling** — automatic retry with exponential backoff on 429 and 5xx
- **Per-agent config** — model, maxTokens, and temperature configurable in TOML

## Supported Models

Any model available through the Anthropic Messages API:

- `claude-sonnet-4-20250514` (default)
- `claude-opus-4-20250514`
- `claude-haiku-3-5-20241022`

## Permissions

| Permission | Scope               | Reason             |
| ---------- | ------------------- | ------------------ |
| `net`      | `api.anthropic.com` | Messages API calls |
| `env`      | `ANTHROPIC_API_KEY` | API authentication |

## Development

```bash
# Type-check
deno check mod.ts

# Format
deno fmt

# Lint
deno lint
```
