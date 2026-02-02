import { Confirm } from "@cliffy/prompt";
import { bold, cyan, dim, green, yellow } from "@std/fmt/colors";
import {
  GatewayClient,
  isLocalPath,
  readPluginsJson,
  toRawManifestUrl,
  validateManifest,
  writePluginsJson,
} from "@squadrn/core";
import type { InstalledPlugin } from "@squadrn/core";
import type { PluginManifest, PluginPermissions } from "@squadrn/types";
import { PLUGINS_PATH, SOCKET_PATH } from "../utils/paths.ts";
import * as out from "../utils/output.ts";

const PLUGIN_HELP = `
Usage: squadrn plugin <subcommand> [options]

Subcommands:
  add <source>         Install a plugin from GitHub URL or local path
  remove <name>        Uninstall a plugin
  list                 List installed plugins
  update [name]        Update plugin(s) to latest version
`;

// ── Main router ─────────────────────────────────────────────────────────────

export async function pluginCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "add":
      await pluginAdd(args[1]);
      break;
    case "remove":
      await pluginRemove(args[1]);
      break;
    case "list":
      await pluginList();
      break;
    case "update":
      await pluginUpdate(args[1]);
      break;
    default:
      if (subcommand) {
        out.error(`Unknown plugin subcommand: ${subcommand}`);
      }
      console.log(PLUGIN_HELP);
  }
}

// ── add ─────────────────────────────────────────────────────────────────────

async function pluginAdd(source: string | undefined): Promise<void> {
  if (!source) {
    out.error("Usage: squadrn plugin add <source>");
    out.info("Examples:");
    out.info("  squadrn plugin add https://github.com/squadrn/channel-telegram");
    out.info("  squadrn plugin add ./plugins/ui-terminal");
    return;
  }

  const local = isLocalPath(source);

  // Validate source format
  if (!local && !source.match(/^https?:\/\/github\.com\/[^/]+\/[^/]+/)) {
    out.error("Invalid source. Must be a GitHub URL or local path (./  ../  /).");
    out.info("Example: https://github.com/squadrn/channel-telegram");
    return;
  }

  // Fetch manifest
  const manifestPath = toRawManifestUrl(source);
  out.info(`Reading manifest from ${dim(manifestPath)}...`);

  let manifest: PluginManifest;
  try {
    if (local) {
      const text = await Deno.readTextFile(manifestPath);
      const json = JSON.parse(text);
      validateManifest(json);
      manifest = json;
    } else {
      const resp = await fetch(manifestPath);
      if (!resp.ok) {
        out.error(`Failed to fetch manifest (HTTP ${resp.status})`);
        out.info("Make sure the repository has a manifest.json in the root.");
        return;
      }
      const json = await resp.json();
      validateManifest(json);
      manifest = json;
    }
  } catch (err) {
    out.displayError(err);
    return;
  }

  // Show plugin info
  console.log();
  out.header("Plugin Details");
  console.log(`  ${bold("Name:")}         ${manifest.name}`);
  console.log(`  ${bold("Version:")}      ${manifest.version}`);
  console.log(`  ${bold("Type:")}         ${manifest.type}`);
  console.log(`  ${bold("Description:")}  ${manifest.description}`);
  console.log(`  ${bold("Author:")}       ${manifest.author}`);
  console.log(`  ${bold("Min Core:")}     ${manifest.minCoreVersion}`);

  // Show permissions
  const perms = manifest.permissions;
  if (hasPermissions(perms)) {
    console.log();
    console.log(`  ${bold("Permissions:")}`);
    if (perms.net?.length) {
      console.log(`    ${yellow("net:")}    ${perms.net.join(", ")}`);
    }
    if (perms.env?.length) {
      console.log(`    ${yellow("env:")}    ${perms.env.join(", ")}`);
    }
    if (perms.read?.length) {
      console.log(`    ${yellow("read:")}   ${perms.read.join(", ")}`);
    }
    if (perms.write?.length) {
      console.log(`    ${yellow("write:")}  ${perms.write.join(", ")}`);
    }
    if (perms.run?.length) {
      console.log(`    ${yellow("run:")}    ${perms.run.join(", ")}`);
    }
  }

  console.log();

  // Check if already installed
  const installed = await readPluginsJson(PLUGINS_PATH);
  if (installed[manifest.name]) {
    const existing = installed[manifest.name]!;
    out.warn(
      `Plugin "${manifest.name}" is already installed (v${existing.manifest.version})`,
    );
    const overwrite = await Confirm.prompt({
      message: `Replace with v${manifest.version}?`,
      default: false,
    });
    if (!overwrite) {
      out.info("Aborted");
      return;
    }
  } else {
    // Confirm installation
    const proceed = await Confirm.prompt({
      message: "Install this plugin?",
      default: true,
    });
    if (!proceed) {
      out.info("Aborted");
      return;
    }
  }

  // Save to plugins.json
  installed[manifest.name] = {
    url: source,
    manifest,
    installedAt: new Date().toISOString(),
  };
  await writePluginsJson(PLUGINS_PATH, installed);

  out.success(`Plugin "${manifest.name}" installed`);

  // Notify gateway if running
  if (await notifyGatewayReload()) {
    out.info("Gateway notified to reload plugins");
  } else {
    out.info("Plugin will be loaded on next 'squadrn start'");
  }
}

// ── remove ──────────────────────────────────────────────────────────────────

async function pluginRemove(name: string | undefined): Promise<void> {
  if (!name) {
    out.error("Usage: squadrn plugin remove <name>");
    out.info("Run 'squadrn plugin list' to see installed plugins");
    return;
  }

  const installed = await readPluginsJson(PLUGINS_PATH);
  const entry = installed[name];

  if (!entry) {
    out.error(`Plugin "${name}" is not installed`);
    out.info("Run 'squadrn plugin list' to see installed plugins");
    return;
  }

  console.log();
  console.log(
    `  ${bold(entry.manifest.name)} v${entry.manifest.version} (${entry.manifest.type})`,
  );
  console.log(`  ${dim(entry.manifest.description)}`);
  console.log();

  const confirm = await Confirm.prompt({
    message: `Remove plugin "${name}"?`,
    default: false,
  });
  if (!confirm) {
    out.info("Aborted");
    return;
  }

  delete installed[name];
  await writePluginsJson(PLUGINS_PATH, installed);

  out.success(`Plugin "${name}" removed`);

  // Notify gateway if running
  if (await notifyGatewayReload()) {
    out.info("Gateway notified to reload plugins");
  } else {
    out.info("Changes take effect on next 'squadrn start'");
  }
}

// ── list ────────────────────────────────────────────────────────────────────

async function pluginList(): Promise<void> {
  const installed = await readPluginsJson(PLUGINS_PATH);
  const entries = Object.entries(installed);

  if (entries.length === 0) {
    out.info("No plugins installed");
    console.log();
    out.info("Install one with:");
    console.log(`  ${cyan("squadrn plugin add https://github.com/squadrn/channel-telegram")}`);
    return;
  }

  out.header("Installed Plugins");

  // Check gateway status for loaded info
  const loadedPlugins = await getLoadedPlugins();

  // Table header
  const nameW = 30;
  const verW = 10;
  const typeW = 10;
  const statusW = 10;

  console.log(
    `  ${bold(pad("NAME", nameW))} ${bold(pad("VERSION", verW))} ${bold(pad("TYPE", typeW))} ${
      bold(pad("STATUS", statusW))
    }`,
  );
  console.log(`  ${dim("-".repeat(nameW + verW + typeW + statusW + 3))}`);

  for (const [name, entry] of entries) {
    const status = loadedPlugins === null
      ? dim("unknown")
      : loadedPlugins.includes(name)
      ? green("loaded")
      : yellow("not loaded");

    console.log(
      `  ${pad(name, nameW)} ${pad(entry.manifest.version, verW)} ${
        pad(entry.manifest.type, typeW)
      } ${status}`,
    );
  }

  console.log();
  out.info(`${entries.length} plugin${entries.length === 1 ? "" : "s"} installed`);
}

// ── update ──────────────────────────────────────────────────────────────────

async function pluginUpdate(name: string | undefined): Promise<void> {
  const installed = await readPluginsJson(PLUGINS_PATH);
  const entries = name
    ? [[name, installed[name]] as const].filter(([, e]) => e !== undefined)
    : Object.entries(installed);

  if (name && !installed[name]) {
    out.error(`Plugin "${name}" is not installed`);
    return;
  }

  if (entries.length === 0) {
    out.info("No plugins installed");
    return;
  }

  out.info(`Checking for updates...`);
  console.log();

  let updatesAvailable = 0;
  const updates: Array<{ name: string; entry: InstalledPlugin; newManifest: PluginManifest }> = [];

  for (const [pluginName, entry] of entries) {
    const e = entry as InstalledPlugin;
    const manifestPath = toRawManifestUrl(e.url);

    try {
      let newManifest: PluginManifest;
      if (isLocalPath(e.url)) {
        const text = await Deno.readTextFile(manifestPath);
        const json = JSON.parse(text);
        validateManifest(json);
        newManifest = json as PluginManifest;
      } else {
        const resp = await fetch(manifestPath);
        if (!resp.ok) {
          out.warn(`  ${pluginName}: failed to fetch manifest (HTTP ${resp.status})`);
          continue;
        }
        const json = await resp.json();
        validateManifest(json);
        newManifest = json as PluginManifest;
      }

      if (newManifest.version !== e.manifest.version) {
        console.log(
          `  ${bold(pluginName)}: ${dim(e.manifest.version)} → ${green(newManifest.version)}`,
        );
        updates.push({ name: pluginName, entry: e, newManifest });
        updatesAvailable++;
      } else {
        console.log(`  ${pluginName}: ${dim("up to date")} (${e.manifest.version})`);
      }
    } catch (err) {
      out.warn(`  ${pluginName}: ${(err as Error).message}`);
    }
  }

  if (updatesAvailable === 0) {
    console.log();
    out.success("All plugins are up to date");
    return;
  }

  console.log();
  const proceed = await Confirm.prompt({
    message: `Update ${updatesAvailable} plugin${updatesAvailable === 1 ? "" : "s"}?`,
    default: true,
  });
  if (!proceed) {
    out.info("Aborted");
    return;
  }

  // Apply updates
  for (const update of updates) {
    installed[update.name] = {
      url: update.entry.url,
      manifest: update.newManifest,
      installedAt: update.entry.installedAt,
    };
  }
  await writePluginsJson(PLUGINS_PATH, installed);

  out.success(`Updated ${updatesAvailable} plugin${updatesAvailable === 1 ? "" : "s"}`);

  if (await notifyGatewayReload()) {
    out.info("Gateway notified to reload plugins");
  } else {
    out.info("Changes take effect on next 'squadrn start'");
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function hasPermissions(perms: PluginPermissions): boolean {
  return !!(
    perms.net?.length ||
    perms.env?.length ||
    perms.read?.length ||
    perms.write?.length ||
    perms.run?.length
  );
}

/** Pad a string to a fixed width. */
function pad(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

/** Try to notify the running gateway to reload. Returns true if successful. */
async function notifyGatewayReload(): Promise<boolean> {
  const client = new GatewayClient(SOCKET_PATH);
  const resp = await client.reload();
  return resp.ok;
}

/** Get the list of loaded plugins from the running gateway, or null if not running. */
async function getLoadedPlugins(): Promise<string[] | null> {
  const client = new GatewayClient(SOCKET_PATH);
  const resp = await client.status();
  if (!resp.ok || !resp.data) return null;
  const data = resp.data as unknown as { plugins?: string[] };
  return data.plugins ?? null;
}
