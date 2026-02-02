import { bold, cyan, dim, green, red, yellow } from "@std/fmt/colors";
import { formatError as _formatError, SquadrnError } from "@squadrn/core";

export function info(msg: string): void {
  console.log(`${cyan("ℹ")} ${msg}`);
}

export function success(msg: string): void {
  console.log(`${green("✓")} ${msg}`);
}

export function warn(msg: string): void {
  console.log(`${yellow("⚠")} ${msg}`);
}

export function error(msg: string): void {
  console.error(`${red("✗")} ${msg}`);
}

export function header(msg: string): void {
  console.log(`\n${bold(msg)}\n`);
}

/**
 * Display a formatted error to the CLI.
 * Shows message in red, code and hint if it's a SquadrnError,
 * and stack trace if verbose is true.
 */
export function displayError(err: unknown, verbose = false): void {
  if (err instanceof SquadrnError) {
    console.error(`${red("✗")} ${err.message}`);
    console.error(dim(`  Code: ${err.code}`));
    const suggestion = err.suggestion;
    if (suggestion) {
      console.error(`${yellow("  Hint:")} ${suggestion}`);
    }
    if (verbose && err.cause) {
      console.error(dim(`  Caused by: ${err.cause.message}`));
    }
    if (verbose && err.stack) {
      console.error(dim(err.stack));
    }
  } else if (err instanceof Error) {
    console.error(`${red("✗")} ${err.message}`);
    if (verbose && err.stack) {
      console.error(dim(err.stack));
    }
  } else {
    console.error(`${red("✗")} ${String(err)}`);
  }
}

export { _formatError as formatError, SquadrnError };
