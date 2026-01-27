import { ensureDir } from "@std/fs";
import { defaultConfig, serializeConfig } from "@squadrn/core";
import { AGENTS_DIR, CONFIG_PATH, DATA_DIR, PLUGINS_PATH, SQUADRN_DIR } from "../utils/paths.ts";
import * as out from "../utils/output.ts";

export async function initCommand(): Promise<void> {
  out.header("Squadrn - Setup Wizard");

  // Check if already initialized
  try {
    await Deno.stat(CONFIG_PATH);
    out.warn(`Config already exists at ${CONFIG_PATH}`);
    out.info("Use --force to reinitialize");
    return;
  } catch {
    // Expected: file doesn't exist yet
  }

  // Create directory structure
  out.info("Creating directory structure...");
  await ensureDir(SQUADRN_DIR);
  await ensureDir(DATA_DIR);
  await ensureDir(AGENTS_DIR);

  // Write default config
  const config = defaultConfig();
  await Deno.writeTextFile(CONFIG_PATH, serializeConfig(config));

  // Write empty plugins file
  await Deno.writeTextFile(PLUGINS_PATH, JSON.stringify([], null, 2));

  out.success(`Created config at ${CONFIG_PATH}`);
  out.success(`Created data directory at ${DATA_DIR}`);
  out.success(`Created agents directory at ${AGENTS_DIR}`);
  out.info("");
  out.info("Edit your config at: " + CONFIG_PATH);
  out.info("Then run: squadrn start");
}
