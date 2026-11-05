import pg from "pg";
import { newId } from "./ids.js";
import { query } from "./db.js";
import { PRICES, ATELIER_CAP, type Config } from "./config.js";
import type { Tier, ReservationState, PaymentPending, LicenceStatus } from "./domain.js";
import { tierOfRow } from "./domain.js";

export type PoolClient = pg.PoolClient;

export interface ReservationRow {
  id: string;
  bench: string;
  tier: Tier;
  state: ReservationState;
  group_id: string | null;
  buyer_id: string;
  buyer_name: string;
  buyer_kind: string;
  attendee_name: string | null;
  attendee_email: string | null;
  attendee_accepted: boolean;
  price_cents: number;
  paid_cents: number;
  refund_due_cents: number | null;
  hold_expires_at: Date | null;
  hold_duration_seconds: number | null;
  payment_in_flight: boolean;
  payment_pending: string | null;
  licence_status: LicenceStatus;
  licence_number: string | null;
  licence_state_name: string | null;
  licence_object_key: string | null;
  passport_status: "none" | "submitted";
  passport_full_name: string | null;
  passport_nationality: string | null;
  passport_number: string | null;
  passport_object_key: string | null;
  checked_in_day1: Date | null;
  checked_in_day2: Date | null;
  certificate_number: number | null;
  created_at: Date;
}

const ACTIVE_STATES_SQL = "('held','deposit_paid','paid_in_full','checked_in_day1','checked_in_day2','certificate_issued')";

export async function fetchReservation(id: string): Promise<ReservationRow | null> {
  const { rows } = await query<ReservationRow>(
    `SELECT r.*, a.name AS buyer_name, a.role AS buyer_kind, r.licence_state AS licence_state_name
     FROM reservations r JOIN accounts a ON a.id = r.buyer_id
     WHERE r.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function fetchReservationClient(client: PoolClient, id: string): Promise<ReservationRow | null> {
  const { rows } = await client.query(
    `SELECT r.*, a.name AS buyer_name, a.role AS buyer_kind, r.licence_state AS licence_state_name
     FROM reservations r JOIN accounts a ON a.id = r.buyer_id
     WHERE r.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function fetchDocuments(reservationId: string): Promise<string[]> {
  const { rows } = await query<{ kind: string }>(
    "SELECT kind FROM documents WHERE reservation_id = $1 ORDER BY kind",
    [reservationId]
  );
  return rows.map((r) => r.kind);
}

export function holdObject(r: ReservationRow, at: Date): { expires_at: string; seconds_remaining: number; duration_seconds: number } | null {
  if (r.state !== "held" || !r.hold_expires_at || !r.hold_duration_seconds) return null;
  const remaining = Math.max(0, Math.round((r.hold_expires_at.getTime() - at.getTime()) / 1000));
  return {
    expires_at: r.hold_expires_at.toISOString(),
    seconds_remaining: remaining,
    duration_seconds: r.hold_duration_seconds,
  };
}

export function reservationJson(r: ReservationRow, documents: string[]): Record<string, unknown> {
  const now = new Date();
  return {
    id: r.id,
    bench: r.bench,
    tier: r.tier,
    state: r.state,
    group_id: r.group_id,
    buyer: { name: r.buyer_name, kind: r.buyer_kind },
    attendee: r.attendee_name ? { name: r.attendee_name, email: r.attendee_email, accepted: r.attendee_accepted } : null,
    price_cents: r.price_cents,
    paid_cents: r.paid_cents,
    balance_cents: Math.max(0, r.price_cents - r.paid_cents),
    refund_due_cents: r.refund_due_cents,
    hold: holdObject(r, now),
    payment_pending: r.payment_pending as PaymentPending,
    licence_status: r.licence_status,
    passport_status: r.passport_status,
    checked_in: { day1: r.checked_in_day1 !== null, day2: r.checked_in_day2 !== null },
    documents,
  };
}

export async function reservationWithDocs(r: ReservationRow): Promise<Record<string, unknown>> {
  const docs = await fetchDocuments(r.id);
  return reservationJson(r, docs);
}

/**
 * Inserts a held reservation. Callers hold the ledger lock.
 */
export async function insertHold(
  client: PoolClient,
  cfg: Config,
  account: { id: string; name: string; email: string; role: string },
  bench: string,
  groupId: string | null
): Promise<ReservationRow> {
  const id = newId("res");
  const tier = tierOfRow(bench[0] ?? "C");
  const price = tier === "atelier" ? PRICES.atelier.price : PRICES.bench.price;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + cfg.holdSeconds * 1000);
  const isPractitioner = account.role === "practitioner";
  const { rows } = await client.query(
    `INSERT INTO reservations
       (id, bench, tier, state, group_id, buyer_id, attendee_name, attendee_email, attendee_accepted,
        price_cents, hold_expires_at, hold_duration_seconds)
     VALUES ($1, $2, $3, 'held', $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      id, bench, tier, groupId, account.id,
      isPractitioner ? account.name : null,
      isPractitioner ? account.email : null,
      isPractitioner,
      price, expiresAt, cfg.holdSeconds,
    ]
  );
  return rows[0] as ReservationRow;
}

export async function countAtelierActiveClient(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM (
       SELECT r.bench FROM reservations r JOIN benches b ON b.label = r.bench
       WHERE b.row IN ('A','B') AND r.state IN ${ACTIVE_STATES_SQL}
         AND (r.state <> 'held' OR r.hold_expires_at > now() OR r.payment_in_flight OR r.payment_pending IS NOT NULL)
       UNION ALL
       SELECT w.bench FROM waitlist w JOIN benches b ON b.label = w.bench
       WHERE w.state = 'offered' AND w.offer_expires_at > now() AND b.row IN ('A','B')
     ) t`
  );
  return rows[0]?.count ?? 0;
}
/**
 * Offers a freed bench to the first waitlisted buyer for its tier, under the
 * ledger lock. Returns the offer id when one was made.
 */
export async function offerBenchToWaitlist(
  client: PoolClient,
  bench: string,
  cfg: Config
): Promise<{ offerId: string; accountEmail: string; tier: Tier } | null> {
  const tier = tierOfRow(bench[0] ?? "C");
  if (tier === "atelier") {
    const active = await countAtelierActiveClient(client);
    if (active >= ATELIER_CAP) return null;
  }
  const { rows } = await client.query<{ id: string; email: string }>(
    `UPDATE waitlist SET state = 'offered', bench = $1, offer_expires_at = now() + ($2 || ' seconds')::interval
     WHERE id = (
       SELECT id FROM waitlist WHERE state = 'waitlisted' AND tier = $3
       ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
     )
     RETURNING id, (SELECT email FROM accounts WHERE id = waitlist.account_id) AS email`,
    [bench, String(cfg.offerSeconds), tier]
  );
  if (rows.length === 0) return null;
  return { offerId: rows[0]!.id, accountEmail: rows[0]!.email, tier };
}
