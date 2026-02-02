# Smoke Test — v0.1.0

Manual verification checklist for a release. Run through each step on a clean machine (or
container).

## Prerequisites

- Linux or macOS
- Internet connection
- `ANTHROPIC_API_KEY` environment variable set
- A Telegram bot token (`TELEGRAM_BOT_TOKEN`)

## Steps

### 1. Install

```bash
curl -fsSL https://squadrn.dev/install.sh | sh
squadrn --version
# Expected: 0.1.0
```

### 2. Initialize

```bash
squadrn init
# Follow the wizard: pick a workspace name, default storage (sqlite)
# Expected: ~/.squadrn/config.toml created, confirmation message
```

### 3. Add plugins

```bash
squadrn plugin add https://github.com/squadrn/channel-telegram
squadrn plugin add https://github.com/squadrn/llm-claude
squadrn plugin list
# Expected: both plugins listed as installed
```

### 4. Create an agent

```bash
squadrn agent create scout
# Follow prompts: set role, pick LLM (claude), pick channel (telegram)
# Expected: agent config added to config.toml, SOUL.md created
```

### 5. Start the gateway

```bash
export ANTHROPIC_API_KEY="sk-..."
export TELEGRAM_BOT_TOKEN="123456:ABC..."
squadrn start
squadrn status
# Expected: gateway running, scout agent idle, plugins loaded
```

### 6. Send a message

Send a message to the Telegram bot. Verify:

- [ ] Bot shows "typing" indicator
- [ ] Bot responds with a coherent reply
- [ ] `squadrn status` shows agent as active during processing

### 7. Task flow

```bash
squadrn task create
# Enter title, description, priority
squadrn task assign <task-id> scout
squadrn task list
# Expected: task shows as "assigned"
```

### 8. Stop

```bash
squadrn stop
squadrn status
# Expected: gateway not running
```

## Result

- [ ] All steps passed
- Date:
- Platform:
- Tester:
