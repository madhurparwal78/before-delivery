import { query } from "./db.ts";
import { formatSeconds } from "./config.ts";
import { isTableOutput } from "./runs.ts";
import { ApiError, validationFailed } from "./http.ts";
import type { Output } from "../shared/types.ts";

/** Output caps and table paging in one place. */
export function validateTableRequest(args: { index: number | null; version: string | null; offset: string | null; limit: string | null }): { index: number; version: number; offset: number; limit: number } {
  const errors: { path: string; message: string }[] = [];
  if (args.index === null || args.index < 0) errors.push({ path: "index", message: "must name an output of this cell" });
  if (args.version === null || !/^\d+$/.test(args.version)) errors.push({ path: "version", message: "must be a whole number" });
  if (args.offset !== null && !/^\d+$/.test(args.offset)) errors.push({ path: "offset", message: "must be a whole number of at least 0" });
  if (args.limit !== null && (!/^\d+$/.test(args.limit) || Number(args.limit) < 1)) errors.push({ path: "limit", message: "must be a whole number of at least 1" });
  if (errors.length > 0) throw validationFailed(errors);
  return {
    index: args.index ?? 0,
    version: Number(args.version),
    offset: Number(args.offset ?? "0"),
    limit: Number(args.limit ?? "25"),
  };
}

export function tablePage(table: unknown, offset: number, limit: number, total: number): { columns: string[]; rows: unknown[][]; offset: number; total: number } {
  const rows = (table as { rows: unknown[][] }).rows;
  const columns = (table as { columns: string[] }).columns;
  return { columns, rows: rows.slice(offset, offset + limit), offset, total };
}

export function tableFromOutput(output: Output): { columns: string[]; rows: unknown[][]; total: number } | null {
  if (!isTableOutput(output)) return null;
  const table = ((output as { data: Record<string, unknown> }).data)["application/vnd.brackenpad.table+json"] as { columns: string[]; rows: unknown[][] };
  return { columns: table.columns, rows: table.rows, total: table.rows.length };
}

export function outputSize(output: Output): number {
  return Buffer.byteLength(JSON.stringify(output), "utf8");
}

export function truncatedStreamLines(text: string, cap: number): { lines: string[]; hidden: number } {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "" && text.endsWith("\n")) lines.pop();
  const shown = lines.slice(0, cap);
  return { lines: shown, hidden: Math.max(0, lines.length - shown.length) };
}

export function overCapNotice(byteCap: number): string {
  return `Output removed: larger than ${byteCap.toLocaleString("en-US")} bytes`;
}

export function limitMessage(execLimitMs: number): string {
  return `Execution time limit reached (${formatSeconds(execLimitMs)} s)`;
}
