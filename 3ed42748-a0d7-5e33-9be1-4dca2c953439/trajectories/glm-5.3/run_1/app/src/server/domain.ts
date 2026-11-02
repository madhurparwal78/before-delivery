import type { Tx } from "./db.js";
import { Errors } from "./errors.js";
import { randomId, newSessionToken } from "./config.js";
import { isoFromPgDate } from "./time.js";
import { RESIDENTS, SATCHELS } from "../shared/seed.js";

export type Role = "guest" | "courier" | "helper" | "founder";

export type CourierRow = {
  id: string;
  email: string | null;
  role: Role;
  display_name: string;
  name_locked: boolean;
  muted: boolean;
  worn_satchel: string;
  guest_save_claimed: boolean;
  moderation_ref: string;
};

export type SessionRow = { token: string; courier_id: string };

export type OpenParcelRow = {
  acceptance_id: string;
  mission_id: string;
  version: number;
  first_answer: string;
};

// ---------------------------------------------------------------------------
// Sessions

export async function createSession(tx: Tx, courierId: string): Promise<string> {
  const token = newSessionToken();
  await tx.query(`INSERT INTO sessions (token, courier_id) VALUES ($1,$2)`, [token, courierId]);
  return token;
}

export async function courierForSession(tx: Tx, token: string | undefined): Promise<{ courier: CourierRow; session: string } | null> {
  if (!token) return null;
  const { rows } = await tx.query<CourierRow & { session: string }>(
    `SELECT c.*, s.token AS session FROM sessions s JOIN couriers c ON c.id = s.courier_id WHERE s.token = $1`,
    [token],
  );
  if (rows.length === 0) return null;
  const { session, ...courier } = rows[0];
  return { courier, session };
}

// ---------------------------------------------------------------------------
// Ledger: pairing, balance and cursors

export async function balanceOf(tx: Tx, courierId: string): Promise<number> {
  const { rows } = await tx.query<{ sum: string | null }>(
    `SELECT COALESCE(SUM(e.amount), 0)::text AS sum FROM ledger_entries e
     JOIN ledger_movements m ON m.movement_id = e.movement_id
     WHERE m.courier_id = $1 AND e.account = 'courier'`,
    [courierId],
  );
  return Number(rows[0].sum ?? 0);
}

/** Writes one movement: its two paired entries sum to zero and share movement_id and ref. */
export async function writeMovement(
  tx: Tx,
  courierId: string,
  kind: "delivery" | "purchase",
  ref: string,
  amount: number,
): Promise<{ movementId: string; createdAt: Date }> {
  const movementId = randomId("mv_");
  const createdAt = new Date();
  await tx.query(
    `INSERT INTO ledger_movements (movement_id, courier_id, kind, ref, created_at) VALUES ($1,$2,$3,$4,$5)`,
    [movementId, courierId, kind, ref, createdAt],
  );
  await tx.query(
    `INSERT INTO ledger_entries (movement_id, account, amount) VALUES ($1,'courier',$2),($1,$3,$4)`,
    [movementId, amount, kind === "delivery" ? "mint" : "outfitter", -amount],
  );
  return { movementId, createdAt };
}

// ---------------------------------------------------------------------------
// Stamp history cursors: opaque, HMAC-bound to the courier

import { createHmac } from "node:crypto";

export async function siteSecret(tx: Tx): Promise<string> {
  const { rows } = await tx.query<{ value: string }>(`SELECT value FROM settings WHERE key = 'site_secret'`);
  if (rows.length === 0) {
    const secret = randomId("secret_");
    await tx.query(`INSERT INTO settings (key, value) VALUES ('site_secret',$1) ON CONFLICT DO NOTHING`, [secret]);
    return secret;
  }
  return rows[0].value;
}

export function encodeCursor(secret: string, courierId: string, movementId: string): string {
  const payload = Buffer.from(`${courierId}|${movementId}`, "utf8").toString("base64url");
  const mac = createHmac("sha256", secret).update(payload).digest("base64url").slice(0, 16);
  return `${payload}.${mac}`;
}

export function decodeCursor(secret: string, courierId: string, cursor: string): string | null {
  const dot = cursor.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = cursor.slice(0, dot);
  const mac = cursor.slice(dot + 1);
  const expect = createHmac("sha256", secret).update(payload).digest("base64url").slice(0, 16);
  if (mac !== expect) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [cid, movementId] = decoded.split("|");
  if (cid !== courierId || !movementId) return null;
  return movementId;
}

// ---------------------------------------------------------------------------
// Shared object serialization

export type Movement = {
  movement_id: string;
  kind: "delivery" | "purchase";
  created_at: string;
  entries: Array<{ account: "courier" | "mint" | "outfitter"; amount: number; ref: string }>;
};

export function serializeMovement(row: {
  movement_id: string; kind: "delivery" | "purchase"; created_at: Date;
  account: string; amount: number; ref: string;
}[]): Movement | null {
  if (row.length === 0) return null;
  const head = row[0];
  const courierEntry = row.find((r) => r.account === "courier");
  const other = row.find((r) => r.account !== "courier");
  if (!courierEntry || !other) return null;
  return {
    movement_id: head.movement_id,
    kind: head.kind,
    created_at: isoFromPgDate(head.created_at),
    entries: [
      { account: "courier", amount: courierEntry.amount, ref: courierEntry.ref },
      { account: other.account as "mint" | "outfitter", amount: other.amount, ref: other.ref },
    ],
  };
}

export async function serializeMe(tx: Tx, courier: CourierRow): Promise<Record<string, unknown>> {
  const balance = await balanceOf(tx, courier.id);
  const owned = await tx.query<{ satchel_id: string }>(
    `SELECT satchel_id FROM satchel_ownership WHERE courier_id = $1`, [courier.id],
  );
  const open = await openParcelOf(tx, courier.id);
  return {
    role: courier.role,
    display_name: courier.display_name,
    satchel_colour: courier.worn_satchel,
    balance,
    email: courier.email,
    name_locked: courier.name_locked,
    muted: courier.muted,
    satchels_owned: owned.rows.map((r) => r.satchel_id),
    open_parcel: open,
  };
}

export async function openParcelOf(tx: Tx, courierId: string): Promise<unknown> {
  const { rows } = await tx.query<{ first_answer: string }>(
    `SELECT first_answer FROM acceptances WHERE courier_id = $1 AND status = 'open' LIMIT 1`,
    [courierId],
  );
  return rows.length ? JSON.parse(rows[0].first_answer) : null;
}

// ---------------------------------------------------------------------------
// Residents and satchels lookups

export function residentById(id: string) {
  return RESIDENTS.find((r) => r.resident_id === id) ?? null;
}

export function satchelById(id: string) {
  return SATCHELS.find((s) => s.satchel_id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Tickets: storing, waiting and replay for hand-overs, purchases and postcard mail

export type TicketNamespace = "handover" | "purchase" | "mail";

/**
 * Handles a ticket under the single namespace rule. Requests carrying the same ticket are
 * serialized by a transaction-scoped advisory lock, so a stored success replays byte for
 * byte, a different binding conflicts, and simultaneous duplicates yield identical answers
 * while only one runs. Refusals are never stored.
 */
export async function withTicket(
  tx: Tx,
  namespace: TicketNamespace,
  courierId: string,
  ticket: string,
  binding: string,
  runFresh: (tx: Tx) => Promise<{ status: number; body: string }>,
): Promise<{ status: number; body: string }> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${namespace}:${courierId}:${ticket}`]);
  const { rows } = await tx.query<{ status: number | null; body: string | null; bound: string }>(
    `SELECT status, body, bound FROM tickets WHERE namespace=$1 AND courier_id=$2 AND ticket=$3`,
    [namespace, courierId, ticket],
  );
  const row = rows[0];
  if (row) {
    if (row.bound !== binding) throw Errors.conflict("ticket_conflict", "That ticket was used for something else.");
    if (row.status !== null && row.body !== null) return { status: row.status, body: row.body };
  } else {
    await tx.query(
      `INSERT INTO tickets (namespace, courier_id, ticket, bound) VALUES ($1,$2,$3,$4)`,
      [namespace, courierId, ticket, binding],
    );
  }
  const result = await runFresh(tx);
  if (result.status === 201 || (namespace === "mail" && result.status === 200)) {
    await tx.query(
      `UPDATE tickets SET status=$4, body=$5 WHERE namespace=$1 AND courier_id=$2 AND ticket=$3`,
      [namespace, courierId, ticket, result.status, result.body],
    );
  } else {
    // Refusals are never stored: the ticket is judged afresh on every repeat.
    await tx.query(`DELETE FROM tickets WHERE namespace=$1 AND courier_id=$2 AND ticket=$3`, [namespace, courierId, ticket]);
  }
  return result;
}

