/**
 * Agents view: list all agents with status, role, and current task.
 * @module
 */

import type { UIState } from "../state.ts";
import { bold, cyan, dim, green, red, yellow } from "../components/colors.ts";
import { renderTable } from "../components/table.ts";

export function renderAgents(state: UIState, selectedIndex: number): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(bold(cyan("  Agents")));
  lines.push("");

  const agents = [...state.agents.values()];
  if (agents.length === 0) {
    lines.push(`  ${dim("No agents configured")}`);
    return lines.join("\n");
  }

  const header = ["", "Name", "Role", "Status", "LLM", "Current Task"];
  const rows = agents.map((agent, i) => {
    const pointer = i === selectedIndex ? cyan("›") : " ";
    const statusColor = agent.status === "active"
      ? green
      : agent.status === "blocked"
      ? red
      : agent.status === "idle"
      ? yellow
      : dim;
    const taskName = agent.currentTaskId
      ? (state.tasks.get(agent.currentTaskId)?.title ?? agent.currentTaskId)
      : dim("—");

    return [pointer, agent.name, agent.role, statusColor(agent.status), agent.llm, taskName];
  });

  lines.push(renderTable({ header, rows }));
  lines.push("");
  lines.push(dim("  ↑/↓ Navigate  Enter: Start/Stop  r: Refresh"));
  lines.push("");

  return lines.join("\n");
}
