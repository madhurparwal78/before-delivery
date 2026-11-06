import { Pool, type PoolClient } from "pg";
import { addDays, kitchenDate, kitchenTime, monthOf } from "./kitchenTime";
import { type Cell, type Line, type RateCard, type Station, cellFromQuarter } from "./domain";
import { formatHours } from "./domain";

export type Db = Pool | PoolClient;

export interface KitchenRow {
  id: string;
  name: string;
  timezone: string;
  same_day_cutoff: string;
  hold_seconds: number;
}

export interface UserRow {
  id: string;
  kitchen_id: string;
  member_id: string | null;
  name: string;
  email: string;
  password_hash: string;
  role: "operator" | "member" | "bookkeeper";
}

export interface MemberRow {
  id: string;
  kitchen_id: string;
  business: string;
  contact_email: string;
}

export interface BookingRow {
  id: string;
  ref: string;
  kitchen_id: string;
  member_id: string;
  series_id: string | null;
  date: string;
  state: string;
  rate_card_id: string;
  cancellation_window_hours: number;
  total_cents: number;
  pack_quarters: number;
  quarters: number;
  lines: Line[];
  starts_at: Date;
  ends_at: Date;
  confirmed_at: Date;
  cancelled_at: Date | null;
  invoice_id: string | null;
  created_at: Date;
}

export interface HoldRow {
  id: string;
  kitchen_id: string;
  member_id: string;
  date: string;
  state: "held" | "released" | "confirmed" | "expired";
  expires_at: Date;
  created_at: Date;
}

export interface DocumentRow {
  id: string;
  kitchen_id: string;
  member_id: string;
  type: "insurance" | "food_handler" | "kitchen_agreement";
  state: "uploaded" | "verified" | "rejected";
  expires_on: string | null;
  original_name: string;
  size_bytes: number;
  content_type: string;
  storage_key: string | null;
  reject_reason: string | null;
  uploaded_at: Date;
  verified_at: Date | null;
  reminded_at: Date | null;
}

export interface MovementRow {
  id: string;
  member_id: string;
  kind: "purchase" | "draw" | "refund";
  quarters: number;
  booking_id: string | null;
  reverses: string | null;
  invoice_id: string | null;
  created_at: Date;
  entries: Array<{ account: string; quarters: number }>;
}

export interface InvoiceRow {
  id: string;
  ref: string;
  kitchen_id: string;
  member_id: string;
  kind: "booking" | "series" | "pack";
  booking_ids: string[];
  lines: Array<Line | { description: string; amount_cents: number }>;
  total_cents: number;
  killbill_invoice_id: string | null;
  issued_at: Date;
}

export async function getKitchen(db: Db, id: string): Promise<KitchenRow | null> {
  const result = await db.query("SELECT id, name, timezone, same_day_cutoff, hold_seconds FROM kitchens WHERE id = $1", [id]);
  return result.rows[0] ? (result.rows[0] as unknown as KitchenRow) : null;
}

export async function getStations(db: Db, kitchenId: string): Promise<Station[]> {
  const result = await db.query(
    "SELECT id, kitchen_id, name, kind::text AS kind, loom_order FROM stations WHERE kitchen_id = $1 ORDER BY loom_order",
    [kitchenId]
  );
  return result.rows.map(
    (row) =>
      ({
        id: row.id,
        kitchen_id: row.kitchen_id,
        name: row.name,
        kind: row.kind,
        loom_order: row.loom_order,
      }) as Station
  );
}

export async function getRateCardInForce(db: Db, kitchenId: string, today: string): Promise<RateCard | null> {
  const result = await db.query(
    `SELECT id, kitchen_id, effective_from::text AS effective_from, tier_rates_cents, station_surcharges_cents,
       cancellation_window_hours, pack_price_cents, created_at
     FROM rate_cards WHERE kitchen_id = $1 AND effective_from <= $2 ORDER BY effective_from DESC LIMIT 1`,
    [kitchenId, today]
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    kitchen_id: row.kitchen_id,
    effective_from: row.effective_from,
    tier_rates_cents: row.tier_rates_cents,
    station_surcharges_cents: row.station_surcharges_cents,
    cancellation_window_hours: row.cancellation_window_hours,
    pack_price_cents: row.pack_price_cents,
    created_at: row.created_at,
  };
}

export async function getRateCards(db: Db, kitchenId: string): Promise<RateCard[]> {
  const result = await db.query(
    `SELECT id, kitchen_id, effective_from::text AS effective_from, tier_rates_cents, station_surcharges_cents,
       cancellation_window_hours, pack_price_cents, created_at
     FROM rate_cards WHERE kitchen_id = $1 ORDER BY effective_from DESC`,
    [kitchenId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    kitchen_id: row.kitchen_id,
    effective_from: row.effective_from,
    tier_rates_cents: row.tier_rates_cents,
    station_surcharges_cents: row.station_surcharges_cents,
    cancellation_window_hours: row.cancellation_window_hours,
    pack_price_cents: row.pack_price_cents,
    created_at: row.created_at,
  }));
}

export async function getUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  const result = await db.query(
    `SELECT id, kitchen_id, member_id, name, email, password_hash, role::text AS role FROM users WHERE lower(email) = lower($1)`,
    [email]
  );
  return result.rows[0] ? (result.rows[0] as unknown as UserRow) : null;
}

export async function getUserById(db: Db, id: string): Promise<UserRow | null> {
  const result = await db.query(`SELECT id, kitchen_id, member_id, name, email, password_hash, role::text AS role FROM users WHERE id = $1`, [id]);
  return result.rows[0] ? (result.rows[0] as unknown as UserRow) : null;
}

export async function getMember(db: Db, id: string): Promise<MemberRow | null> {
  const result = await db.query("SELECT id, kitchen_id, business, contact_email FROM members WHERE id = $1", [id]);
  return result.rows[0] ? (result.rows[0] as unknown as MemberRow) : null;
}

export async function getMembers(db: Db, kitchenId: string): Promise<MemberRow[]> {
  const result = await db.query("SELECT id, kitchen_id, business, contact_email FROM members WHERE kitchen_id = $1 ORDER BY business", [kitchenId]);
  return result.rows as unknown as MemberRow[];
}

export async function getHold(db: Db, id: string): Promise<HoldRow | null> {
  const result = await db.query(
    `SELECT id, kitchen_id, member_id, date::text AS date, state::text AS state, expires_at, created_at FROM holds WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? (result.rows[0] as unknown as HoldRow) : null;
}

export async function getHoldCells(db: Db, holdId: string): Promise<Cell[]> {
  const result = await db.query("SELECT station_id, start_q FROM hold_cells WHERE hold_id = $1 ORDER BY start_q, station_id", [holdId]);
  return result.rows.map((row) => cellFromQuarter(row.station_id, row.start_q));
}

export async function getBooking(db: Db, id: string): Promise<BookingRow | null> {
  const result = await db.query(
    `SELECT id, ref, kitchen_id, member_id, series_id, date::text AS date, state::text AS state, rate_card_id,
       cancellation_window_hours, total_cents, pack_quarters, quarters, lines, starts_at, ends_at, confirmed_at,
       cancelled_at, invoice_id, created_at
     FROM bookings WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? (result.rows[0] as unknown as BookingRow) : null;
}

export async function getBookingCells(db: Db, bookingId: string): Promise<Cell[]> {
  const result = await db.query("SELECT station_id, start_q FROM booking_cells WHERE booking_id = $1 ORDER BY start_q, station_id", [bookingId]);
  return result.rows.map((row) => cellFromQuarter(row.station_id, row.start_q));
}

export async function getMovements(db: Db, memberId: string): Promise<MovementRow[]> {
  const result = await db.query(
    `SELECT m.id, m.member_id, m.kind::text AS kind, m.quarters, m.booking_id, m.reverses, m.invoice_id, m.created_at,
       (SELECT json_agg(e ORDER BY e.id) FROM movement_entries e WHERE e.movement_id = m.id) AS entries
     FROM movements m WHERE m.member_id = $1 ORDER BY m.created_at, m.id`,
    [memberId]
  );
  return result.rows as unknown as MovementRow[];
}

export async function getDrawsForBooking(db: Db, bookingId: string): Promise<MovementRow[]> {
  const result = await db.query(
    `SELECT m.id, m.member_id, m.kind::text AS kind, m.quarters, m.booking_id, m.reverses, m.invoice_id, m.created_at,
       (SELECT json_agg(e ORDER BY e.id) FROM movement_entries e WHERE e.movement_id = m.id) AS entries
     FROM movements m WHERE m.booking_id = $1 AND m.kind = 'draw' AND m.reverses IS NULL
       AND NOT EXISTS (SELECT 1 FROM movements r WHERE r.reverses = m.id)`,
    [bookingId]
  );
  return result.rows as unknown as MovementRow[];
}

export async function packBalance(db: Db, memberId: string): Promise<number> {
  const result = await db.query(
    `SELECT COALESCE(SUM(e.quarters), 0) AS balance FROM movement_entries e
     JOIN movements m ON m.id = e.movement_id WHERE m.member_id = $1 AND e.account = 'member_pack'`,
    [memberId]
  );
  return Number.parseInt(result.rows[0]!.balance, 10);
}

export async function getInvoice(db: Db, id: string): Promise<InvoiceRow | null> {
  const result = await db.query(
    `SELECT id, ref, kitchen_id, member_id, kind::text AS kind, booking_ids, lines, total_cents, killbill_invoice_id, issued_at
     FROM invoices WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? (result.rows[0] as unknown as InvoiceRow) : null;
}

export async function monthToDateQuarters(db: Db, memberId: string, month: string): Promise<number> {
  const first = `${month}-01`;
  const monthEnd = previousDay(month);
  const result = await db.query(
    `SELECT COALESCE(SUM(quarters), 0) AS q FROM bookings
     WHERE member_id = $1 AND date >= $2 AND date <= $3
       AND state IN ('confirmed','checked_in','completed','cancelled_late','no_show')`,
    [memberId, first, monthEnd]
  );
  return Number.parseInt(result.rows[0]!.q, 10);
}

function previousDay(month: string): string {
  // Last day of the month named `YYYY-MM`.
  const y = Number.parseInt(month.slice(0, 4), 10);
  const m = Number.parseInt(month.slice(5, 7), 10);
  const last = new Date(Date.UTC(y, m, 0));
  return `${month}-${String(last.getUTCDate()).padStart(2, "0")}`;
}

export interface OccupiedCell {
  kind: "held" | "booked";
  refId: string;
  memberId: string;
  business: string;
  expiresAt: Date | null;
  stationId: string;
  startQ: number;
}

export async function occupiedCells(db: Db, kitchenId: string, date: string, excludeHoldsOf: string | null = null): Promise<OccupiedCell[]> {
  const result = await db.query(
    `SELECT 'held' AS kind, h.id AS ref_id, h.member_id, m.business, h.expires_at, c.station_id, c.start_q
     FROM hold_cells c
     JOIN holds h ON h.id = c.hold_id
     JOIN members m ON m.id = h.member_id
     WHERE c.kitchen_id = $1 AND c.date = $2 AND h.state = 'held' AND h.expires_at > now()
       AND ($3::text IS NULL OR h.member_id != $3)
     UNION ALL
     SELECT 'booked' AS kind, b.id AS ref_id, b.member_id, m.business, NULL::timestamptz AS expires_at, c.station_id, c.start_q
     FROM booking_cells c
     JOIN bookings b ON b.id = c.booking_id
     JOIN members m ON m.id = b.member_id
     WHERE c.kitchen_id = $1 AND c.date = $2 AND b.state IN ('confirmed','checked_in','completed','no_show')
     ORDER BY start_q, station_id`,
    [kitchenId, date, excludeHoldsOf]
  );
  return result.rows.map((row) => ({
    kind: row.kind,
    refId: row.ref_id,
    memberId: row.member_id,
    business: row.business,
    expiresAt: row.expires_at,
    stationId: row.station_id,
    startQ: row.start_q,
  }));
}

export function takenCellsOf(cells: Cell[], occupied: OccupiedCell[]): Cell[] {
  const takenKeys = new Set(occupied.map((o) => `${o.stationId}|${o.startQ}`));
  return cells.filter((cell) => {
    const q = (Number.parseInt(cell.start.slice(0, 2), 10) * 60 + Number.parseInt(cell.start.slice(3, 5), 10) - 240) / 15;
    return takenKeys.has(`${cell.station_id}|${q}`);
  });
}

export async function coveredUntil(db: Db, memberId: string, today: string): Promise<string | null> {
  const result = await db.query(
    `SELECT
       (SELECT MAX(expires_on)::text FROM documents WHERE member_id = $1 AND type = 'insurance' AND state = 'verified' AND expires_on IS NOT NULL AND expires_on >= $2) AS insurance,
       (SELECT MAX(expires_on)::text FROM documents WHERE member_id = $1 AND type = 'food_handler' AND state = 'verified' AND expires_on IS NOT NULL AND expires_on >= $2) AS food`,
    [memberId, today]
  );
  const row = result.rows[0];
  const insurance: string | null = row?.insurance ?? null;
  const food: string | null = row?.food ?? null;
  if (!insurance || !food) {
    return null;
  }
  return insurance < food ? insurance : food;
}

export async function getDocument(db: Db, id: string): Promise<DocumentRow | null> {
  const result = await db.query(
    `SELECT id, kitchen_id, member_id, type::text AS type, state::text AS state, expires_on::text AS expires_on,
       original_name, size_bytes, content_type, storage_key, reject_reason, uploaded_at, verified_at, reminded_at
     FROM documents WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? (result.rows[0] as unknown as DocumentRow) : null;
}

export async function getDocumentsFor(db: Db, kitchenId: string, memberId: string | null): Promise<DocumentRow[]> {
  const params: unknown[] = [kitchenId];
  let where = "kitchen_id = $1";
  if (memberId !== null) {
    params.push(memberId);
    where += " AND member_id = $2";
  }
  const result = await db.query(
    `SELECT id, kitchen_id, member_id, type::text AS type, state::text AS state, expires_on::text AS expires_on,
       original_name, size_bytes, content_type, storage_key, reject_reason, uploaded_at, verified_at, reminded_at
     FROM documents WHERE ${where} ORDER BY uploaded_at, id`,
    params
  );
  return result.rows as unknown as DocumentRow[];
}

/**
 * Ref counters live in a row that the transaction locks, so a rolled-back
 * attempt never burns a number.
 */
export async function nextBookingRef(db: Db): Promise<{ ref: string; id: string }> {
  const result = await db.query("UPDATE counters SET value = value + 1 WHERE name = 'booking_ref' RETURNING value");
  const n = Number.parseInt(result.rows[0]!.value, 10);
  return { ref: `PL-${String(n).padStart(6, "0")}`, id: `bk-${String(n).padStart(6, "0")}` };
}

export async function nextInvoiceRef(db: Db): Promise<{ ref: string; id: string }> {
  const result = await db.query("UPDATE counters SET value = value + 1 WHERE name = 'invoice_ref' RETURNING value");
  const n = Number.parseInt(result.rows[0]!.value, 10);
  return { ref: `INV-${String(n).padStart(6, "0")}`, id: `inv-${String(n).padStart(6, "0")}` };
}

export async function nextMovementId(db: Db): Promise<string> {
  const result = await db.query("UPDATE counters SET value = value + 1 WHERE name = 'movement_ref' RETURNING value");
  const n = Number.parseInt(result.rows[0]!.value, 10);
  return `mov-${String(n).padStart(6, "0")}`;
}

export async function insertAudit(
  db: Db,
  entity: string,
  entityId: string,
  fromState: string | null,
  toState: string,
  actor: string
): Promise<void> {
  await db.query("INSERT INTO audit (entity, entity_id, from_state, to_state, actor, at) VALUES ($1, $2, $3, $4, $5, now())", [
    entity,
    entityId,
    fromState,
    toState,
    actor,
  ]);
}

export async function lockMember(tx: PoolClient, memberId: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`member|${memberId}`]);
}

export function documentReadState(doc: DocumentRow, kitchen: KitchenRow, now: Date): "uploaded" | "verified" | "rejected" | "expiring" | "expired" {
  if (doc.state !== "verified" || doc.type === "kitchen_agreement" || doc.expires_on === null) {
    return doc.state;
  }
  const today = kitchenDate(now, kitchen.timezone);
  if (today > doc.expires_on) {
    return "expired";
  }
  if (addDays(doc.expires_on, -14) <= today) {
    return "expiring";
  }
  return "verified";
}

export function hoursBetweenQuarters(q: number): string {
  return formatHours(q);
}

export function wallTime(date: Date, timezone: string): string {
  return kitchenTime(date, timezone);
}

export function currentMonth(today: string): string {
  return monthOf(today);
}
