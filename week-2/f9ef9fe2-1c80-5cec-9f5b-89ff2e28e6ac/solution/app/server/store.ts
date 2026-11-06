import { type Client, pool } from "./db.js";
import {
  type BookingRow,
  type Cell,
  type DocumentRow,
  type HoldRow,
  type InvoiceRow,
  type Kitchen,
  type Member,
  OCCUPYING_STATES,
  type RateCard,
  type Station,
  TIER_COUNTING_STATES,
  type User,
} from "./domain.js";
import { refuse } from "./errors.js";
import { kitchenDate, minutesOf } from "./kitchenTime.js";
import { holdState } from "./rules.js";

// Reads shared by the endpoint modules, every one scoped so a record of another kitchen or of
// another member answers not_found.

export type Queryable = Client | typeof pool;

export async function loadKitchen(id: string, db: Queryable = pool): Promise<Kitchen> {
  const found = await db.query<Kitchen>("SELECT id, name, timezone, same_day_cutoff FROM kitchens WHERE id = $1", [id]);
  const kitchen = found.rows[0];
  if (!kitchen) throw refuse.notFound();
  return kitchen;
}

/** The user's own kitchen; any other kitchen id is not found. */
export async function userKitchen(user: User, kitchenId: string = user.kitchen_id): Promise<Kitchen> {
  if (kitchenId !== user.kitchen_id) throw refuse.notFound();
  return loadKitchen(kitchenId);
}

export async function loadStations(kitchenId: string, db: Queryable = pool): Promise<Station[]> {
  const found = await db.query<Station>(
    `SELECT id, name, kind, loom_order AS "order" FROM stations WHERE kitchen_id = $1 ORDER BY loom_order`,
    [kitchenId],
  );
  return found.rows;
}

/** A member of the user's kitchen; members may only reach themselves. */
export async function memberFor(user: User, memberId: string, db: Queryable = pool): Promise<Member> {
  const found = await db.query<Member>(
    "SELECT id, kitchen_id, business, contact_email, killbill_account_id FROM members WHERE id = $1 AND kitchen_id = $2",
    [memberId, user.kitchen_id],
  );
  const member = found.rows[0];
  if (!member || (user.role === "member" && user.member_id !== member.id)) throw refuse.notFound();
  return member;
}

export async function kitchenMembers(kitchenId: string): Promise<Member[]> {
  const found = await pool.query<Member>(
    "SELECT id, kitchen_id, business, contact_email, killbill_account_id FROM members WHERE kitchen_id = $1 ORDER BY business",
    [kitchenId],
  );
  return found.rows;
}

export async function rateCards(kitchenId: string, db: Queryable = pool): Promise<RateCard[]> {
  const found = await db.query<RateCard>(
    `SELECT id, kitchen_id, effective_from, tier_rates_cents, station_surcharges_cents, cancellation_window_hours,
            pack_price_cents, created_at
       FROM rate_cards WHERE kitchen_id = $1 ORDER BY effective_from DESC`,
    [kitchenId],
  );
  return found.rows;
}

/** The card with the latest effective_from on or before today. */
export async function cardInForce(kitchen: Kitchen, now: Date, db: Queryable = pool): Promise<RateCard> {
  const today = kitchenDate(kitchen.timezone, now);
  const card = (await rateCards(kitchen.id, db)).find((c) => c.effective_from <= today);
  if (!card) throw new Error(`No rate card in force for ${kitchen.id}`);
  return card;
}

export async function memberDocuments(memberId: string, db: Queryable = pool): Promise<DocumentRow[]> {
  const found = await db.query<DocumentRow>(
    `SELECT id, kitchen_id, member_id, type, state, expires_on, original_name, size_bytes, content_type, uploaded_at,
            reject_reason, file_stored
       FROM documents WHERE member_id = $1 ORDER BY uploaded_at`,
    [memberId],
  );
  return found.rows;
}

export async function packBalance(memberId: string, db: Queryable = pool): Promise<number> {
  const found = await db.query<{ balance: number }>(
    `SELECT coalesce(sum(e.quarters), 0)::int AS balance
       FROM entries e JOIN movements m ON m.id = e.movement_id
      WHERE m.member_id = $1 AND e.account = 'member_pack'`,
    [memberId],
  );
  return found.rows[0]?.balance ?? 0;
}

/** `use_pack` with a balance of zero is a validation error on use_pack (brief: Prepaid pack ledger). */
export async function checkPackHours(memberId: string, usePack: boolean, errors: Record<string, string>, db: Queryable): Promise<void> {
  if (usePack && (await packBalance(memberId, db)) === 0) errors.use_pack = "No pack hours left.";
}

/** Month-to-date quarters: bookings in tier-counting states dated in the kitchen month. */
export async function monthQuarters(memberId: string, month: string, db: Queryable = pool): Promise<number> {
  const found = await db.query<{ quarters: number }>(
    `SELECT coalesce(sum(quarters), 0)::int AS quarters FROM bookings
      WHERE member_id = $1 AND to_char(date, 'YYYY-MM') = $2 AND state = ANY($3)`,
    [memberId, month, TIER_COUNTING_STATES],
  );
  return found.rows[0]?.quarters ?? 0;
}

const HOLD_COLUMNS = "id, kitchen_id, member_id, date, cells, state, created_at, expires_at";
export const BOOKING_COLUMNS = `id, ref, kitchen_id, member_id, hold_id, series_id, date, state, cells, starts_at, ends_at,
  quarters, lines, pack_quarters, total_cents, rate_card_id, cancellation_window_hours, confirmed_at, invoice_id,
  refund_cents, cancelled_at`;
export const INVOICE_COLUMNS =
  "id, ref, kitchen_id, member_id, kind, booking_ids, lines, total_cents, killbill_invoice_id, issued_at";

export async function holdFor(user: User, holdId: string, db: Queryable = pool, lock = false): Promise<HoldRow> {
  const found = await db.query<HoldRow>(
    `SELECT ${HOLD_COLUMNS} FROM holds WHERE id = $1 AND kitchen_id = $2${lock ? " FOR UPDATE" : ""}`,
    [holdId, user.kitchen_id],
  );
  const hold = found.rows[0];
  if (!hold || (user.role === "member" && hold.member_id !== user.member_id)) throw refuse.notFound();
  return hold;
}

export async function bookingFor(user: User, bookingId: string, db: Queryable = pool, lock = false): Promise<BookingRow> {
  const found = await db.query<BookingRow>(
    `SELECT ${BOOKING_COLUMNS} FROM bookings WHERE id = $1 AND kitchen_id = $2${lock ? " FOR UPDATE" : ""}`,
    [bookingId, user.kitchen_id],
  );
  const booking = found.rows[0];
  if (!booking || (user.role === "member" && booking.member_id !== user.member_id)) throw refuse.notFound();
  return booking;
}

export async function invoiceFor(user: User, invoiceId: string): Promise<InvoiceRow> {
  const found = await pool.query<InvoiceRow>(`SELECT ${INVOICE_COLUMNS} FROM invoices WHERE id = $1 AND kitchen_id = $2`, [
    invoiceId,
    user.kitchen_id,
  ]);
  const invoice = found.rows[0];
  if (!invoice || (user.role === "member" && invoice.member_id !== user.member_id)) throw refuse.notFound();
  return invoice;
}

interface Occupant {
  cell: Cell;
  member_id: string;
  hold_id: string | null;
  booking_id: string | null;
  expires_at: Date | null;
}

/** Every taken cell on one kitchen date: live holds and bookings in occupying states. */
export async function occupants(kitchenId: string, date: string, now: Date, db: Queryable = pool): Promise<Occupant[]> {
  const holds = await db.query<HoldRow>(`SELECT ${HOLD_COLUMNS} FROM holds WHERE kitchen_id = $1 AND date = $2 AND state = 'held'`, [
    kitchenId,
    date,
  ]);
  const bookings = await db.query<BookingRow>(
    `SELECT ${BOOKING_COLUMNS} FROM bookings WHERE kitchen_id = $1 AND date = $2 AND state = ANY($3)`,
    [kitchenId, date, OCCUPYING_STATES],
  );
  const found: Occupant[] = [];
  for (const hold of holds.rows) {
    if (holdState(hold, now) !== "held") continue;
    for (const cell of hold.cells) {
      found.push({ cell, member_id: hold.member_id, hold_id: hold.id, booking_id: null, expires_at: hold.expires_at });
    }
  }
  for (const booking of bookings.rows) {
    for (const cell of booking.cells) {
      found.push({ cell, member_id: booking.member_id, hold_id: null, booking_id: booking.id, expires_at: null });
    }
  }
  return found;
}

export const cellKey = (cell: Cell): string => `${cell.station_id}@${cell.start}`;

export function sortCells(cells: Cell[], stations: Station[]): Cell[] {
  const order = new Map(stations.map((s) => [s.id, s.order]));
  return [...cells].sort(
    (a, b) => (order.get(a.station_id) ?? 0) - (order.get(b.station_id) ?? 0) || minutesOf(a.start) - minutesOf(b.start),
  );
}

