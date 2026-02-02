/**
 * Simple table renderer using Cliffy Table.
 * @module
 */

import { Table } from "@cliffy/table";

export interface TableOptions {
  header: string[];
  rows: string[][];
  maxColWidth?: number;
}

export function renderTable(opts: TableOptions): string {
  const table = new Table()
    .header(opts.header)
    .body(opts.rows)
    .border(false)
    .padding(2);

  if (opts.maxColWidth) {
    table.maxColWidth(opts.maxColWidth);
  }

  return table.toString();
}
