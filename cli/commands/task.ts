import { Checkbox, Input, Select } from "@cliffy/prompt";
import { bold, cyan, dim, gray, green, magenta, red, yellow } from "@std/fmt/colors";
import {
  ActivityManager,
  EventBus,
  InvalidTransitionError,
  loadConfig,
  NotificationManager,
  SessionManager,
  SqliteStorage,
  TaskManager,
} from "@squadrn/core";
import type { CreateTaskData, TaskFilter } from "@squadrn/core";
import type { AgentConfig } from "@squadrn/types";
import type { AgentId, Task, TaskId } from "@squadrn/types";
import { CONFIG_PATH } from "../utils/paths.ts";
import * as out from "../utils/output.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

function pad(str: string, width: number): string {
  return str.length >= width ? str.slice(0, width) : str + " ".repeat(width - str.length);
}

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max - 1) + "…";
}

function age(date: Date | string): string {
  const ms = Date.now() - (date instanceof Date ? date.getTime() : new Date(date).getTime());
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function priorityColor(p: Task["priority"]): (s: string) => string {
  switch (p) {
    case "urgent":
      return red;
    case "high":
      return yellow;
    case "medium":
      return cyan;
    case "low":
      return dim;
  }
}

function statusColor(s: Task["status"]): (str: string) => string {
  switch (s) {
    case "done":
      return green;
    case "in_progress":
      return cyan;
    case "review":
      return magenta;
    case "blocked":
      return red;
    case "assigned":
      return yellow;
    case "inbox":
      return gray;
  }
}

interface CoreServices {
  tasks: TaskManager;
  activities: ActivityManager;
  notifications: NotificationManager;
  storage: SqliteStorage;
  agents: Record<string, AgentConfig>;
}

async function initServices(): Promise<CoreServices | null> {
  const result = await loadConfig(CONFIG_PATH);
  if (!result.ok) {
    out.error("Cannot read config. Run 'squadrn init' first.");
    return null;
  }
  const config = result.value;
  const storage = new SqliteStorage(config.storage.path);
  const events = new EventBus();
  const sessions = new SessionManager(storage, events);
  const tasks = new TaskManager(storage, events);
  const activities = new ActivityManager(storage, events);
  const notifications = new NotificationManager(storage, events, sessions);
  return { tasks, activities, notifications, storage, agents: config.agents };
}

function closeServices(svc: CoreServices): void {
  svc.storage.close();
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

// ── Help ────────────────────────────────────────────────────────────────────

const TASK_HELP = `
Usage: squadrn task <subcommand> [options]

Subcommands:
  create                     Create a new task (interactive wizard)
  list                       List tasks (--status, --assignee, --priority, --tag)
  show <id>                  Show task details
  assign <id> <agent...>     Assign task to agent(s)
  status <id> <new-status>   Change task status
  comment <id>               Add a comment to a task
  board                      Kanban board view
`;

// ── Main router ─────────────────────────────────────────────────────────────

export async function taskCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "create":
      await taskCreate();
      break;
    case "list":
      await taskList(args.slice(1));
      break;
    case "show":
      await taskShow(args[1]);
      break;
    case "assign":
      await taskAssign(args[1], args.slice(2));
      break;
    case "status":
      await taskStatus(args[1], args[2]);
      break;
    case "comment":
      await taskComment(args[1]);
      break;
    case "board":
      await taskBoard();
      break;
    default:
      if (subcommand) out.error(`Unknown task subcommand: ${subcommand}`);
      console.log(TASK_HELP);
  }
}

// ── create ──────────────────────────────────────────────────────────────────

async function taskCreate(): Promise<void> {
  const svc = await initServices();
  if (!svc) return;

  try {
    out.header("Create Task");

    const title = await Input.prompt({
      message: "Title",
      validate: (v) => (v.trim() ? true : "Title is required"),
    });

    // Description: prompt for single line, or open $EDITOR for long text
    const descMode = await Select.prompt({
      message: "Description",
      options: [
        { name: "Write inline", value: "inline" },
        { name: "Open $EDITOR", value: "editor" },
        { name: "Skip", value: "skip" },
      ],
    });

    let description = "";
    if (descMode === "inline") {
      description = await Input.prompt({ message: "Description text" });
    } else if (descMode === "editor") {
      description = await openEditor("");
    }

    const priority = await Select.prompt({
      message: "Priority",
      options: ["low", "medium", "high", "urgent"],
      default: "medium",
    }) as Task["priority"];

    // Assignees
    const agentNames = Object.keys(svc.agents);
    let assigneeIds: AgentId[] = [];
    if (agentNames.length > 0) {
      const selected = await Checkbox.prompt({
        message: "Assign to (space to toggle, enter to confirm)",
        options: agentNames,
      });
      assigneeIds = selected as AgentId[];
    } else {
      out.info("No agents configured. Task will go to inbox.");
    }

    // Tags
    const tagsRaw = await Input.prompt({
      message: "Tags (comma-separated, or empty)",
      default: "",
    });
    const tags = tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    // Due date
    const dueDateRaw = await Input.prompt({
      message: "Due date (YYYY-MM-DD, or empty)",
      default: "",
      validate: (v) => {
        if (!v) return true;
        const d = new Date(v);
        return isNaN(d.getTime()) ? "Invalid date format (use YYYY-MM-DD)" : true;
      },
    });
    const dueDate = dueDateRaw ? new Date(dueDateRaw) : undefined;

    const data: CreateTaskData = {
      title,
      description,
      priority,
      assigneeIds,
      tags,
      dueDate,
    };

    const task = await svc.tasks.createTask(data);

    // Create assignment notifications
    for (const agentId of assigneeIds) {
      await svc.notifications.create({
        recipientId: agentId,
        type: "assignment",
        content: `You have been assigned to task: ${title}`,
        sourceType: "task",
        sourceId: task.id,
      });
    }

    console.log();
    out.success(`Task created: ${bold(shortId(task.id))}`);
    out.info(`Status: ${task.status} | Priority: ${task.priority}`);
    if (assigneeIds.length > 0) {
      out.info(`Assigned to: ${assigneeIds.join(", ")}`);
    }
  } finally {
    closeServices(svc);
  }
}

// ── list ────────────────────────────────────────────────────────────────────

async function taskList(args: string[]): Promise<void> {
  const svc = await initServices();
  if (!svc) return;

  try {
    // Parse flags from args
    const filter: TaskFilter = {};
    let showDone = false;

    for (const arg of args) {
      if (arg.startsWith("--status=")) {
        const val = arg.split("=")[1]!;
        if (val === "done") showDone = true;
        filter.status = val as Task["status"];
      } else if (arg.startsWith("--assignee=")) {
        filter.assigneeId = arg.split("=")[1]! as AgentId;
      } else if (arg.startsWith("--priority=")) {
        filter.priority = arg.split("=")[1]! as Task["priority"];
      } else if (arg.startsWith("--tag=")) {
        filter.tag = arg.split("=")[1]!;
      } else if (arg === "--all") {
        showDone = true;
      }
    }

    let tasks = await svc.tasks.listTasks(Object.keys(filter).length > 0 ? filter : undefined);

    // Default: hide done tasks unless --status=done or --all
    if (!showDone && !filter.status) {
      tasks = tasks.filter((t) => t.status !== "done");
    }

    if (tasks.length === 0) {
      out.info("No tasks found");
      out.info(`Create one with: ${cyan("squadrn task create")}`);
      return;
    }

    // Sort: urgent first, then by creation date
    const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    tasks.sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 2;
      const pb = priorityOrder[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      const ta = a.createdAt instanceof Date
        ? a.createdAt.getTime()
        : new Date(a.createdAt).getTime();
      const tb = b.createdAt instanceof Date
        ? b.createdAt.getTime()
        : new Date(b.createdAt).getTime();
      return tb - ta;
    });

    out.header("Tasks");

    const idW = 10;
    const titleW = 32;
    const statusW = 14;
    const assignW = 18;
    const prioW = 8;
    const ageW = 6;

    console.log(
      `  ${bold(pad("ID", idW))} ${bold(pad("TITLE", titleW))} ${bold(pad("STATUS", statusW))} ${
        bold(pad("ASSIGNEES", assignW))
      } ${bold(pad("PRIO", prioW))} ${bold(pad("AGE", ageW))}`,
    );
    console.log(`  ${dim("-".repeat(idW + titleW + statusW + assignW + prioW + ageW + 5))}`);

    for (const task of tasks) {
      const sc = statusColor(task.status);
      const pc = priorityColor(task.priority);
      const assignees = task.assigneeIds.length > 0 ? task.assigneeIds.join(", ") : dim("none");
      console.log(
        `  ${dim(pad(shortId(task.id), idW))} ${pad(truncate(task.title, titleW), titleW)} ${
          sc(pad(task.status, statusW))
        } ${pad(truncate(String(assignees), assignW), assignW)} ${pc(pad(task.priority, prioW))} ${
          dim(pad(age(task.createdAt), ageW))
        }`,
      );
    }

    console.log();
    out.info(`${tasks.length} task${tasks.length === 1 ? "" : "s"}`);
  } finally {
    closeServices(svc);
  }
}

// ── show ────────────────────────────────────────────────────────────────────

async function taskShow(idPrefix: string | undefined): Promise<void> {
  if (!idPrefix) {
    out.error("Usage: squadrn task show <id>");
    return;
  }

  const svc = await initServices();
  if (!svc) return;

  try {
    const task = await findTask(svc.tasks, idPrefix);
    if (!task) return;

    out.header(`Task: ${task.title}`);

    console.log(`  ${bold("ID:")}          ${task.id}`);
    console.log(`  ${bold("Status:")}      ${statusColor(task.status)(task.status)}`);
    console.log(`  ${bold("Priority:")}    ${priorityColor(task.priority)(task.priority)}`);
    console.log(
      `  ${bold("Assignees:")}   ${
        task.assigneeIds.length > 0 ? task.assigneeIds.join(", ") : dim("none")
      }`,
    );
    console.log(
      `  ${bold("Tags:")}        ${task.tags.length > 0 ? task.tags.join(", ") : dim("none")}`,
    );
    if (task.dueDate) {
      const due = task.dueDate instanceof Date ? task.dueDate : new Date(task.dueDate);
      console.log(`  ${bold("Due:")}         ${due.toISOString().slice(0, 10)}`);
    }
    if (task.parentTaskId) {
      console.log(`  ${bold("Parent:")}      ${shortId(task.parentTaskId)}`);
    }
    if (task.dependsOn.length > 0) {
      console.log(`  ${bold("Depends on:")}  ${task.dependsOn.map(shortId).join(", ")}`);
    }
    const created = task.createdAt instanceof Date ? task.createdAt : new Date(task.createdAt);
    const updated = task.updatedAt instanceof Date ? task.updatedAt : new Date(task.updatedAt);
    console.log(
      `  ${bold("Created:")}     ${created.toISOString().slice(0, 16).replace("T", " ")}`,
    );
    console.log(
      `  ${bold("Updated:")}     ${updated.toISOString().slice(0, 16).replace("T", " ")}`,
    );
    if (task.completedAt) {
      const completed = task.completedAt instanceof Date
        ? task.completedAt
        : new Date(task.completedAt);
      console.log(
        `  ${bold("Completed:")}   ${completed.toISOString().slice(0, 16).replace("T", " ")}`,
      );
    }

    if (task.description) {
      console.log();
      console.log(`  ${bold("Description:")}`);
      for (const line of task.description.split("\n")) {
        console.log(`  ${line}`);
      }
    }

    // Comments
    if (task.comments.length > 0) {
      console.log();
      console.log(`  ${bold("Comments:")} (${task.comments.length})`);
      console.log(`  ${dim("-".repeat(60))}`);
      for (const comment of task.comments) {
        const cDate = comment.createdAt instanceof Date
          ? comment.createdAt
          : new Date(comment.createdAt);
        console.log(`  ${cyan(comment.authorName)} ${dim(age(cDate) + " ago")}`);
        for (const line of comment.content.split("\n")) {
          console.log(`    ${line}`);
        }
        console.log();
      }
    }

    // Activity history
    const activities = await svc.activities.getForTask(task.id);
    if (activities.length > 0) {
      console.log(`  ${bold("Activity:")} (${activities.length})`);
      console.log(`  ${dim("-".repeat(60))}`);
      for (const act of activities.slice(0, 20)) {
        const aDate = act.createdAt instanceof Date ? act.createdAt : new Date(act.createdAt);
        console.log(`  ${dim(age(aDate) + " ago")}  ${ActivityManager.formatActivity(act)}`);
      }
      if (activities.length > 20) {
        console.log(`  ${dim(`... and ${activities.length - 20} more`)}`);
      }
    }
  } finally {
    closeServices(svc);
  }
}

// ── assign ──────────────────────────────────────────────────────────────────

async function taskAssign(idPrefix: string | undefined, agentNames: string[]): Promise<void> {
  if (!idPrefix || agentNames.length === 0) {
    out.error("Usage: squadrn task assign <id> <agent> [agent2...]");
    return;
  }

  const svc = await initServices();
  if (!svc) return;

  try {
    const task = await findTask(svc.tasks, idPrefix);
    if (!task) return;

    // Validate agent names
    for (const name of agentNames) {
      if (!svc.agents[name]) {
        out.error(`Agent "${name}" not found`);
        out.info("Available agents: " + Object.keys(svc.agents).join(", "));
        return;
      }
    }

    const agentIds = agentNames as AgentId[];
    await svc.tasks.assignTask(task.id, agentIds);

    // Notify assignees
    for (const agentId of agentIds) {
      await svc.notifications.create({
        recipientId: agentId,
        type: "assignment",
        content: `You have been assigned to task: ${task.title}`,
        sourceType: "task",
        sourceId: task.id,
      });
    }

    out.success(`Task ${shortId(task.id)} assigned to ${agentNames.join(", ")}`);
  } finally {
    closeServices(svc);
  }
}

// ── status ──────────────────────────────────────────────────────────────────

const ALL_STATUSES: Task["status"][] = [
  "inbox",
  "assigned",
  "in_progress",
  "review",
  "done",
  "blocked",
];

async function taskStatus(
  idPrefix: string | undefined,
  newStatus: string | undefined,
): Promise<void> {
  if (!idPrefix || !newStatus) {
    out.error("Usage: squadrn task status <id> <new-status>");
    out.info(`Valid statuses: ${ALL_STATUSES.join(", ")}`);
    return;
  }

  if (!ALL_STATUSES.includes(newStatus as Task["status"])) {
    out.error(`Invalid status: ${newStatus}`);
    out.info(`Valid statuses: ${ALL_STATUSES.join(", ")}`);
    return;
  }

  const svc = await initServices();
  if (!svc) return;

  try {
    const task = await findTask(svc.tasks, idPrefix);
    if (!task) return;

    try {
      const updated = await svc.tasks.transitionTask(task.id, newStatus as Task["status"]);
      out.success(
        `Task ${shortId(task.id)}: ${task.status} → ${statusColor(updated.status)(updated.status)}`,
      );
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        out.displayError(err);
      } else {
        throw err;
      }
    }
  } finally {
    closeServices(svc);
  }
}

// ── comment ─────────────────────────────────────────────────────────────────

async function taskComment(idPrefix: string | undefined): Promise<void> {
  if (!idPrefix) {
    out.error("Usage: squadrn task comment <id>");
    return;
  }

  const svc = await initServices();
  if (!svc) return;

  try {
    const task = await findTask(svc.tasks, idPrefix);
    if (!task) return;

    const content = await openEditor(
      `# Comment on: ${task.title}\n# Lines starting with # are ignored\n\n`,
    );
    if (!content.trim()) {
      out.info("Empty comment, aborting.");
      return;
    }

    const authorName = Deno.env.get("USER") ?? "user";
    const comment = await svc.tasks.addComment(task.id, {
      authorId: authorName,
      authorName,
      content,
    });

    // Parse @mentions and create notifications
    const mentions = content.matchAll(/@(\w+)/g);
    const mentionedNames = [...new Set([...mentions].map((m) => m[1]!))];
    for (const name of mentionedNames) {
      if (svc.agents[name]) {
        await svc.notifications.create({
          recipientId: name,
          type: "mention",
          content: `${authorName} mentioned you in task ${shortId(task.id)}: ${
            content.slice(0, 100)
          }`,
          sourceType: "task",
          sourceId: task.id,
        });
      }
    }

    out.success(`Comment added to task ${shortId(task.id)} (${shortId(comment.id)})`);
    if (mentionedNames.length > 0) {
      out.info(`Notified: ${mentionedNames.join(", ")}`);
    }
  } finally {
    closeServices(svc);
  }
}

// ── board ───────────────────────────────────────────────────────────────────

const BOARD_COLUMNS: Task["status"][] = ["inbox", "assigned", "in_progress", "review", "done"];

async function taskBoard(): Promise<void> {
  const svc = await initServices();
  if (!svc) return;

  try {
    const tasks = await svc.tasks.listTasks();

    // Group by status
    const columns: Record<string, Task[]> = {};
    for (const col of BOARD_COLUMNS) {
      columns[col] = [];
    }
    for (const task of tasks) {
      const col = columns[task.status];
      if (col) col.push(task);
    }

    // Also add blocked tasks to a separate indicator
    const blocked = tasks.filter((t) => t.status === "blocked");

    const colWidth = 22;

    out.header("Task Board");

    // Header row
    const headerLabels = BOARD_COLUMNS.map((col) => {
      const count = columns[col]!.length;
      const label = `${col.replace("_", " ").toUpperCase()} (${count})`;
      return pad(label, colWidth);
    });
    console.log(
      `  ${bold("┌" + BOARD_COLUMNS.map(() => "─".repeat(colWidth + 2)).join("┬") + "┐")}`,
    );
    console.log(
      `  ${bold("│")} ${headerLabels.map((h) => bold(h)).join(` ${bold("│")} `)} ${bold("│")}`,
    );
    console.log(
      `  ${bold("├" + BOARD_COLUMNS.map(() => "─".repeat(colWidth + 2)).join("┼") + "┤")}`,
    );

    // Find max rows
    const maxRows = Math.max(1, ...BOARD_COLUMNS.map((c) => columns[c]!.length));

    for (let row = 0; row < maxRows; row++) {
      const cells = BOARD_COLUMNS.map((col) => {
        const task = columns[col]![row];
        if (!task) return pad("", colWidth);
        const pc = priorityColor(task.priority);
        const idStr = dim(shortId(task.id).slice(0, 6));
        const titleStr = truncate(task.title, colWidth - 8);
        return `${idStr} ${pc(titleStr)}${" ".repeat(Math.max(0, colWidth - 7 - titleStr.length))}`;
      });
      console.log(`  ${bold("│")} ${cells.join(` ${bold("│")} `)} ${bold("│")}`);
    }

    console.log(
      `  ${bold("└" + BOARD_COLUMNS.map(() => "─".repeat(colWidth + 2)).join("┴") + "┘")}`,
    );

    if (blocked.length > 0) {
      console.log();
      out.warn(`${blocked.length} blocked task${blocked.length === 1 ? "" : "s"}:`);
      for (const t of blocked) {
        console.log(`  ${red("■")} ${dim(shortId(t.id))} ${t.title}`);
      }
    }

    console.log();
    out.info(`${tasks.length} total task${tasks.length === 1 ? "" : "s"}`);
  } finally {
    closeServices(svc);
  }
}

// ── Shared helpers ──────────────────────────────────────────────────────────

async function findTask(taskManager: TaskManager, idPrefix: string): Promise<Task | null> {
  // Try exact match first
  try {
    const task = await taskManager.getTask(idPrefix as TaskId);
    if (task) return task;
  } catch {
    // not found, try prefix search
  }

  // Prefix match
  const all = await taskManager.listTasks();
  const matches = all.filter((t) => t.id.startsWith(idPrefix));

  if (matches.length === 0) {
    out.error(`No task found matching: ${idPrefix}`);
    return null;
  }
  if (matches.length > 1) {
    out.error(`Ambiguous ID prefix "${idPrefix}" matches ${matches.length} tasks:`);
    for (const t of matches.slice(0, 5)) {
      console.log(`  ${dim(shortId(t.id))} ${t.title}`);
    }
    return null;
  }
  return matches[0]!;
}

async function openEditor(initialContent: string): Promise<string> {
  const tmpFile = await Deno.makeTempFile({ suffix: ".md" });
  try {
    await Deno.writeTextFile(tmpFile, initialContent);

    const editor = Deno.env.get("EDITOR") ?? Deno.env.get("VISUAL") ?? "vi";
    const cmd = new Deno.Command(editor, {
      args: [tmpFile],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    const proc = cmd.spawn();
    const status = await proc.status;

    if (!status.success) {
      out.error(`Editor exited with code ${status.code}`);
      return "";
    }

    const text = await Deno.readTextFile(tmpFile);
    // Strip comment lines
    return text
      .split("\n")
      .filter((line) => !line.startsWith("#"))
      .join("\n")
      .trim();
  } finally {
    try {
      await Deno.remove(tmpFile);
    } catch { /* ignore */ }
  }
}
