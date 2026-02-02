/**
 * @squadrn/ui-terminal — Interactive terminal UI plugin for Squadrn.
 *
 * Provides a keyboard-driven TUI with views for dashboard, agents, tasks,
 * activity log, and help. Subscribes to gateway events for real-time updates.
 *
 * @module
 */

import type { Plugin, PluginAPI, PluginManifest } from "@squadrn/types";
import rawManifest from "./manifest.json" with { type: "json" };
import { TUIApp } from "./src/app.ts";

const manifest = rawManifest as unknown as PluginManifest;

let app: TUIApp | null = null;

const plugin: Plugin = {
  manifest,

  async register(core: PluginAPI): Promise<void> {
    core.log.info("Terminal UI plugin registering");
    app = new TUIApp(core);
    await app.start();
  },

  async unregister(): Promise<void> {
    if (app) {
      await app.stop();
      app = null;
    }
  },
};

export default plugin;
