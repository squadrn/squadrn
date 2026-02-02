# Getting Started

This guide walks you through installing Squadrn, configuring your first agent, connecting a channel,
and sending your first message.

## Installation

```bash
curl -fsSL https://squadrn.dev/install.sh | sh
```

This installs the `squadrn` CLI binary. Squadrn requires [Deno 2.x](https://deno.com) as its
runtime.

Verify the installation:

```bash
squadrn --version
```

### Uninstalling

To remove Squadrn completely:

```bash
curl -fsSL https://squadrn.dev/uninstall.sh | sh
```

This stops the gateway if running, removes the binary, and optionally deletes all data at
`~/.squadrn/` (config, database, sessions, plugins).

## Initial Setup

Run the interactive setup wizard:

```bash
squadrn init
```

This creates `~/.squadrn/config.toml` with default settings:

```toml
[gateway]
host = "127.0.0.1"
port = 18900
log_level = "info"

[storage]
adapter = "sqlite"
path = "~/.squadrn/data.db"
```

The wizard also creates the data directory at `~/.squadrn/` where all Squadrn state lives — config,
database, agent files, and plugin registry.

## Starting the Gateway

The gateway is the long-running daemon that orchestrates everything:

```bash
squadrn start
```

Check that it's running:

```bash
squadrn status
```

Stop it with:

```bash
squadrn stop
```

## Creating Your First Agent

Create an agent interactively:

```bash
squadrn agent create scout
```

Or configure it directly in `~/.squadrn/config.toml`:

```toml
[agents.scout]
name = "Scout"
role = "Squad Lead"
llm = "claude"
channels = ["telegram"]
heartbeat = "*/15 * * * *"
soul_file = "~/.squadrn/agents/scout/SOUL.md"
```

### The SOUL.md File

Every agent needs a `SOUL.md` file that defines its personality and behavior. Create one at the path
specified in the config:

```markdown
# Scout — Squad Lead

## Identity

You are Scout, the lead coordinator for a team of AI agents.

## Responsibilities

- Triage incoming tasks and assign them to the right agent
- Answer direct questions from users
- Monitor task progress and follow up on blocked items

## Communication Style

- Professional but approachable
- Concise responses unless detail is requested
- Always acknowledge tasks before starting work
```

## Installing Plugins

Squadrn doesn't include any LLMs or channels out of the box — they're all plugins. Install the ones
you need:

### Add an LLM plugin

```bash
squadrn plugin add https://github.com/squadrn/llm-claude
```

### Add a channel plugin

```bash
squadrn plugin add https://github.com/squadrn/channel-telegram
```

### List installed plugins

```bash
squadrn plugin list
```

## Connecting Telegram

After installing the Telegram channel plugin:

1. Create a Telegram bot via [@BotFather](https://t.me/BotFather) and get the token.

2. Set the token as an environment variable:

   ```bash
   export TELEGRAM_BOT_TOKEN="your-bot-token-here"
   ```

3. Add plugin configuration to `~/.squadrn/config.toml`:

   ```toml
   [plugins.channel-telegram]
   # Plugin-specific settings go here
   ```

4. Make sure your agent has `"telegram"` in its `channels` list.

5. Restart the gateway:

   ```bash
   squadrn stop && squadrn start
   ```

6. Send a message to your bot on Telegram — Scout will respond!

## Creating Tasks

Create a task for your agents:

```bash
squadrn task create
```

Assign it to an agent:

```bash
squadrn task assign <task-id> scout
```

List all tasks:

```bash
squadrn task list
```

Tasks flow through these statuses:

```
inbox → assigned → in_progress → review → done
                                        ↘ blocked
```

## Next Steps

- [Architecture](architecture.md) — understand how the components fit together
- [Configuration](configuration.md) — full reference for `config.toml`
- [Plugin Development](plugin-development.md) — build your own plugins
- [Agents](agents.md) — deep dive into agent configuration and SOUL.md
- [API Reference](api-reference.md) — CLI commands, events, and storage schema
