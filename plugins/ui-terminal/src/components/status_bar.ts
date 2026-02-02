/**
 * Bottom status bar: keybindings and current view hints.
 * @module
 */

import { bgBlue, bold, dim, stripAnsi, white } from "./colors.ts";

export function renderStatusBar(cols: number): string {
  const shortcuts = [
    "1:Dashboard",
    "2:Agents",
    "3:Tasks",
    "4:Activity",
    "?:Help",
    "q:Quit",
  ];
  const content = " " + shortcuts.map((s) => bold(white(s))).join(dim(" │ ")) + " ";
  const padding = Math.max(0, cols - stripAnsi(content).length);
  return bgBlue(content + " ".repeat(padding));
}
