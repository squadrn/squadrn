/**
 * Tasks view: list all tasks grouped by status.
 * @module
 */

import type { UIState } from "../state.ts";
import { bold, cyan, dim, green, red, yellow } from "../components/colors.ts";
import { renderTable } from "../components/table.ts";

const STATUS_ORDER = ["inbox", "assigned", "in_progress", "review", "done", "blocked"] as const;

export function renderTasks(state: UIState, selectedIndex: number): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(bold(cyan("  Tasks")));
  lines.push("");

  const tasks = [...state.tasks.values()];
  if (tasks.length === 0) {
    lines.push(`  ${dim("No tasks")}`);
    lines.push("");
    lines.push(dim("  n: New task"));
    return lines.join("\n");
  }

  // Sort tasks by status order, then by priority
  const priorityWeight: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  const sorted = tasks.sort((a, b) => {
    const sa = STATUS_ORDER.indexOf(a.status as typeof STATUS_ORDER[number]);
    const sb = STATUS_ORDER.indexOf(b.status as typeof STATUS_ORDER[number]);
    if (sa !== sb) return sa - sb;
    return (priorityWeight[a.priority] ?? 2) - (priorityWeight[b.priority] ?? 2);
  });

  const header = ["", "Title", "Status", "Priority", "Assignees"];
  const rows = sorted.map((task, i) => {
    const pointer = i === selectedIndex ? cyan("›") : " ";
    const statusColor = task.status === "done"
      ? green
      : task.status === "blocked"
      ? red
      : task.status === "in_progress"
      ? yellow
      : dim;
    const priorityColor = task.priority === "urgent"
      ? red
      : task.priority === "high"
      ? yellow
      : dim;
    const assignees = task.assigneeIds.length > 0
      ? task.assigneeIds.map((id) => state.agents.get(id)?.name ?? id).join(", ")
      : dim("—");

    return [pointer, task.title, statusColor(task.status), priorityColor(task.priority), assignees];
  });

  lines.push(renderTable({ header, rows, maxColWidth: 40 }));
  lines.push("");
  lines.push(dim("  ↑/↓ Navigate  n: New task  a: Assign  Enter: Details"));
  lines.push("");

  return lines.join("\n");
}
