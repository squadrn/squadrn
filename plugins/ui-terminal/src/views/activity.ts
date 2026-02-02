/**
 * Activity view: scrollable log of recent events.
 * @module
 */

import type { UIState } from "../state.ts";
import { bold, cyan, dim, green, magenta, yellow } from "../components/colors.ts";

const TYPE_COLORS: Record<string, (s: string) => string> = {
  task_created: green,
  task_assigned: yellow,
  task_status_changed: yellow,
  task_commented: dim,
  agent_started: green,
  agent_stopped: magenta,
  agent_heartbeat: dim,
  message_received: cyan,
  message_sent: cyan,
  plugin_loaded: green,
  plugin_error: yellow,
};

export function renderActivity(state: UIState, scrollOffset: number, maxLines: number): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(bold(cyan("  Activity Log")));
  lines.push("");

  if (state.activities.length === 0) {
    lines.push(`  ${dim("No activity recorded")}`);
    return lines.join("\n");
  }

  const visible = state.activities.slice(scrollOffset, scrollOffset + maxLines);
  for (const a of visible) {
    const time = formatTime(a.createdAt);
    const colorFn = TYPE_COLORS[a.type] ?? dim;
    const actorLabel = a.actorType === "agent" ? `[${a.actorId}]` : `(${a.actorType})`;
    lines.push(`  ${dim(time)} ${colorFn(padRight(a.type, 22))} ${dim(actorLabel)}`);
  }

  lines.push("");
  const total = state.activities.length;
  const showing = `${scrollOffset + 1}–${Math.min(scrollOffset + maxLines, total)} of ${total}`;
  lines.push(dim(`  ${showing}  ↑/↓ Scroll`));
  lines.push("");

  return lines.join("\n");
}

function formatTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}
