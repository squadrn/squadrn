import { join } from "jsr:@std/path@^1";

const HOME = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";

export const SQUADRN_DIR = join(HOME, ".squadrn");
export const CONFIG_PATH = join(SQUADRN_DIR, "config.toml");
export const DATA_DIR = join(SQUADRN_DIR, "data");
export const AGENTS_DIR = join(SQUADRN_DIR, "agents");
export const PLUGINS_PATH = join(SQUADRN_DIR, "plugins.json");
export const PID_PATH = join(SQUADRN_DIR, "gateway.pid");
