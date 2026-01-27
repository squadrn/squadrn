import { parseArgs } from "@std/cli/parse-args";
import { initCommand } from "./commands/init.ts";
import { startCommand } from "./commands/start.ts";
import { stopCommand } from "./commands/stop.ts";
import { statusCommand } from "./commands/status.ts";
import * as out from "./utils/output.ts";

const VERSION = "0.1.0";

const HELP = `
squadrn v${VERSION} - AI Agent Orchestration

Usage: squadrn <command> [options]

Commands:
  init      Initialize Squadrn (creates config & directories)
  start     Start the gateway daemon
  stop      Stop the gateway daemon
  status    Show current status

Options:
  -h, --help      Show this help
  -v, --version   Show version
`;

function main(): void {
  const args = parseArgs(Deno.args, {
    boolean: ["help", "version"],
    alias: { h: "help", v: "version" },
  });

  if (args.version) {
    console.log(`squadrn v${VERSION}`);
    return;
  }

  const command = args._[0] as string | undefined;

  if (!command || args.help) {
    console.log(HELP);
    return;
  }

  switch (command) {
    case "init":
      initCommand();
      break;
    case "start":
      startCommand();
      break;
    case "stop":
      stopCommand();
      break;
    case "status":
      statusCommand();
      break;
    default:
      out.error(`Unknown command: ${command}`);
      console.log(HELP);
      Deno.exit(1);
  }
}

main();
