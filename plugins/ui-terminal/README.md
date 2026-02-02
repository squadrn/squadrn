# @squadrn/ui-terminal

Interactive terminal UI plugin for Squadrn. Provides a keyboard-driven TUI with real-time updates
from the gateway.

## Views

- **Dashboard** — Agent status summary, task counts by status, recent activity
- **Agents** — Agent list with status, role, current task. Start/stop agents
- **Tasks** — Task list grouped by status. Create and assign tasks
- **Activity** — Scrollable log of gateway events
- **Help** — Keybinding reference

## Keyboard Shortcuts

| Key     | Action                  |
| ------- | ----------------------- |
| `1`-`4` | Switch view             |
| `Tab`   | Next view               |
| `?`     | Help                    |
| `q`     | Quit                    |
| `↑`/`↓` | Navigate lists / scroll |
| `Enter` | Execute action          |
| `n`     | New task (in Tasks)     |

## Installation

```bash
squadrn plugin add https://github.com/squadrn/ui-terminal
```

## Configuration

No configuration required. The plugin uses event subscriptions and storage queries to build its
state.

## How It Works

On load, the plugin queries the gateway storage for current agents, tasks, activities, and
notifications. It then subscribes to all relevant events (`agent:*`, `task:*`, `activity:recorded`,
`notification:*`) to keep its in-memory state in sync. The TUI renders on each state change or
keypress.
