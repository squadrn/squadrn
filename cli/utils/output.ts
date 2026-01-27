import { bold, cyan, green, red, yellow } from "@std/fmt/colors";

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
