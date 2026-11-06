import { isCalendarDate, cellText, parseHundredths } from "./records.ts";
import type { CellValue, Column } from "./types.ts";

export const CSV_LIMIT_BYTES = 1_000_000;

const FORMULA_START = /^'*[=+\-@]/;

const neutralise = (text: string): string => (FORMULA_START.test(text) ? `'${text}` : text);
const restore = (text: string): string => (text.startsWith("'") && FORMULA_START.test(text.slice(1)) ? text.slice(1) : text);

const quoted = (text: string): string => (/[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);

const isNeutralised = (column: Column): boolean => column.type === "text" || column.type === "select";

export function exportCsv(columns: readonly Column[], rows: readonly Record<string, CellValue | undefined>[]): string {
  const heading = columns.map((column) => quoted(neutralise(column.name)));
  const lines = rows.map((row) =>
    columns.map((column) => {
      const text = cellText(column, row[column.id]);
      return quoted(isNeutralised(column) ? neutralise(text) : text);
    }),
  );
  return [heading, ...lines].map((line) => `${line.join(",")}\r\n`).join("");
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const text = content.replace(/^﻿/, "");
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') inQuotes = false;
      else cell += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      rows.push([...row, cell.replace(/\r$/, "")]);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

function importCell(column: Column, raw: string): { value: CellValue } | { problem: string } {
  const text = isNeutralised(column) ? restore(raw) : raw;
  if (column.type === "number") {
    if (text === "") return { value: null };
    const value = parseHundredths(text);
    return value === null ? { problem: "must be a number." } : { value };
  }
  if (column.type === "date") {
    if (text === "") return { value: null };
    return isCalendarDate(text) ? { value: text } : { problem: "must be a date as YYYY-MM-DD." };
  }
  if (column.type === "checkbox") {
    if (text === "") return { value: false };
    return text === "true" || text === "false" ? { value: text === "true" } : { problem: "must be true or false." };
  }
  if (column.type === "select" && text !== "" && !column.options.includes(text)) {
    return { problem: "must be one of the listed options." };
  }
  return { value: text };
}

type CsvImport =
  | { kind: "wrong-columns"; message: string }
  | { kind: "rows"; rows: Record<string, CellValue>[]; skipped: number; problems: string[] };

export function readCsv(content: string, columns: readonly Column[]): CsvImport {
  const [heading = [], ...lines] = parseCsv(content);
  const names = heading.map(restore);
  const wanted = columns.map((column) => column.name);
  const sameColumns = names.length === wanted.length && [...names].sort().join("\n") === [...wanted].sort().join("\n");
  if (!sameColumns) return { kind: "wrong-columns", message: `The first row must match this table's columns: ${wanted.join(", ")}.` };
  const rows: Record<string, CellValue>[] = [];
  const problems: string[] = [];
  lines.forEach((line, index) => {
    const cells: Record<string, CellValue> = {};
    let bad = false;
    columns.forEach((column) => {
      const read = importCell(column, line[names.indexOf(column.name)] ?? "");
      if ("problem" in read) {
        problems.push(`Row ${index + 1}: ${column.name} ${read.problem}`);
        bad = true;
      } else cells[column.id] = read.value;
    });
    if (!bad) rows.push(cells);
  });
  return { kind: "rows", rows, skipped: lines.length - rows.length, problems };
}
