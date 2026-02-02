/**
 * Main TUI application: screen manager, key handling, render loop.
 * @module
 */

import type { PluginAPI } from "@squadrn/types";
import type { UIState } from "./state.ts";
import { loadInitialState, subscribeToEvents } from "./state.ts";
import { renderHeader } from "./components/header.ts";
import { renderStatusBar } from "./components/status_bar.ts";
import { renderDashboard } from "./views/dashboard.ts";
import { renderAgents } from "./views/agents.ts";
import { renderTasks } from "./views/tasks.ts";
import { renderActivity } from "./views/activity.ts";
import { renderHelp } from "./views/help.ts";

export type ViewName = "dashboard" | "agents" | "tasks" | "activity" | "help";

const VIEW_NAMES: ViewName[] = ["dashboard", "agents", "tasks", "activity", "help"];

interface AppState {
  currentView: ViewName;
  selectedIndex: number;
  scrollOffset: number;
}

export class TUIApp {
  #core: PluginAPI;
  #state: UIState | null = null;
  #appState: AppState = { currentView: "dashboard", selectedIndex: 0, scrollOffset: 0 };
  #unsubscribe: (() => void) | null = null;
  #running = false;
  #reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(core: PluginAPI) {
    this.#core = core;
  }

  async start(): Promise<void> {
    this.#state = await loadInitialState(this.#core);
    this.#unsubscribe = subscribeToEvents(this.#core, this.#state, () => this.#render());
    this.#running = true;

    // Enable raw mode for keypress detection
    Deno.stdin.setRaw(true);
    this.#reader = Deno.stdin.readable.getReader();

    // Hide cursor, clear screen
    this.#write("\x1b[?25l"); // hide cursor
    this.#render();

    // Key loop
    await this.#keyLoop();
  }

  async stop(): Promise<void> {
    this.#running = false;
    if (this.#unsubscribe) {
      this.#unsubscribe();
      this.#unsubscribe = null;
    }
    if (this.#reader) {
      this.#reader.releaseLock();
      this.#reader = null;
    }
    try {
      Deno.stdin.setRaw(false);
    } catch {
      // May fail if stdin is not a TTY
    }
    // Show cursor, clear screen
    this.#write("\x1b[?25h\x1b[2J\x1b[H");
    await Promise.resolve();
  }

  async #keyLoop(): Promise<void> {
    const reader = this.#reader;
    if (!reader) return;

    while (this.#running) {
      try {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        await this.#handleKey(value);
      } catch {
        break;
      }
    }
  }

  async #handleKey(data: Uint8Array): Promise<void> {
    const key = new TextDecoder().decode(data);

    // View switching
    if (key === "1") this.#switchView("dashboard");
    else if (key === "2") this.#switchView("agents");
    else if (key === "3") this.#switchView("tasks");
    else if (key === "4") this.#switchView("activity");
    else if (key === "?" || key === "h") this.#switchView("help");
    else if (key === "\t") this.#nextView();
    else if (key === "q") {
      await this.stop();
      return;
    } // Navigation within views
    else if (key === "\x1b[A") {
      // Arrow up
      if (this.#appState.currentView === "activity") {
        this.#appState.scrollOffset = Math.max(0, this.#appState.scrollOffset - 1);
      } else {
        this.#appState.selectedIndex = Math.max(0, this.#appState.selectedIndex - 1);
      }
    } else if (key === "\x1b[B") {
      // Arrow down
      if (this.#appState.currentView === "activity") {
        this.#appState.scrollOffset++;
      } else {
        this.#appState.selectedIndex++;
      }
    } // Actions
    else if (key === "\r" && this.#appState.currentView === "agents") {
      await this.#toggleAgent();
    } else if (key === "n" && this.#appState.currentView === "tasks") {
      await this.#createTask();
    }

    this.#render();
  }

  #switchView(view: ViewName): void {
    this.#appState.currentView = view;
    this.#appState.selectedIndex = 0;
    this.#appState.scrollOffset = 0;
  }

  #nextView(): void {
    const idx = VIEW_NAMES.indexOf(this.#appState.currentView);
    this.#appState.currentView = VIEW_NAMES[(idx + 1) % VIEW_NAMES.length]!;
    this.#appState.selectedIndex = 0;
    this.#appState.scrollOffset = 0;
  }

  #render(): void {
    if (!this.#state) return;

    const cols = Deno.consoleSize().columns;
    const rows = Deno.consoleSize().rows;

    const parts: string[] = [];

    // Header
    parts.push(renderHeader(this.#state, this.#appState.currentView, cols));
    parts.push("─".repeat(cols));

    // View content
    const contentRows = rows - 4; // header + separator + status bar + separator
    switch (this.#appState.currentView) {
      case "dashboard":
        parts.push(renderDashboard(this.#state));
        break;
      case "agents":
        parts.push(renderAgents(this.#state, this.#appState.selectedIndex));
        break;
      case "tasks":
        parts.push(renderTasks(this.#state, this.#appState.selectedIndex));
        break;
      case "activity":
        parts.push(renderActivity(this.#state, this.#appState.scrollOffset, contentRows));
        break;
      case "help":
        parts.push(renderHelp());
        break;
    }

    // Status bar
    parts.push("─".repeat(cols));
    parts.push(renderStatusBar(cols));

    // Clear screen and write
    this.#write("\x1b[2J\x1b[H" + parts.join("\n"));
  }

  #write(s: string): void {
    const encoder = new TextEncoder();
    Deno.stdout.writeSync(encoder.encode(s));
  }

  async #toggleAgent(): Promise<void> {
    if (!this.#state) return;
    const agents = [...this.#state.agents.values()];
    const agent = agents[this.#appState.selectedIndex];
    if (!agent) return;

    if (agent.status === "active") {
      this.#core.events.emit("agent:stopped", agent);
    } else {
      this.#core.events.emit("agent:started", agent);
    }
    await Promise.resolve();
  }

  async #createTask(): Promise<void> {
    // Temporarily restore terminal for input
    this.#write("\x1b[?25h"); // show cursor
    try {
      Deno.stdin.setRaw(false);
    } catch {
      // ignore
    }

    this.#write("\n  Task title: ");
    const buf = new Uint8Array(256);
    const n = await Deno.stdin.read(buf);
    const title = n ? new TextDecoder().decode(buf.subarray(0, n)).trim() : "";

    if (title.length > 0) {
      this.#core.events.emit("task:created", {
        id: crypto.randomUUID(),
        title,
        description: "",
        status: "inbox",
        priority: "medium",
        assigneeIds: [],
        dependsOn: [],
        comments: [],
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Re-enter raw mode
    try {
      Deno.stdin.setRaw(true);
    } catch {
      // ignore
    }
    this.#write("\x1b[?25l"); // hide cursor
  }
}
