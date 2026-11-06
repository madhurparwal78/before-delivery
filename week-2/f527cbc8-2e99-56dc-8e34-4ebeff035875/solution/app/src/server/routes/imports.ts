// The client list import: a CSV applied whole or not at all, each bad row named by physical line, column and code,
// and owners and horses matched so replays and simultaneous imports create nothing twice (brief: Business rules,
// Client import; API, Imports).
import { randomUUID } from "node:crypto";
import { audit } from "../audit.js";
import { hashPassword } from "../auth.js";
import { config } from "../config.js";
import { type Client, transaction } from "../db.js";
import { daysChange } from "../days.js";
import { ApiError } from "../errors.js";
import { json, route } from "../http.js";
import { idempotent } from "../idempotency.js";
import { isEmail } from "./input.js";

const HEADER = ["owner_name", "owner_email", "owner_phone", "horse_name", "barn_name", "stall", "cycle_weeks"] as const;
type Column = (typeof HEADER)[number];
const ROW_LIMIT = 5000;

interface CsvRecord {
  /** The physical line where the record starts, the header being line 1. */
  line: number;
  cells: string[];
}

/** Standard CSV: optional UTF-8 BOM, CRLF or LF line ends, quoted fields holding commas, quotes and newlines. */
function parseCsv(text: string): CsvRecord[] {
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let line = 1;
  let start = 1;
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let touched = false;
  const endRecord = (): void => {
    cells.push(cell);
    if (touched || cells.length > 1 || cell !== "") records.push({ line: start, cells });
    cells = [];
    cell = "";
    touched = false;
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else {
        if (char === "\n") line += 1;
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      touched = true;
    } else if (char === ",") {
      cells.push(cell);
      cell = "";
      touched = true;
    } else if (char === "\r" && source[index + 1] === "\n") continue;
    else if (char === "\n" || char === "\r") {
      endRecord();
      line += 1;
      start = line;
    } else cell += char;
  }
  if (cell !== "" || cells.length || touched) endRecord();
  return records;
}

interface ImportError {
  line: number;
  column: Column | "header";
  code: string;
}

interface Row {
  line: number;
  values: Record<Column, string>;
}

const invalid = (errors: ImportError[]): ApiError =>
  new ApiError(422, "import_invalid", {
    errors: errors.sort((a, b) => a.line - b.line || (a.column < b.column ? -1 : a.column > b.column ? 1 : 0)),
  });

/** Every bad row by line, column and code, checked against the database and the earlier rows of the file. */
async function validateRows(client: Client, rows: Row[]): Promise<ImportError[]> {
  const barns = new Map(
    (await client.query<{ id: string; name: string }>(`SELECT id, name FROM barns`)).rows.map((barn) => [barn.name.toLowerCase(), barn.id]),
  );
  const ownerNames = new Map(
    (await client.query<{ email: string; name: string }>(`SELECT lower(email) AS email, name FROM users`)).rows.map((u) => [u.email, u.name]),
  );
  const stalls = new Map<string, string>();
  for (const horse of (
    await client.query<{ barn_id: string; stall: string; email: string; name: string }>(
      `SELECT h.barn_id, h.stall, lower(u.email) AS email, lower(h.name) AS name FROM horses h JOIN users u ON u.id = h.owner_id`,
    )
  ).rows) {
    stalls.set(`${horse.barn_id}|${horse.stall}`, `${horse.email}|${horse.name}`);
  }
  const seenHorses = new Set<string>();
  const errors: ImportError[] = [];
  for (const { line, values } of rows) {
    const fail = (column: Column, code: string): void => {
      errors.push({ line, column, code });
    };
    const empty = HEADER.filter((column) => values[column].trim() === "");
    for (const column of empty) fail(column, "missing_value");
    const email = values.owner_email.trim().toLowerCase();
    const horseKey = `${email}|${values.horse_name.trim().toLowerCase()}`;
    const barnId = barns.get(values.barn_name.trim().toLowerCase());
    if (!empty.includes("owner_email") && !isEmail(values.owner_email.trim())) fail("owner_email", "invalid_email");
    if (!empty.includes("barn_name") && !barnId) fail("barn_name", "unknown_barn");
    if (!empty.includes("cycle_weeks") && !/^\s*[5-8]\s*$/.test(values.cycle_weeks)) fail("cycle_weeks", "cycle_out_of_range");
    if (!empty.includes("horse_name") && seenHorses.has(horseKey)) fail("horse_name", "duplicate_row");
    if (barnId && !empty.includes("stall")) {
      const stallKey = `${barnId}|${values.stall.trim()}`;
      const holder = stalls.get(stallKey);
      if (holder !== undefined && holder !== horseKey) fail("stall", "stall_taken");
      else stalls.set(stallKey, horseKey);
    }
    const knownName = ownerNames.get(email);
    if (!empty.includes("owner_name") && knownName !== undefined && knownName !== values.owner_name) fail("owner_name", "owner_name_mismatch");
    else if (knownName === undefined && email) ownerNames.set(email, values.owner_name);
    seenHorses.add(horseKey);
  }
  return errors;
}

interface Counts {
  created_owners: number;
  matched_owners: number;
  created_horses: number;
  updated_horses: number;
}

/** Owners match on lower-cased email and stay unchanged; horses match on owner and case-insensitive name. */
async function applyRows(client: Client, rows: Row[], at: number): Promise<Counts> {
  const barns = new Map((await client.query<{ id: string; name: string }>(`SELECT id, name FROM barns`)).rows.map((b) => [b.name.toLowerCase(), b.id]));
  const created = new Set<string>();
  const matched = new Set<string>();
  const counts: Counts = { created_owners: 0, matched_owners: 0, created_horses: 0, updated_horses: 0 };
  const password = await hashPassword(config.importDefaultPassword);
  for (const { values } of rows) {
    const email = values.owner_email.trim();
    const key = email.toLowerCase();
    const existing = await client.query<{ id: string }>(`SELECT id FROM users WHERE lower(email) = $1`, [key]);
    let ownerId = existing.rows[0]?.id;
    if (!ownerId) {
      ownerId = randomUUID();
      await client.query(
        `INSERT INTO users (id, name, email, role, password_hash, phone, created_at) VALUES ($1, $2, $3, 'owner', $4, $5, $6)`,
        [ownerId, values.owner_name, email, password, values.owner_phone, new Date(at)],
      );
      created.add(key);
    } else if (!created.has(key)) matched.add(key);
    const barnId = barns.get(values.barn_name.trim().toLowerCase()) ?? "";
    const stall = values.stall.trim();
    const cycle = Number(values.cycle_weeks.trim());
    const horse = await client.query<{ id: string; barn_id: string; stall: string; cycle_weeks: number }>(
      `SELECT id, barn_id, stall, cycle_weeks FROM horses WHERE owner_id = $1 AND lower(name) = lower($2)`,
      [ownerId, values.horse_name],
    );
    const found = horse.rows[0];
    if (!found) {
      await client.query(
        `INSERT INTO horses (id, name, owner_id, barn_id, stall, cycle_weeks, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), values.horse_name, ownerId, barnId, stall, cycle, new Date(at)],
      );
      counts.created_horses += 1;
    } else if (found.barn_id !== barnId || found.stall !== stall || found.cycle_weeks !== cycle) {
      await client.query(`UPDATE horses SET barn_id = $2, stall = $3, cycle_weeks = $4 WHERE id = $1`, [found.id, barnId, stall, cycle]);
      counts.updated_horses += 1;
    }
  }
  counts.created_owners = created.size;
  counts.matched_owners = matched.size;
  return counts;
}

/**
 * Open barn days listing a booking of a horse whose stall this import changes: each is changed under its own
 * serialisation so its open streams get one row change per role (brief: Live streams, Stall changes).
 */
async function daysWithStallChanges(client: Client, rows: Row[]): Promise<string[]> {
  const moving: string[] = [];
  for (const { values } of rows) {
    const { rows: found } = await client.query<{ id: string }>(
      `SELECT h.id FROM horses h JOIN users u ON u.id = h.owner_id
        WHERE lower(u.email) = lower($1) AND lower(h.name) = lower($2) AND h.stall <> $3`,
      [values.owner_email.trim(), values.horse_name, values.stall.trim()],
    );
    moving.push(...found.map((horse) => horse.id));
  }
  if (!moving.length) return [];
  const { rows: days } = await client.query<{ id: string }>(
    `SELECT DISTINCT d.id FROM barn_days d JOIN bookings bk ON bk.barn_day_id = d.id
      WHERE bk.horse_id = ANY($1) AND d.status IN ('published', 'in_progress') AND bk.status <> 'held'`,
    [moving],
  );
  return days.map((day) => day.id);
}

route(
  "POST",
  "/api/imports",
  ["farrier"],
  async (ctx) =>
    idempotent(ctx, async () => {
      const records = parseCsv(ctx.raw.toString("utf8"));
      const header = records[0];
      if (!header || header.cells.join(",") !== HEADER.join(",")) throw invalid([{ line: 1, column: "header", code: "bad_header" }]);
      const data = records.slice(1);
      if (data.length > ROW_LIMIT) throw invalid([{ line: 1, column: "header", code: "too_many_rows" }]);
      const rows: Row[] = data.map((record) => ({
        line: record.line,
        values: Object.fromEntries(HEADER.map((column, index) => [column, record.cells[index] ?? ""])) as Record<Column, string>,
      }));
      const result = await transaction(async (client) => {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('client-import'))`);
        const errors = await validateRows(client, rows);
        if (errors.length) throw invalid(errors);
        const counts = await daysChange(client, await daysWithStallChanges(client, rows), ctx.now, () => applyRows(client, rows, ctx.now));
        const id = randomUUID();
        await client.query(`INSERT INTO imports (id, counts, created_at) VALUES ($1, $2, $3)`, [id, JSON.stringify(counts), new Date(ctx.now)]);
        await audit(client, { action: "import", entityType: "import", entityId: id, from: null, to: "applied" });
        return { id, ...counts, rows: rows.length };
      });
      return json(201, result);
    }),
  { body: "csv" },
);
