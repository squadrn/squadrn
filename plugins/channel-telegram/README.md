# @squadrn/channel-telegram

Official Telegram channel plugin for [Squadrn](https://github.com/squadrn/squadrn). Bridges the
Telegram Bot API with the Squadrn gateway using long polling.

## Setup

### 1. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts to choose a name and username
3. Copy the **HTTP API token** BotFather gives you

### 2. Set the Token

```bash
export TELEGRAM_BOT_TOKEN="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
```

Or add it to your `~/.squadrn/config.toml`:

```toml
[plugins.channel-telegram]
# The token is read from the TELEGRAM_BOT_TOKEN env var.
# No additional config is required.
```

### 3. Install the Plugin

```bash
squadrn plugin add https://github.com/squadrn/channel-telegram
```

### 4. Pair a Chat with an Agent

1. Open your bot in Telegram and send `/start`
2. The bot replies with a 6-character **pairing code**
3. In your terminal, run:

```bash
squadrn agent pair <CODE>
```

This links the Telegram chat to the agent so it can receive and respond to messages.

## Features

- **Long polling** — no webhooks or public URLs required
- **Retry with backoff** — recovers from transient network errors
- **Photo attachments** — photos are forwarded as image attachments with a download URL
- **Reply threading** — preserves reply-to relationships
- **Typing indicator** — agents can show "typing…" while processing

## Permissions

| Permission | Scope                | Reason                 |
| ---------- | -------------------- | ---------------------- |
| `net`      | `api.telegram.org`   | Telegram Bot API calls |
| `env`      | `TELEGRAM_BOT_TOKEN` | Bot authentication     |

## Development

```bash
# Type-check
deno check mod.ts

# Format
deno fmt

# Lint
deno lint
```
