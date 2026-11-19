import { randomUUID } from "node:crypto";
import { iso, one, rows, type Db, type Tx } from "./db.js";

// The credit ledger: every movement is one entry of exactly two rows of equal and opposite amounts.
// A balance is the sum of its account's rows; rows are never edited or deleted.

type EntryKind = "grant" | "pack" | "reserve" | "capture" | "release";

const ISSUED = "platform:issued";
const CONSUMED = "platform:consumed";
export const available = (userId: string): string => `creator:${userId}:available`;
const held = (userId: string): string => `creator:${userId}:held`;

const FLOWS: Record<EntryKind, (userId: string) => [string, string]> = {
  grant: (u) => [ISSUED, available(u)],
  pack: (u) => [ISSUED, available(u)],
  reserve: (u) => [available(u), held(u)],
  capture: (u) => [held(u), CONSUMED],
  release: (u) => [held(u), available(u)],
};

/** Serialises every movement of one creator's credits within the caller's transaction. */
export async function lockCredits(client: Tx, userId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`credits:${userId}`]);
}

export async function balance(db: Db, account: string): Promise<number> {
  const row = await one<{ total: number }>(db, "SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_rows WHERE account = $1", [account]);
  return row?.total ?? 0;
}

/** Writes one balanced entry moving `amount` credits along the kind's flow. */
export async function move(client: Tx, kind: EntryKind, userId: string, amount: number, renderId: string | null = null): Promise<string> {
  const [from, to] = FLOWS[kind](userId);
  const id = randomUUID();
  await client.query("INSERT INTO ledger_entries (id, kind, render_id) VALUES ($1, $2, $3)", [id, kind, renderId]);
  await client.query("INSERT INTO ledger_rows (entry_id, account, amount) VALUES ($1, $2, $3), ($1, $4, $5)", [id, from, -amount, to, amount]);
  return id;
}

export async function creatorCredits(db: Db, userId: string) {
  const entries = await rows<{ id: string; kind: EntryKind; render_id: string | null; created_at: Date; account: string; amount: number }>(
    db,
    `SELECT e.id, e.kind, e.render_id, e.created_at, r.account, r.amount
       FROM ledger_entries e JOIN ledger_rows r ON r.entry_id = e.id
      WHERE e.id IN (SELECT entry_id FROM ledger_rows WHERE account IN ($1, $2))
      ORDER BY e.created_at DESC, e.id, r.amount`,
    [available(userId), held(userId)],
  );
  return {
    available: await balance(db, available(userId)),
    held: await balance(db, held(userId)),
    entries: groupEntries(entries),
  };
}

type EntryRow = { id: string; kind: EntryKind; render_id: string | null; created_at: Date; account: string; amount: number };

function groupEntries(list: EntryRow[]) {
  const byId = new Map<string, { id: string; kind: EntryKind; render_id: string | null; created_at: string | null; rows: { account: string; amount: number }[] }>();
  for (const row of list) {
    const entry = byId.get(row.id) ?? { id: row.id, kind: row.kind, render_id: row.render_id, created_at: iso(row.created_at), rows: [] };
    entry.rows.push({ account: row.account, amount: row.amount });
    byId.set(row.id, entry);
  }
  return [...byId.values()];
}

export async function fullLedger(db: Db) {
  const accounts = await rows<{ account: string; balance: number }>(
    db,
    "SELECT account, SUM(amount) AS balance FROM ledger_rows GROUP BY account ORDER BY account",
  );
  const entries = await rows<EntryRow>(
    db,
    `SELECT e.id, e.kind, e.render_id, e.created_at, r.account, r.amount
       FROM ledger_entries e JOIN ledger_rows r ON r.entry_id = e.id
      ORDER BY e.created_at DESC, e.id, r.amount`,
  );
  return { accounts, entries: groupEntries(entries) };
}
