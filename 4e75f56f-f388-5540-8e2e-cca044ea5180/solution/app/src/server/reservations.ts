import { randomBytes } from "node:crypto";
import { many, one, type Db, type Queryable } from "./db.js";
import { notFound } from "./http.js";
import { PRICES, assertMove, tierOf, type ReservationState } from "./rules.js";
import { buyerDisplayName, type Account } from "./auth.js";

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export interface ReservationRow {
  id: string;
  bench: string;
  state: ReservationState;
  group_id: string | null;
  buyer_id: string;
  attendee_name: string | null;
  attendee_email: string | null;
  attendee_account_id: string | null;
  attendee_accepted: boolean;
  hold_expires_at: Date | null;
  hold_duration: number | null;
  payment_pending: string | null;
  upgrade_target: string | null;
  refund_due_cents: number | null;
  licence_number: string | null;
  licence_state: string | null;
  licence_key: string | null;
  licence_status: string;
  passport_full_name: string | null;
  passport_nationality: string | null;
  passport_number: string | null;
  passport_key: string | null;
  checked_in_day1: boolean;
  checked_in_day2: boolean;
  certificate_number: string | null;
  buyer_name: string;
  buyer_email: string;
  buyer_role: "practitioner" | "clinic";
  buyer_clinic_name: string | null;
  purchased_cents: number;
  refunded_cents: number;
  documents: string[];
}

const SELECT = `
SELECT r.*, a.name AS buyer_name, a.email AS buyer_email, a.role AS buyer_role, a.clinic_name AS buyer_clinic_name,
  COALESCE((SELECT sum(pi.amount_cents) FROM payment_items pi JOIN payments p ON p.id = pi.payment_id
            WHERE pi.reservation_id = r.id AND p.confirmed_at IS NOT NULL), 0) AS purchased_cents,
  COALESCE((SELECT sum(f.amount_cents) FROM refunds f WHERE f.reservation_id = r.id AND f.confirmed_at IS NOT NULL), 0) AS refunded_cents,
  ARRAY(SELECT d.kind FROM documents d WHERE d.owner_id = r.id ORDER BY d.created_at) AS documents
FROM reservations r JOIN accounts a ON a.id = r.buyer_id`;

async function findReservation(db: Queryable, id: string): Promise<ReservationRow | null> {
  return one<ReservationRow>(db, `${SELECT} WHERE r.id = $1`, [id]);
}

/** The reservation as stored now; 404 when there is none. */
export async function reload(db: Queryable, id: string): Promise<ReservationRow> {
  const row = await findReservation(db, id);
  if (!row) throw notFound();
  return row;
}

export async function reservationsWhere(db: Queryable, where: string, params: unknown[]): Promise<ReservationRow[]> {
  return many<ReservationRow>(db, `${SELECT} WHERE ${where} ORDER BY r.created_at, r.bench`, params);
}

/** Locks these reservations (in id order) for the rest of the transaction. */
export async function lockReservations(db: Db, ids: readonly string[]): Promise<void> {
  await db.query("SELECT id FROM reservations WHERE id = ANY($1) ORDER BY id FOR NO KEY UPDATE", [ids]);
}

/** Locks one reservation and returns it as stored once locked. */
export async function lockedReservation(db: Db, id: string): Promise<ReservationRow> {
  await lockReservations(db, [id]);
  return reload(db, id);
}

/** The only way a reservation changes state: every move is checked against the state machine. */
export async function transition(
  db: Db,
  rows: readonly { id: string; state: ReservationState }[],
  to: ReservationState,
  set: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  for (const row of rows) assertMove(row.state, to);
  const columns = Object.keys(set).map((column, index) => `${column} = $${index + 3}`);
  await db.query(`UPDATE reservations SET ${["state = $2", ...columns].join(", ")} WHERE id = ANY($1)`, [
    rows.map((row) => row.id),
    to,
    ...Object.values(set),
  ]);
}

// ---- Relationships ---------------------------------------------------------------------------

export function isBuyer(row: ReservationRow, account: Account): boolean {
  return row.buyer_id === account.id;
}

export function isAttendee(row: ReservationRow, account: Account): boolean {
  return row.attendee_accepted && row.attendee_account_id === account.id;
}

export function isAssignee(row: ReservationRow, account: Account): boolean {
  return account.role === "practitioner" && !row.attendee_accepted && !!row.attendee_email && row.attendee_email.toLowerCase() === account.email_key;
}

type Relationship = "buyer" | "attendee" | "assignee" | "registrar";

/** 404 unless the caller has one of the allowed relationships to the reservation (never 403). */
function assertVisible(row: ReservationRow, account: Account, allowed: readonly Relationship[]): ReservationRow {
  const ok =
    (allowed.includes("registrar") && account.role === "registrar") ||
    (allowed.includes("buyer") && isBuyer(row, account)) ||
    (allowed.includes("attendee") && isAttendee(row, account)) ||
    (allowed.includes("assignee") && isAssignee(row, account));
  if (!ok) throw notFound();
  return row;
}

export async function visibleReservation(db: Queryable, id: string, account: Account, allowed: readonly Relationship[]): Promise<ReservationRow> {
  return assertVisible(await reload(db, id), account, allowed);
}

/** Locks the reservation, then checks the caller may act on it. */
export async function lockedVisible(db: Db, id: string, account: Account, allowed: readonly Relationship[]): Promise<ReservationRow> {
  return assertVisible(await lockedReservation(db, id), account, allowed);
}

/** The name a buyer goes by: the clinic name for a clinic. */
export function buyerName(row: Pick<ReservationRow, "buyer_role" | "buyer_name" | "buyer_clinic_name">): string {
  return buyerDisplayName(row.buyer_role, row.buyer_name, row.buyer_clinic_name);
}

// ---- Money derived per seat ------------------------------------------------------------------

function priceCents(row: ReservationRow): number {
  return PRICES[tierOf(row.bench)].full;
}

export function balanceCents(row: ReservationRow): number {
  return priceCents(row) - row.purchased_cents;
}

// ---- The reservation object ------------------------------------------------------------------

function holdView(row: ReservationRow, now: Date) {
  if (row.state !== "held" || !row.hold_expires_at || row.hold_duration === null) return null;
  return {
    expires_at: row.hold_expires_at.toISOString(),
    seconds_remaining: Math.max(0, Math.ceil((row.hold_expires_at.getTime() - now.getTime()) / 1000)),
    duration_seconds: row.hold_duration,
  };
}

export function reservationView(row: ReservationRow, now: Date) {
  return {
    id: row.id,
    bench: row.bench,
    tier: tierOf(row.bench),
    state: row.state,
    group_id: row.group_id,
    buyer: { name: buyerName(row), kind: row.buyer_role },
    attendee: row.attendee_name
      ? { name: row.attendee_name, email: row.attendee_email ?? "", accepted: row.attendee_accepted }
      : null,
    price_cents: priceCents(row),
    paid_cents: row.purchased_cents - row.refunded_cents,
    balance_cents: balanceCents(row),
    refund_due_cents: row.refund_due_cents,
    hold: holdView(row, now),
    payment_pending: row.payment_pending,
    licence_status: row.licence_status,
    passport_status: row.passport_key ? "submitted" : "none",
    checked_in: { day1: row.checked_in_day1, day2: row.checked_in_day2 },
    documents: row.documents,
  };
}

