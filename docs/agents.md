# Agents

Agents are the core units of work in Squadrn. Each agent has a defined role, personality, LLM
backend, and set of channels it operates on.

## Agent Configuration

Define agents in `~/.squadrn/config.toml`:

```toml
[agents.scout]
name = "Scout"
role = "Squad Lead"
llm = "claude"
channels = ["telegram"]
heartbeat = "*/15 * * * *"
soul_file = "~/.squadrn/agents/scout/SOUL.md"
```

| Field       | Description                                                          |
| ----------- | -------------------------------------------------------------------- |
| `name`      | Display name shown in messages and logs                              |
| `role`      | Role description (used in system prompts and task routing)           |
| `llm`       | Name of the installed LLM plugin (e.g., `"claude"`, `"openai"`)      |
| `channels`  | List of channel plugins this agent listens on. Empty = internal-only |
| `heartbeat` | Cron expression for periodic check-ins                               |
| `soul_file` | Path to the SOUL.md personality file                                 |

## CLI Commands

```bash
squadrn agent create <name>    # Create a new agent (interactive)
squadrn agent list              # List all agents with status
squadrn agent start <name>      # Start a specific agent
squadrn agent stop <name>       # Stop a specific agent
squadrn agent logs <name>       # Stream agent logs in real time
```

## The SOUL.md File

SOUL.md defines an agent's personality, behavior, and constraints. It's included in the system
prompt for every LLM interaction.

### Format

```markdown
# <Name> — <Role>

## Identity

Who the agent is. Personality traits, background context.

## Responsibilities

What the agent is responsible for. Bullet list of duties.

## Communication Style

How the agent communicates. Tone, verbosity, formatting preferences.

## Constraints

What the agent should NOT do. Boundaries and limitations.

## Tools

How the agent should use available tools. Preferences and strategies.
```

### Example: Squad Lead

```markdown
# Scout — Squad Lead

## Identity

You are Scout, the lead coordinator for a team of AI agents. You have full visibility into all tasks
and agent activities.

## Responsibilities

- Triage incoming tasks and assign them to the right agent
- Answer direct questions from users
- Monitor task progress and follow up on blocked items
- Summarize daily activity when asked

## Communication Style

- Professional but approachable
- Concise responses unless detail is requested
- Use bullet points for lists
- Always acknowledge tasks before starting work

## Constraints

- Never make up information — say "I don't know" when uncertain
- Don't modify tasks assigned to other agents without coordination
- Escalate to the user for decisions outside your authority
```

### Example: Content Writer

```markdown
# Loki — Content Writer

## Identity

You are Loki, a skilled content writer who produces clear, engaging text.

## Responsibilities

- Write blog posts, documentation, and social media content
- Edit and proofread text from other agents
- Research topics when needed

## Communication Style

- Creative but precise
- Adapt tone to the target audience
- Provide drafts with clear section headers

## Constraints

- Always cite sources for factual claims
- Don't publish without explicit approval
- Keep content appropriate for professional audiences
```

## Agent Status

Agents have four possible statuses:

| Status    | Description                                        |
| --------- | -------------------------------------------------- |
| `idle`    | Agent is running but has no active work            |
| `active`  | Agent is processing a message or task              |
| `blocked` | Agent is waiting on a dependency or external input |
| `offline` | Agent is not running                               |

## Heartbeats

Each agent has a configurable heartbeat — a periodic cron job that triggers the agent to check for
work.

On each heartbeat, an agent:

1. Checks for new @mentions
2. Reviews assigned tasks
3. Scans the activity feed for relevant updates
4. If nothing to do, reports `HEARTBEAT_OK` and sleeps

Default interval: every 15 minutes (`*/15 * * * *`).

Set a shorter interval for more responsive agents:

```toml
heartbeat = "*/5 * * * *"    # Every 5 minutes
```

## Sessions

Each agent maintains a session with:

- **Conversation history** — messages exchanged with users and other agents
- **Working memory** — key-value store for temporary state during task execution
- **Current task** — the task the agent is actively working on

```typescript
interface SessionContext {
  conversationHistory: Message[];
  workingMemory: Record<string, unknown>;
  currentTaskId?: TaskId;
}
```

Sessions are persisted to storage and restored on gateway restart.

## Multi-Agent Collaboration

Agents collaborate through shared infrastructure:

### Task Board

All agents share a task board. Tasks can be:

- Created by any agent or user
- Assigned to one or more agents
- Commented on with @mentions to notify other agents

### @Mentions

Use `@agentname` in task comments to notify another agent:

```
@loki please draft the blog post for this feature
```

The notification system delivers mentions to the target agent on their next heartbeat.

### Activity Feed

All actions are logged to the activity feed. Agents can check the feed during heartbeats to stay
aware of team activity without being directly mentioned.

Activity types:

- `task_created`, `task_assigned`, `task_status_changed`, `task_commented`
- `agent_started`, `agent_stopped`, `agent_heartbeat`
- `message_received`, `message_sent`
- `plugin_loaded`, `plugin_error`

## Task Workflow

Agents interact with tasks through these status transitions:

```
inbox → assigned → in_progress → review → done
  ↕        ↕           ↕           ↕        ↕
blocked  blocked     blocked     blocked  in_progress (reopen)
```

Valid transitions:

| From          | To                                 |
| ------------- | ---------------------------------- |
| `inbox`       | `assigned`, `blocked`              |
| `assigned`    | `in_progress`, `blocked`, `inbox`  |
| `in_progress` | `review`, `blocked`, `assigned`    |
| `review`      | `done`, `in_progress`, `blocked`   |
| `done`        | `in_progress` (reopen)             |
| `blocked`     | `inbox`, `assigned`, `in_progress` |

Tasks support:

- **Priorities**: `low`, `medium`, `high`, `urgent`
- **Dependencies**: a task can depend on other tasks
- **Parent tasks**: subtask hierarchy
- **Tags**: freeform labels for organization
- **Due dates**: optional deadlines
- **Comments**: with @mention support
