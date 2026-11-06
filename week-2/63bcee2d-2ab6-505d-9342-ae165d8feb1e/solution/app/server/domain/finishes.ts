import { groupDigits } from "../../shared/format.js";
import { characters } from "../http/validate.js";

// The finishes import (brief: Finishes import): header matching, normalisation and the code-then-name
// matching rules, applied row by row in file order. The one place these rules are decided.

const CATEGORIES = ["Paint", "Tile", "Laminate", "Stone", "Timber", "Metal", "Fabric", "Glass", "Lighting", "Other"] as const;
export type Category = (typeof CATEGORIES)[number];
const MAX_ROWS = 2000;

export interface Finish {
  id: string;
  code: string | null;
  name: string;
  category: string;
  supplier: string;
  productRef: string;
  location: string;
  notes: string;
}

type FinishFields = Omit<Finish, "id">;
type Column = "code" | "name" | "category" | "supplier" | "productRef" | "location" | "notes";

const HEADERS: Record<string, Column> = {
  "finish code": "code", "finish name": "name", category: "category", supplier: "supplier",
  "product ref": "productRef", location: "location", notes: "notes",
};

export const LIMITS: Record<Column, { label: string; max: number }> = {
  code: { label: "Finish code", max: 20 }, name: { label: "Finish name", max: 120 }, category: { label: "Category", max: 120 },
  supplier: { label: "Supplier", max: 120 }, productRef: { label: "Product ref", max: 60 }, location: { label: "Location", max: 120 },
  notes: { label: "Notes", max: 500 },
};

export const canonicalCategory = (value: string): Category | undefined =>
  CATEGORIES.find((category) => category.toLowerCase() === value.trim().toLowerCase());

const normCode = (value: string): string => value.trim().toUpperCase();
const normName = (value: string): string => value.trim().replace(/\s+/g, " ");
const nameKey = (value: string): string => normName(value).toLowerCase();

/** RFC 4180 records with the file line each starts on. */
function records(text: string): { line: number; cells: string[] }[] {
  const out: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else { if (char === "\n") line++; cell += char; }
    } else if (char === '"') quoted = true;
    else if (char === ",") { cells.push(cell); cell = ""; }
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      cells.push(cell);
      out.push({ line: start, cells });
      cells = []; cell = ""; line++; start = line;
    } else cell += char;
  }
  if (cell !== "" || cells.length) { cells.push(cell); out.push({ line: start, cells }); }
  return out.filter((record) => record.cells.some((value) => value.trim() !== ""));
}

type ParsedFile = { error: string } | { columns: Column[]; rows: { line: number; values: Partial<Record<Column, string>> }[] };

export function parseLegacyCsv(text: string): ParsedFile {
  const [header, ...body] = records(text.replace(/^﻿/, ""));
  const columns = (header?.cells ?? []).map((name) => HEADERS[name.trim().toLowerCase()]);
  if (!columns.includes("name") || !columns.includes("category")) return { error: "The file needs Finish Name and Category columns." };
  if (body.length > MAX_ROWS) return { error: `The file can have at most ${groupDigits(MAX_ROWS)} rows.` };
  return {
    columns: columns.filter((column): column is Column => !!column),
    rows: body.map((record) => {
      const values: Partial<Record<Column, string>> = {};
      columns.forEach((column, index) => { if (column) values[column] = record.cells[index] ?? ""; });
      return { line: record.line, values };
    }),
  };
}

export interface RowOutcome {
  line: number;
  status: "created" | "updated" | "unchanged" | "rejected";
  code: string | null;
  name: string | null;
  reason: string | null;
  /** The finish to update (by id) or create, with its new fields. */
  write?: { id: string | null; fields: FinishFields };
}

/**
 * Plans one row against the schedule as it stands after the earlier rows. `seen` holds the earlier rows'
 * codes and names (normalised) with their lines.
 */
export function planRow(row: { line: number; values: Partial<Record<Column, string>> }, columns: Column[], schedule: Finish[],
  seen: { codes: Map<string, number>; names: Map<string, number> }): RowOutcome {
  const code = row.values.code !== undefined && normCode(row.values.code) !== "" ? normCode(row.values.code) : null;
  const name = normName(row.values.name ?? "");
  const reject = (reason: string): RowOutcome => ({ line: row.line, status: "rejected", code, name: name || null, reason });
  if (!name) return reject("Name is missing.");
  const category = canonicalCategory(row.values.category ?? "");
  if (!category) return reject(`Unknown category ${(row.values.category ?? "").trim()}.`);
  const values: Partial<Record<Column, string>> = { ...row.values, name, category, ...(code ? { code } : {}) };
  for (const column of columns) {
    const value = column === "code" ? code ?? "" : (values[column] ?? "");
    if (characters(value) > LIMITS[column].max) return reject(`${LIMITS[column].label} can be at most ${groupDigits(LIMITS[column].max)} characters.`);
  }
  const earlier = (code && seen.codes.get(code)) ?? seen.names.get(nameKey(name));
  if (code && !seen.codes.has(code)) seen.codes.set(code, row.line);
  if (!seen.names.has(nameKey(name))) seen.names.set(nameKey(name), row.line);
  if (earlier !== undefined) return reject(`Duplicate of line ${earlier}.`);

  let target = code ? schedule.find((finish) => finish.code === code) : undefined;
  if (!target) {
    const byName = schedule.filter((finish) => nameKey(finish.name) === nameKey(name));
    if (byName.length > 1) return reject("Name matches more than one finish.");
    target = byName[0];
    if (target && code && target.code && target.code !== code) return reject(`Code ${code} conflicts with ${target.code} for the same name.`);
  }
  const base: FinishFields = target
    ? { code: target.code, name: target.name, category: target.category, supplier: target.supplier, productRef: target.productRef,
      location: target.location, notes: target.notes }
    : { code: null, name, category, supplier: "", productRef: "", location: "", notes: "" };
  const next: FinishFields = { ...base, name, category };
  if (code) next.code = code;
  for (const column of ["supplier", "productRef", "location", "notes"] as const) {
    if (columns.includes(column)) next[column] = values[column] ?? "";
  }
  if (!target) return { line: row.line, status: "created", code, name, reason: null, write: { id: null, fields: next } };
  const changed = (Object.keys(next) as (keyof FinishFields)[]).some((key) => next[key] !== base[key]);
  return changed
    ? { line: row.line, status: "updated", code, name, reason: null, write: { id: target.id, fields: next } }
    : { line: row.line, status: "unchanged", code, name, reason: null };
}
