/**
 * Top header bar: plugin name, gateway status, notification count.
 * @module
 */

import type { UIState } from "../state.ts";
import { bold, cyan, dim, green, red, stripAnsi } from "./colors.ts";

export function renderHeader(state: UIState, currentView: string, cols: number): string {
  const title = bold(cyan(" ◆ SQUADRN "));
  const status = state.gatewayRunning ? green("● running") : red("● stopped");
  const unread = state.notifications.filter((n) => !n.read).length;
  const notifBadge = unread > 0 ? ` 🔔 ${unread}` : "";
  const viewLabel = dim(`[${currentView}]`);

  const left = `${title} ${status}${notifBadge}`;
  const right = viewLabel;
  const padding = Math.max(0, cols - stripAnsi(left).length - stripAnsi(right).length);
  return left + " ".repeat(padding) + right;
}
