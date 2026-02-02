/**
 * Dashboard view: overview of agents, tasks, and recent activity.
 * @module
 */

import type { UIState } from "../state.ts";
import { bold, cyan, dim, green, red, yellow } from "../components/colors.ts";

export function renderDashboard(state: UIState): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(bold(cyan("  Dashboard")));
  lines.push("");

  // Agent summary
  const agents = [...state.agents.values()];
  const active = agents.filter((a) => a.status === "active").length;
  const idle = agents.filter((a) => a.status === "idle").length;
  const blocked = agents.filter((a) => a.status === "blocked").length;
  const offline = agents.filter((a) => a.status === "offline").length;

  lines.push(bold("  Agents"));
  lines.push(
    `    ${green(`${active} active`)}  ${dim(`${idle} idle`)}  ${yellow(`${blocked} blocked`)}  ${
      red(`${offline} offline`)
    }`,
  );
  lines.push("");

  // Task summary
  const tasks = [...state.tasks.values()];
  const tasksByStatus: Record<string, number> = {};
  for (const t of tasks) {
    tasksByStatus[t.status] = (tasksByStatus[t.status] ?? 0) + 1;
  }

  lines.push(bold("  Tasks"));
  const statusOrder = ["inbox", "assigned", "in_progress", "review", "done", "blocked"];
  const statusParts = statusOrder
    .filter((s) => (tasksByStatus[s] ?? 0) > 0)
    .map((s) => {
      const count = tasksByStatus[s] ?? 0;
      const color = s === "done"
        ? green
        : s === "blocked"
        ? red
        : s === "in_progress"
        ? yellow
        : dim;
      return color(`${count} ${s}`);
    });
  lines.push(`    ${statusParts.length > 0 ? statusParts.join("  ") : dim("no tasks")}`);
  lines.push("");

  // Recent activity
  lines.push(bold("  Recent Activity"));
  const recent = state.activities.slice(0, 8);
  if (recent.length === 0) {
    lines.push(`    ${dim("no activity yet")}`);
  } else {
    for (const a of recent) {
      const time = formatTime(a.createdAt);
      lines.push(`    ${dim(time)}  ${a.type}  ${dim(a.actorId)}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

function formatTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
