import type { Value } from "../shared/expression.js";
import type { Env } from "./env.js";
import { fail, notFound, storageUnavailable, validation } from "./errors.js";
import { CLASS_LABELS, classLabelOf } from "./map.js";
import { isAvailable, putObject, StorageDown } from "./storage.js";
import { createCi, updateCi } from "./cis.js";

export type ImportTable = "people" | "configuration_items";

type Row = Record<string, string>;

interface ParsedRow {
  line: number;
  values: Row;
  errors: string[];
}

export interface ImportRowJson {
  line: number;
  action: "create" | "update" | "unchanged" | "error";
  key: string;
  errors: string[];
}

export interface ImportJson {
  id: number;
  table: ImportTable;
  key: string;
  rows: ImportRowJson[];
  counts: { create: number; update: number; unchanged: number; error: number };
  results?: Array<{ line: number; outcome: "created" | "updated" | "unchanged" | "failed"; errors: string[] }>;
}

const COLUMNS: Record<ImportTable, { match: string; all: string[]; required: string[] }> = {
  people: { match: "username", all: ["username", "display_name", "department", "active"], required: ["username", "display_name"] },
  configuration_items: { match: "name", all: ["name", "class", "criticality", "business_critical", "owner_department"], required: ["name", "class"] },
};

/** One CSV line: comma separation, double-quote quoting, "" for a quote. */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(current);
      current = "";
    } else current += ch;
  }
  out.push(current);
  return out;
}

function parseFile(text: string, table: ImportTable, mapping: Record<string, string>): { header: string[]; rows: ParsedRow[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const marker = `#switchyard-import v1 ${table}`;
  if (lines[0] !== marker) return validation(`Line 1: the first line must be "${marker}".`);
  const header = splitLine(lines[1] ?? "").map((c) => mapping[c] ?? c);
  for (const column of header) if (!COLUMNS[table].all.includes(column)) return validation(`Line 2: unknown column "${column}".`);
  const rows: ParsedRow[] = [];
  const seen = new Map<string, number>();
  lines.slice(2).forEach((raw, index) => {
    const line = index + 3;
    if (raw.trim() === "") return;
    const cells = splitLine(raw);
    const errors: string[] = [];
    if (cells.length !== header.length) errors.push(`Line ${line}: expected ${header.length} values, found ${cells.length}.`);
    const values: Row = {};
    header.forEach((column, i) => {
      values[column] = (cells[i] ?? "").trim();
    });
    if (errors.length === 0) {
      for (const column of COLUMNS[table].required) if (values[column] === undefined || values[column] === "") errors.push(`Line ${line}: ${column} is required.`);
      const key = values[COLUMNS[table].match];
      if (key) {
        const first = seen.get(key);
        if (first !== undefined) errors.push(`Line ${line}: duplicate key "${key}" also on line ${first}.`);
        else seen.set(key, line);
      }
    }
    rows.push({ line, values, errors });
  });
  return { header, rows };
}

async function checkRow(env: Env, table: ImportTable, row: ParsedRow): Promise<void> {
  const v = row.values;
  const bad = (column: string, allowed: string[]): void => {
    if (v[column] !== undefined && v[column] !== "" && !allowed.includes(v[column]!)) row.errors.push(`Line ${row.line}: ${column} "${v[column]}" is not one of ${allowed.join(", ")}.`);
  };
  if (table === "people") {
    bad("active", ["true", "false"]);
    if (v.department && !(await env.tx.query("SELECT 1 FROM departments WHERE name = $1", [v.department])).length) row.errors.push(`Line ${row.line}: department "${v.department}" does not exist.`);
  } else {
    if (v.class && !classLabelOf(v.class)) row.errors.push(`Line ${row.line}: class "${v.class}" is not one of ${CLASS_LABELS.join(", ")}.`);
    bad("criticality", ["1", "2", "3"]);
    bad("business_critical", ["true", "false"]);
    if (v.owner_department && !(await env.tx.query("SELECT 1 FROM departments WHERE name = $1", [v.owner_department])).length) row.errors.push(`Line ${row.line}: owner_department "${v.owner_department}" does not exist.`);
  }
}

async function actionFor(env: Env, table: ImportTable, row: ParsedRow): Promise<"create" | "update" | "unchanged"> {
  const v = row.values;
  if (table === "people") {
    const found = (await env.tx.query("SELECT display_name, department, active FROM people WHERE username = $1", [v.username]))[0];
    if (!found) return "create";
    const same =
      (v.display_name === undefined || found.display_name === v.display_name) &&
      (v.department === undefined || found.department === v.department) &&
      (v.active === undefined || v.active === "" || found.active === (v.active === "true"));
    return same ? "unchanged" : "update";
  }
  const known = [...env.world.cis.values()].find((c) => c.name.toLowerCase() === v.name!.toLowerCase());
  if (!known) return "create";
  const same =
    (v.class === undefined || known.class === classLabelOf(v.class)) &&
    (v.criticality === undefined || v.criticality === "" || known.criticality === Number(v.criticality)) &&
    (v.business_critical === undefined || v.business_critical === "" || known.business_critical === (v.business_critical === "true")) &&
    (v.owner_department === undefined || v.owner_department === "" || known.owner_department === v.owner_department);
  return same ? "unchanged" : "update";
}

function summarise(id: number, table: ImportTable, key: string, rows: ImportRowJson[]): ImportJson {
  const counts = { create: 0, update: 0, unchanged: 0, error: 0 };
  for (const r of rows) counts[r.action]++;
  return { id, table, key, rows, counts };
}

export async function previewImport(env: Env, table: unknown, filename: string, data: Buffer, mappingText: string | undefined): Promise<ImportJson> {
  if (table !== "people" && table !== "configuration_items") return validation("Choose people or configuration_items.", { table: "Choose a table." });
  if (!isAvailable()) return storageUnavailable();
  let mapping: Record<string, string> = {};
  if (mappingText) {
    try {
      mapping = JSON.parse(mappingText) as Record<string, string>;
    } catch {
      return validation("The mapping must be a JSON object.", { mapping: "Send a JSON object." });
    }
  }
  const parsed = parseFile(data.toString("utf8"), table, mapping);
  const rows: ImportRowJson[] = [];
  for (const row of parsed.rows) {
    await checkRow(env, table, row);
    const key = row.values[COLUMNS[table].match] ?? "";
    rows.push({ line: row.line, key, errors: row.errors, action: row.errors.length > 0 ? "error" : await actionFor(env, table, row) });
  }
  const inserted = await env.tx.query<{ id: number }>("INSERT INTO imports (table_name, key, rows, counts) VALUES ($1, '', $2, '{}') RETURNING id", [table, JSON.stringify({ parsed: parsed.rows, rows })]);
  const id = inserted[0]!.id;
  const key = `imports/${id}/${filename.replace(/[/\\]/g, "_")}`;
  try {
    await putObject(key, data, "text/csv");
  } catch (error) {
    if (error instanceof StorageDown) return storageUnavailable();
    throw error;
  }
  const json = summarise(id, table, key, rows);
  await env.tx.query("UPDATE imports SET key = $2, counts = $3 WHERE id = $1", [id, key, JSON.stringify(json.counts)]);
  return json;
}

export async function commitImport(env: Env, id: number): Promise<ImportJson> {
  const found = (await env.tx.query("SELECT * FROM imports WHERE id = $1 FOR UPDATE", [id]))[0];
  if (!found) return notFound();
  if (found.committed) fail(409, "already_committed", "This import was already committed.");
  const table = found.table_name as ImportTable;
  const stored = found.rows as { parsed: ParsedRow[]; rows: ImportRowJson[] };
  const results: NonNullable<ImportJson["results"]> = [];
  for (const row of stored.parsed) {
    if (row.errors.length > 0) {
      results.push({ line: row.line, outcome: "failed", errors: row.errors });
      continue;
    }
    const action = await actionFor(env, table, row);
    if (action === "unchanged") {
      results.push({ line: row.line, outcome: "unchanged", errors: [] });
      continue;
    }
    const v = row.values;
    if (table === "people") {
      const department = v.department ?? "";
      await env.tx.query(
        `INSERT INTO people (username, display_name, department, active) VALUES ($1, $2, $3, $4)
         ON CONFLICT (username) DO UPDATE SET display_name = COALESCE(NULLIF($2, ''), people.display_name), department = CASE WHEN $5 THEN $3 ELSE people.department END, active = CASE WHEN $6 THEN $4 ELSE people.active END`,
        [v.username, v.display_name, department, v.active === undefined || v.active === "" ? true : v.active === "true", v.department !== undefined, v.active !== undefined && v.active !== ""],
      );
    } else {
      const body = { name: v.name, class: classLabelOf(v.class), criticality: v.criticality ? Number(v.criticality) : undefined, business_critical: v.business_critical ? v.business_critical === "true" : undefined, owner_department: v.owner_department || undefined };
      if (action === "create") await createCi(env, { criticality: 2, business_critical: false, owner_department: "IT provider", ...stripUndefined(body) });
      else await updateCi(env, v.name!, stripUndefined(body));
    }
    results.push({ line: row.line, outcome: action === "create" ? "created" : "updated", errors: [] });
  }
  await env.tx.query("UPDATE imports SET committed = true, results = $2 WHERE id = $1", [id, JSON.stringify(results)]);
  return { ...summarise(id, table, found.key as string, stored.rows), results };
}

function stripUndefined(body: Record<string, Value | undefined>): Record<string, Value> {
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as Record<string, Value>;
}
