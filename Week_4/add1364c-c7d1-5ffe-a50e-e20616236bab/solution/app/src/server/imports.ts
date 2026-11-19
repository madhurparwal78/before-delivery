import type { Tx } from "./db.js";
import { db, write } from "./db.js";
import { record, type Actor } from "./audit.js";
import { now } from "./clock.js";
import { newId, open, seal, secretLength } from "./crypto.js";
import { Fields, checkBody, conflict, forbidden, invalid, notFound } from "./http.js";
import type { CredentialRow, PersonRow, VaultRow, VendorRow } from "./model.js";
import { isRealDate, officeDate } from "./office-time.js";
import { actorOf } from "./people.js";

const IMPORT_HEADER = ["Vault", "Login for", "Website", "Username", "Password", "Who knows it", "Last changed"];
const MAX_ROWS = 2000;

const MESSAGES = {
  unreadable: "The file could not be read.",
  notUtf8: "Save the spreadsheet as UTF-8 CSV and try again.",
  header: "The first row must be the Lockset column headings.",
  tooMany: "Import at most 2,000 rows at a time.",
  filename: "Give the file a name of 1 to 120 characters.",
};

// ---- reading the file's bytes ----

function decodeBase64(text: string): Buffer | null {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  return Buffer.from(text, "base64");
}

function decodeUtf8(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Fields split on commas; records end at LF or CRLF outside quotes; `""` is one quote inside a quoted field. */
function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let atFieldStart = true;
  let index = 0;
  const endRecord = (): void => {
    record.push(field);
    records.push(record);
    record = [];
    field = "";
    atFieldStart = true;
  };
  while (index < text.length) {
    const char = text[index] ?? "";
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else quoted = false;
      } else field += char;
    } else if (char === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else if (char === ",") {
      record.push(field);
      field = "";
      atFieldStart = true;
    } else if (char === "\n" || (char === "\r" && text[index + 1] === "\n")) {
      if (char === "\r") index++;
      endRecord();
    } else {
      field += char;
      atFieldStart = false;
    }
    index++;
  }
  if (record.length > 0 || field.length > 0 || !atFieldStart) endRecord();
  return records;
}

function cutFilename(name: string): string {
  const last = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  return name.slice(last + 1).replace(/[\u0000-\u001f\u007f]/g, "");
}

interface ParsedFile {
  rows: Array<{ row: number; fields: string[] }>;
}

function readFile(base64: string, fields: Fields): ParsedFile | null {
  const bytes = decodeBase64(base64);
  if (!bytes) {
    fields.add("file_base64", MESSAGES.unreadable);
    return null;
  }
  const text = decodeUtf8(bytes);
  if (text === null) {
    fields.add("file_base64", MESSAGES.notUtf8);
    return null;
  }
  const records = parseRecords(text.startsWith("﻿") ? text.slice(1) : text);
  const header = records[0];
  if (!header || header.length !== IMPORT_HEADER.length || header.some((cell, i) => cell !== IMPORT_HEADER[i])) {
    fields.add("file_base64", MESSAGES.header);
    return null;
  }
  const rows = records
    .slice(1)
    .filter((fieldsOfRow) => !fieldsOfRow.every((cell) => cell === ""))
    .map((fieldsOfRow, i) => ({ row: i + 1, fields: fieldsOfRow }));
  if (rows.length > MAX_ROWS) {
    fields.add("file_base64", MESSAGES.tooMany);
    return null;
  }
  return { rows };
}

// ---- row checks ----

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function hostOf(website: string): string | null {
  const authority = website.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/, 1)[0] ?? "";
  const host = authority.replace(/^.*@/, "").replace(/:\d+$/, "").toLowerCase().replace(/^www\./, "");
  return HOST.test(host) ? host : null;
}

function lastChanged(text: string): string | null | "bad" {
  if (text === "") return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!match) return "bad";
  const iso = `${match[3]}-${String(match[1]).padStart(2, "0")}-${String(match[2]).padStart(2, "0")}`;
  return isRealDate(iso) ? iso : "bad";
}

interface Checked {
  reason: string | null;
  vault?: VaultRow;
  label?: string;
  host?: string;
  username?: string;
  password?: string;
  changed?: string | null;
  who?: string;
}

/** The first failure rejects the row with exactly its reason. */
function checkRow(fieldsOfRow: string[], vaults: VaultRow[]): Checked {
  const vault = vaults.find((candidate) => candidate.name.toLowerCase() === (fieldsOfRow[0] ?? "").toLowerCase());
  if (!vault) return { reason: "Unknown vault" };
  if (fieldsOfRow.length !== IMPORT_HEADER.length) return { reason: "Wrong number of columns" };
  const [, label = "", website = "", username = "", password = "", who = "", changed = ""] = fieldsOfRow;
  if (secretLength(password) < 1 || secretLength(password) > 128) return { reason: "Password must be 1 to 128 characters" };
  if (label.trim().length < 1 || label.trim().length > 60) return { reason: "Login for must be 1 to 60 characters" };
  const host = hostOf(website);
  if (!host) return { reason: "Website must be a domain or URL" };
  if (username.length < 1 || username.length > 120) return { reason: "Username must be 1 to 120 characters" };
  const date = lastChanged(changed.trim());
  if (date === "bad") return { reason: "Last changed must be M/D/YYYY" };
  return { reason: null, vault, label: label.trim(), host, username, password, changed: date, who };
}

// ---- matching people ----

const squash = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();
const words = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);

interface NameResult {
  text: string;
  match: "email" | "full_name" | "alias" | "chosen" | "not_on_record" | null;
  person_id: string | null;
  held: "no_match" | "ambiguous" | null;
  candidates: Array<{ person_id: string; full_name: string }>;
}

const candidateOf = (person: PersonRow): { person_id: string; full_name: string } => ({ person_id: person.id, full_name: person.full_name });

/** Matching order: email, exact full name, unique alias. Import never creates people. */
function matchName(text: string, people: PersonRow[]): NameResult {
  const key = squash(text);
  const byEmail = people.find((person) => squash(person.email) === key);
  if (byEmail) return { text, match: "email", person_id: byEmail.id, held: null, candidates: [] };
  const byName = people.find((person) => squash(person.full_name) === key);
  if (byName) return { text, match: "full_name", person_id: byName.id, held: null, candidates: [] };
  const byAlias = people.filter((person) => person.aliases.some((alias) => squash(alias) === key));
  const [only] = byAlias;
  if (byAlias.length === 1 && only) return { text, match: "alias", person_id: only.id, held: null, candidates: [] };
  if (byAlias.length > 1) return { text, match: null, person_id: null, held: "ambiguous", candidates: byAlias.map(candidateOf) };
  const shared = new Set(words(text));
  return {
    text,
    match: null,
    person_id: null,
    held: "no_match",
    candidates: people.filter((person) => words(person.full_name).some((word) => shared.has(word))).map(candidateOf),
  };
}

const namesIn = (who: string): string[] => who.split(/[;/]/).map((name) => name.trim()).filter((name) => name.length > 0);

// ---- filing logins ----

interface Parsed {
  vault_id: string;
  label: string;
  host: string;
  username: string;
  sealed_password: string;
  changed: string | null;
}

async function existingLogin(tx: Tx, vaultId: string, host: string, username: string): Promise<CredentialRow | null> {
  return tx.one<CredentialRow>(
    `SELECT c.* FROM credentials c JOIN vendors v ON v.id = c.vendor_id
     WHERE c.vault_id = $1 AND v.domain = $2 AND lower(c.username) = lower($3)`,
    [vaultId, host, username],
  );
}

async function fileLogin(tx: Tx, parsed: Parsed, holders: string[], actor: Actor, at: Date): Promise<string> {
  let vendor = await tx.one<VendorRow>("SELECT * FROM vendors WHERE domain = $1", [parsed.host]);
  if (!vendor) {
    const vendorId = newId();
    await tx.query("INSERT INTO vendors (id, name, domain, created_at) VALUES ($1,$2,$2,$3)", [vendorId, parsed.host, at]);
    vendor = await tx.one<VendorRow>("SELECT * FROM vendors WHERE domain = $1", [parsed.host]);
    if (!vendor) throw new Error("vendor was not stored");
    await record(tx, actor, "vendor_create", { kind: "vendor", id: vendor.id, name: vendor.name }, { domain: vendor.domain });
  }
  const id = newId();
  await tx.query(
    `INSERT INTO credentials (id, vault_id, vendor_id, label, username, secret_sealed, secret_length, last_turned_on, imported_on, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      parsed.vault_id,
      vendor.id,
      parsed.label,
      parsed.username,
      parsed.sealed_password,
      secretLength(open(parsed.sealed_password)),
      parsed.changed ?? officeDate(at),
      officeDate(at),
      at,
    ],
  );
  for (const personId of holders) {
    await tx.query("INSERT INTO holders (credential_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, personId]);
  }
  await record(tx, actor, "credential_create", { kind: "login", id, name: parsed.label }, { vault_id: parsed.vault_id });
  return id;
}

interface StoredRow {
  import_id: string;
  row: number;
  outcome: "created" | "matched" | "held" | "rejected";
  reason: string | null;
  parsed: Parsed | null;
  names: NameResult[];
  credential_id: string | null;
}

const rowJson = (row: StoredRow): Record<string, unknown> => ({
  row: row.row,
  outcome: row.outcome,
  credential_id: row.credential_id,
  reason: row.reason,
  names: row.names,
});

const SPEC = { filename: { kind: "string" as const }, file_base64: { kind: "string" as const } };

export async function importFile(actor: PersonRow, body: unknown): Promise<Record<string, unknown>> {
  return write(async (tx) => {
    if (actor.role !== "office_manager") throw forbidden();
    const fields = new Fields();
    const v = checkBody(body, SPEC, fields);
    const filename = typeof v.filename === "string" ? cutFilename(v.filename) : "";
    if (v.filename !== undefined && (filename.length < 1 || filename.length > 120)) fields.add("filename", MESSAGES.filename);
    const file = typeof v.file_base64 === "string" ? readFile(v.file_base64, fields) : null;
    fields.throwIfAny();
    if (!file) throw invalid({ file_base64: MESSAGES.unreadable });
    const at = now();
    const importId = newId();
    await tx.query("INSERT INTO imports (id, filename, by_person, created_at) VALUES ($1,$2,$3,$4)", [importId, filename, actor.id, at]);
    const [vaults, people] = await Promise.all([
      tx.query<VaultRow>("SELECT * FROM vaults"),
      tx.query<PersonRow>("SELECT * FROM people ORDER BY ord"),
    ]);
    const subject = { kind: "import" as const, id: importId, name: filename };
    const stored: StoredRow[] = [];
    for (const item of file.rows) {
      const checked = checkRow(item.fields, vaults);
      let row: StoredRow = { import_id: importId, row: item.row, outcome: "rejected", reason: checked.reason, parsed: null, names: [], credential_id: null };
      if (!checked.reason && checked.vault && checked.host && checked.username !== undefined && checked.label && checked.password !== undefined) {
        const parsed: Parsed = {
          vault_id: checked.vault.id,
          label: checked.label,
          host: checked.host,
          username: checked.username,
          sealed_password: seal(checked.password),
          changed: checked.changed ?? null,
        };
        const found = await existingLogin(tx, parsed.vault_id, parsed.host, parsed.username);
        if (found) row = { ...row, outcome: "matched", reason: null, credential_id: found.id };
        else {
          const names = namesIn(checked.who ?? "").map((name) => matchName(name, people));
          if (names.some((name) => name.held)) row = { ...row, outcome: "held", reason: null, parsed, names };
          else {
            const holders = [...new Set(names.flatMap((name) => (name.person_id ? [name.person_id] : [])))];
            const credentialId = await fileLogin(tx, parsed, holders, actorOf(actor), at);
            row = { ...row, outcome: "created", reason: null, names, credential_id: credentialId };
          }
        }
      }
      await tx.query(
        "INSERT INTO import_rows (import_id, row, outcome, reason, parsed, names, credential_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [importId, row.row, row.outcome, row.reason, JSON.stringify(row.parsed), JSON.stringify(row.names), row.credential_id],
      );
      await record(tx, actorOf(actor), "import_row", subject, { row: row.row, outcome: row.outcome, reason: row.reason }, at);
      stored.push(row);
    }
    return importJson(importId, filename, stored);
  });
}

function importJson(id: string, filename: string, rows: StoredRow[]): Record<string, unknown> {
  const count = (outcome: string): number => rows.filter((row) => row.outcome === outcome).length;
  return {
    id,
    filename,
    counts: { created: count("created"), matched: count("matched"), held: count("held"), rejected: count("rejected") },
    rows: rows.map(rowJson),
  };
}

async function storedRows(reader: Tx | typeof db, importId: string): Promise<StoredRow[]> {
  return reader.query<StoredRow>("SELECT * FROM import_rows WHERE import_id = $1 ORDER BY row", [importId]);
}

export async function showImport(viewer: PersonRow, id: string): Promise<Record<string, unknown>> {
  const found = await db.one<{ id: string; filename: string }>("SELECT id, filename FROM imports WHERE id = $1", [id]);
  if (!found) throw notFound();
  if (viewer.role !== "office_manager") throw forbidden();
  return importJson(found.id, found.filename, await storedRows(db, id));
}

export async function chooseHeld(actor: PersonRow, id: string, rowNumber: string, body: unknown): Promise<Record<string, unknown>> {
  return write(async (tx) => {
    const found = await tx.one<{ id: string; filename: string }>("SELECT id, filename FROM imports WHERE id = $1", [id]);
    const number = /^\d+$/.test(rowNumber) ? Number(rowNumber) : -1;
    const row = found ? await tx.one<StoredRow>("SELECT * FROM import_rows WHERE import_id = $1 AND row = $2", [id, number]) : null;
    if (!found || !row) throw notFound();
    if (actor.role !== "office_manager") throw forbidden();
    if (row.outcome !== "held" || !row.parsed) throw conflict("row_not_held", "That row is not waiting for a choice.");
    const fields = new Fields();
    const v = checkBody(body, { text: { kind: "string" }, person_id: { kind: "string_or_null" } }, fields);
    const target = row.names.find((name) => name.held && name.text === v.text);
    if (v.text !== undefined && !target) fields.add("text", "That name is not waiting for a choice in this row.");
    if (target && typeof v.person_id === "string" && !target.candidates.some((candidate) => candidate.person_id === v.person_id)) {
      fields.add("person_id", "Pick one of the candidates.");
    }
    fields.throwIfAny();
    if (!target) throw new Error("name was validated");
    const at = now();
    const chosen = typeof v.person_id === "string" ? v.person_id : null;
    const names = row.names.map((name) =>
      name === target || (name.held && name.text === target.text)
        ? { ...name, match: chosen ? ("chosen" as const) : ("not_on_record" as const), person_id: chosen, held: null }
        : name,
    );
    await record(tx, actorOf(actor), "import_choice", { kind: "import", id, name: found.filename }, { row: row.row, outcome: "held" }, at);
    let next: StoredRow = { ...row, names };
    if (!names.some((name) => name.held)) {
      const parsed = row.parsed;
      const already = await existingLogin(tx, parsed.vault_id, parsed.host, parsed.username);
      if (already) next = { ...next, outcome: "matched", credential_id: already.id };
      else {
        const holders = [...new Set(names.flatMap((name) => (name.person_id ? [name.person_id] : [])))];
        next = { ...next, outcome: "created", credential_id: await fileLogin(tx, parsed, holders, actorOf(actor), at) };
      }
    }
    await tx.query("UPDATE import_rows SET outcome = $3, names = $4, credential_id = $5 WHERE import_id = $1 AND row = $2", [
      id,
      row.row,
      next.outcome,
      JSON.stringify(next.names),
      next.credential_id,
    ]);
    return rowJson(next);
  });
}
