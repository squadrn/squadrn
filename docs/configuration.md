# Configuration

Squadrn uses TOML for configuration. The main config file lives at `~/.squadrn/config.toml`.

## Generating the Config

Run the interactive wizard to create the initial config:

```bash
squadrn init
```

## Full Reference

### `[gateway]`

Controls the gateway daemon.

```toml
[gateway]
host = "127.0.0.1"     # Bind address
port = 18900            # HTTP/IPC port
log_level = "info"      # "debug" | "info" | "warn" | "error"
```

| Field       | Type       | Default       | Description                                                          |
| ----------- | ---------- | ------------- | -------------------------------------------------------------------- |
| `host`      | `string`   | `"127.0.0.1"` | Address the gateway binds to                                         |
| `port`      | `number`   | `18900`       | Port for HTTP fallback and IPC                                       |
| `log_level` | `LogLevel` | `"info"`      | Minimum log level. `"debug"` for verbose output, `"error"` for quiet |

### `[storage]`

Configures the persistence layer.

```toml
[storage]
adapter = "sqlite"
path = "~/.squadrn/data.db"
```

| Field     | Type     | Default                | Description                                                    |
| --------- | -------- | ---------------------- | -------------------------------------------------------------- |
| `adapter` | `string` | `"sqlite"`             | Storage backend. Default SQLite, swappable via storage plugins |
| `path`    | `string` | `"~/.squadrn/data.db"` | Database file path (for SQLite)                                |

### `[agents.<name>]`

Define one section per agent. The key (`<name>`) is the agent's identifier.

```toml
[agents.jarvis]
name = "Jarvis"
role = "Squad Lead"
llm = "claude"
channels = ["telegram"]
heartbeat = "*/15 * * * *"
soul_file = "~/.squadrn/agents/jarvis/SOUL.md"
```

| Field       | Type       | Default          | Description                                                      |
| ----------- | ---------- | ---------------- | ---------------------------------------------------------------- |
| `name`      | `string`   | _required_       | Display name                                                     |
| `role`      | `string`   | _required_       | Agent's role description                                         |
| `llm`       | `string`   | _required_       | Name of the LLM plugin to use (e.g., `"claude"`, `"openai"`)     |
| `channels`  | `string[]` | `[]`             | Channel plugins this agent listens on. Empty means internal-only |
| `heartbeat` | `string`   | `"*/15 * * * *"` | Cron expression for heartbeat interval                           |
| `soul_file` | `string`   | _required_       | Path to the agent's SOUL.md personality file                     |

### `[plugins.<name>]`

Plugin-specific configuration. Each plugin reads its own section.

```toml
[plugins.channel-telegram]
# Telegram-specific settings

[plugins.llm-claude]
model = "claude-sonnet-4-20250514"
max_tokens = 4096
```

The contents depend entirely on the plugin. Check each plugin's documentation for available options.

## Example: Full Config

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
llm = "claude"
channels = ["telegram"]
heartbeat = "*/15 * * * *"
soul_file = "~/.squadrn/agents/jarvis/SOUL.md"

[agents.loki]
name = "Loki"
role = "Content Writer"
llm = "claude"
channels = []
heartbeat = "*/15 * * * *"
soul_file = "~/.squadrn/agents/loki/SOUL.md"

[plugins.llm-claude]
model = "claude-sonnet-4-20250514"
max_tokens = 4096

[plugins.channel-telegram]
# Uses TELEGRAM_BOT_TOKEN env var
```

## Environment Variables

Some plugins require environment variables (declared in their `manifest.json` permissions):

| Variable             | Plugin             | Description            |
| -------------------- | ------------------ | ---------------------- |
| `TELEGRAM_BOT_TOKEN` | `channel-telegram` | Telegram Bot API token |
| `ANTHROPIC_API_KEY`  | `llm-claude`       | Anthropic API key      |
| `OPENAI_API_KEY`     | `llm-openai`       | OpenAI API key         |

## File Locations

| Path                               | Description                      |
| ---------------------------------- | -------------------------------- |
| `~/.squadrn/config.toml`           | Main configuration file          |
| `~/.squadrn/data.db`               | SQLite database (default)        |
| `~/.squadrn/gateway.pid`           | PID file for the running gateway |
| `~/.squadrn/plugins.json`          | Plugin registry                  |
| `~/.squadrn/agents/<name>/SOUL.md` | Agent personality files          |

## Heartbeat Cron Format

Heartbeats use standard 5-field cron format:

```
┌───────────── minute (0–59)
│ ┌───────────── hour (0–23)
│ │ ┌───────────── day of month (1–31)
│ │ │ ┌───────────── month (1–12)
│ │ │ │ ┌───────────── day of week (0–7, 0 and 7 are Sunday)
│ │ │ │ │
* * * * *
```

Examples:

- `*/15 * * * *` — every 15 minutes (default)
- `*/5 * * * *` — every 5 minutes (more responsive)
- `0 * * * *` — every hour
- `0 9 * * 1-5` — 9 AM on weekdays
