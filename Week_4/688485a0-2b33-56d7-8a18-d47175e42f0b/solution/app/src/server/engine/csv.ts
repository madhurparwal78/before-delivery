import type { JsonObject, JsonValue } from "../../shared/json.js";
import { byCodeUnit, compact, dateOf, isPlainObject } from "./value.js";

/** CSV: reading records with their first physical line, and writing spreadsheet-safe downloads. */

interface CsvRecord {
  line: number;
  cells: string[];
}

export function parseCsv(input: string): CsvRecord[] {
  const text = input.startsWith("﻿") ? input.slice(1) : input;
  const records: CsvRecord[] = [];
  let line = 1;
  let recordLine = 1;
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let fresh = true;
  let fieldStart = true;
  const begin = (): void => {
    if (fresh) {
      recordLine = line;
      fresh = false;
    }
  };
  for (let at = 0; at < text.length; at++) {
    const char = text[at] as string;
    if (quoted) {
      if (char === '"' && text[at + 1] === '"') {
        field += '"';
        at++;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === "\n") line++;
        field += char;
      }
    } else if (char === '"' && fieldStart) {
      begin();
      quoted = true;
      fieldStart = false;
    } else if (char === ",") {
      begin();
      cells.push(field);
      field = "";
      fieldStart = true;
    } else if (char === "\n") {
      if (!fresh) {
        cells.push(field);
        records.push({ line: recordLine, cells });
      }
      cells = [];
      field = "";
      fresh = true;
      fieldStart = true;
      line++;
    } else if (!(char === "\r" && text[at + 1] === "\n")) {
      begin();
      field += char;
      fieldStart = false;
    }
  }
  if (!fresh) {
    cells.push(field);
    records.push({ line: recordLine, cells });
  }
  return records;
}

const FORMULA_START = /^[=+\-@\t\r]/;

function quoteCell(text: string, isNumber: boolean): string {
  const safe = !isNumber && FORMULA_START.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function leaves(value: JsonObject, prefix: string, into: Map<string, JsonValue>): void {
  for (const [key, inner] of Object.entries(value)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (isPlainObject(inner) && Object.keys(inner).length > 0) leaves(inner, path, into);
    else into.set(path, inner);
  }
}

function cellText(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (dateOf(value) !== null) return (value as JsonObject)["$date"] as string;
  return compact(value);
}

export function renderCsv(docs: JsonObject[]): string {
  const rows = docs.map((doc) => {
    const map = new Map<string, JsonValue>();
    leaves(doc, "", map);
    return map;
  });
  const columns = [...new Set(rows.flatMap((row) => [...row.keys()]))].sort(byCodeUnit);
  if (columns.length === 0) return "";
  const lines = [columns.map((column) => quoteCell(column, false)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => {
      const value = row.get(column);
      return value === undefined ? "" : quoteCell(cellText(value), typeof value === "number");
    }).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export function renderJsonLines(docs: JsonObject[]): string {
  return docs.map((doc) => compact(doc) + "\n").join("");
}
