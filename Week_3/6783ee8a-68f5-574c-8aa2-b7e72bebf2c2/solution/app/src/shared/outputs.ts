import type { Output } from "./api";
import { TABLE_MIME, withCommas } from "./api";
import type { TableData } from "./api";

/** The output caps live here: how big an output is, what replaces one over the cap, and how a stream splits into lines. */

const outputBytes = (output: Output): number => new TextEncoder().encode(JSON.stringify(output)).length;

export const removedNotice = (cap: number): string => `Output removed: larger than ${withCommas(cap)} bytes`;

export function removedOutput(cap: number): Output {
  return { output_type: "display_data", data: { "text/plain": removedNotice(cap) }, metadata: {} };
}

export const isOverCap = (output: Output, cap: number): boolean => outputBytes(output) > cap;

export const streamText = (text: string | string[]): string => (Array.isArray(text) ? text.join("") : text);

/** A stream's lines; the newline that ends the last line does not start another. */
export function streamLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function tableOf(output: Output): TableData | null {
  if (output.output_type !== "display_data" && output.output_type !== "execute_result") return null;
  const data = output.data[TABLE_MIME];
  if (typeof data !== "object" || data === null) return null;
  const table = data as Partial<TableData>;
  return Array.isArray(table.columns) && Array.isArray(table.rows) ? (table as TableData) : null;
}
