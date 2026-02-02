/**
 * Help view: keybinding reference.
 * @module
 */

import { bold, cyan, dim } from "../components/colors.ts";

const SECTIONS: Array<{ title: string; bindings: Array<[string, string]> }> = [
  {
    title: "Navigation",
    bindings: [
      ["1", "Dashboard view"],
      ["2", "Agents view"],
      ["3", "Tasks view"],
      ["4", "Activity log"],
      ["?", "This help screen"],
      ["Tab", "Next view"],
      ["q", "Quit TUI"],
    ],
  },
  {
    title: "Agents View",
    bindings: [
      ["↑/↓", "Navigate agent list"],
      ["Enter", "Start/stop selected agent"],
      ["r", "Refresh agent data"],
    ],
  },
  {
    title: "Tasks View",
    bindings: [
      ["↑/↓", "Navigate task list"],
      ["n", "Create new task"],
      ["a", "Assign task to agent"],
      ["Enter", "View task details"],
    ],
  },
  {
    title: "Activity Log",
    bindings: [
      ["↑/↓", "Scroll through activity"],
    ],
  },
];

export function renderHelp(): string {
  const lines: string[] = [];

  lines.push("");
  lines.push(bold(cyan("  Keyboard Shortcuts")));
  lines.push("");

  for (const section of SECTIONS) {
    lines.push(bold(`  ${section.title}`));
    for (const [key, desc] of section.bindings) {
      lines.push(`    ${cyan(padRight(key, 8))} ${dim(desc)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}
