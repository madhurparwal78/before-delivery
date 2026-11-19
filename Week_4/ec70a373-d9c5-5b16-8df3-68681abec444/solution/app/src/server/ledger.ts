// The paired hour ledger: two-entry movements, pack hour lots, drawing and return order, and expiry.
import { randomUUID } from "node:crypto";
import { rows, theRow, type Db, type pool } from "./db.ts";
import { daysBetween, wallClock, type IsoDate } from "../shared/time.ts";
import { holdExpired, quartersToHours, type Quarters } from "../shared/rules.ts";
import { transition } from "./transitions.ts";
import type { Account, Actor, Balances, MovementKind } from "../shared/api.ts";

const EXPIRING_SOON_DAYS = 14;

export interface ActorRef {
  userId: string;
  name: string;
  role: Actor["role"];
}

/** Source and destination account of every movement kind. */
const MOVEMENT_ACCOUNTS: Record<MovementKind, [Account, Account]> = {
  opening_balance: ["opening_balance", "available"],
  pack_purchase: ["pack_sales", "available"],
  booking_debit: ["available", "committed"],
  hold_release: ["committed", "available"],
  cancel_refund: ["committed", "available"],
  forfeit: ["committed", "forfeited"],
  usage: ["committed", "used"],
  late_checkout: ["available", "used"],
  pack_expiry: ["available", "expired"],
};

interface LotShare {
  lotId: string;
  quarters: Quarters;
}

interface MovementInput {
  memberId: string;
  kind: MovementKind;
  quarters: Quarters;
  actor: ActorRef | null;
  at: number;
  bookingId?: string;
  purchaseId?: string;
  lots: LotShare[];
}

/** Writes one movement: two entries that sum to zero and, when it touches `available`, its lot shares. */
export async function writeMovement(db: Db, input: MovementInput): Promise<void> {
  const id = randomUUID();
  const [from, to] = MOVEMENT_ACCOUNTS[input.kind];
  await db.query(
    `INSERT INTO movements (id, member_id, kind, booking_id, purchase_id, quarters, actor_id, actor_name, actor_role, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      input.memberId,
      input.kind,
      input.bookingId ?? null,
      input.purchaseId ?? null,
      input.quarters,
      input.actor?.userId ?? null,
      input.actor?.name ?? null,
      input.actor?.role ?? null,
      new Date(input.at),
    ],
  );
  await db.query("INSERT INTO entries (movement_id, position, account, quarters) VALUES ($1, 0, $2, $3), ($1, 1, $4, $5)", [
    id,
    from,
    -input.quarters,
    to,
    input.quarters,
  ]);
  const sign = to === "available" ? 1 : -1;
  for (const [position, share] of input.lots.entries()) {
    await db.query("INSERT INTO movement_lots (movement_id, position, lot_id, delta) VALUES ($1, $2, $3, $4)", [
      id,
      position,
      share.lotId,
      sign * share.quarters,
    ]);
  }
}

interface LotRow {
  id: string;
  purchase_id: string | null;
  pack_name: string;
  valid_through: IsoDate | null;
  remaining: number;
}

/** Every lot of the member with its remainder, in drawing order: earliest valid-through, earlier purchase, opening lot last. */
async function lotsInDrawingOrder(db: Db, memberId: string): Promise<LotRow[]> {
  return rows<LotRow>(
    db,
    `SELECT l.id, l.purchase_id, l.pack_name, l.valid_through, COALESCE(SUM(ml.delta), 0) AS remaining
       FROM lots l LEFT JOIN movement_lots ml ON ml.lot_id = l.id
      WHERE l.member_id = $1
      GROUP BY l.id
      ORDER BY l.valid_through ASC NULLS LAST, l.seq ASC`,
    [memberId],
  );
}

/** Takes `quarters` from the lots in drawing order. The caller has checked the balance covers it. */
export async function drawLots(db: Db, memberId: string, quarters: Quarters): Promise<LotShare[]> {
  const shares: LotShare[] = [];
  let need = quarters;
  for (const lot of await lotsInDrawingOrder(db, memberId)) {
    if (need === 0) break;
    const take = Math.min(lot.remaining, need);
    if (take > 0) shares.push({ lotId: lot.id, quarters: take });
    need -= take;
  }
  return shares;
}

/**
 * Hours going back to `available` for a booking: only into the lots it drew from, up to what it drew
 * from each, latest valid-through first (the opening lot first of all).
 */
export async function returnLots(db: Db, bookingId: string, quarters: Quarters): Promise<LotShare[]> {
  const drawn = await rows<{ lot_id: string; drawn: number }>(
    db,
    `SELECT ml.lot_id, -SUM(ml.delta) AS drawn
       FROM movement_lots ml JOIN movements m ON m.id = ml.movement_id JOIN lots l ON l.id = ml.lot_id
      WHERE m.booking_id = $1 AND m.kind IN ('booking_debit', 'hold_release', 'cancel_refund')
      GROUP BY ml.lot_id, l.valid_through, l.seq
      ORDER BY l.valid_through DESC NULLS FIRST, l.seq DESC`,
    [bookingId],
  );
  const shares: LotShare[] = [];
  let left = quarters;
  for (const lot of drawn) {
    if (left === 0) break;
    const give = Math.min(lot.drawn, left);
    if (give > 0) shares.push({ lotId: lot.lot_id, quarters: give });
    left -= give;
  }
  return shares;
}

export async function homeDate(db: Db, memberId: string, now: number): Promise<IsoDate> {
  const site = await theRow<{ time_zone: string }>(db, "SELECT s.time_zone FROM members m JOIN sites s ON s.id = m.home_site_id WHERE m.id = $1", [memberId]);
  return wallClock(now, site.time_zone).date;
}

/** Moves every expired lot's remainder to `expired`, one `pack_expiry` movement per lot, actor the server. */
export async function expireLots(db: Db, memberId: string, now: number): Promise<void> {
  const today = await homeDate(db, memberId, now);
  for (const lot of await lotsInDrawingOrder(db, memberId)) {
    if (lot.valid_through === null || lot.valid_through >= today || lot.remaining <= 0) continue;
    await writeMovement(db, {
      memberId,
      kind: "pack_expiry",
      quarters: lot.remaining,
      actor: null,
      at: now,
      purchaseId: lot.purchase_id ?? undefined,
      lots: [{ lotId: lot.id, quarters: lot.remaining }],
    });
  }
}

/**
 * Brings one member's ledger up to the server clock: holds past their expiry become `expired` and
 * return their hours, then expired lots leave. Runs under the member's row lock.
 */
async function settleMember(db: Db, memberId: string, now: number): Promise<void> {
  const held = await rows<{ id: string; quarters: number; hold_expires_at: Date }>(
    db,
    "SELECT id, quarters, hold_expires_at FROM bookings WHERE member_id = $1 AND status = 'held' ORDER BY seq",
    [memberId],
  );
  for (const hold of held.filter((h) => holdExpired(h.hold_expires_at.getTime(), now))) {
    await db.query("UPDATE bookings SET status = $2 WHERE id = $1", [hold.id, transition("expire", "held")]);
    await writeMovement(db, {
      memberId,
      kind: "hold_release",
      quarters: hold.quarters,
      actor: null,
      at: now,
      bookingId: hold.id,
      lots: await returnLots(db, hold.id, hold.quarters),
    });
  }
  await expireLots(db, memberId, now);
}

/**
 * Members who may have something to settle: a held booking or a dated lot with hours. `settleMember`
 * makes the actual decision under the member's lock.
 */
/** Members with a hold past its expiry on one station, or at one site on one date, not yet settled. */
export async function membersWithExpiredHolds(db: Db | typeof pool, where: { stationId: string } | { siteId: string }, now: number): Promise<string[]> {
  const held = await rows<{ member_id: string; hold_expires_at: Date }>(
    db,
    `SELECT member_id, hold_expires_at FROM bookings WHERE status = 'held' AND ${"stationId" in where ? "station_id" : "site_id"} = $1`,
    ["stationId" in where ? where.stationId : where.siteId],
  );
  return [...new Set(held.filter((h) => holdExpired(h.hold_expires_at.getTime(), now)).map((h) => h.member_id))];
}

export async function membersToSettle(db: Db | typeof pool): Promise<string[]> {
  const list = await rows<{ member_id: string }>(
    db,
    `SELECT member_id FROM bookings WHERE status = 'held'
     UNION
     SELECT l.member_id FROM lots l JOIN movement_lots ml ON ml.lot_id = l.id
      WHERE l.valid_through IS NOT NULL GROUP BY l.id, l.member_id HAVING SUM(ml.delta) > 0`,
  );
  return list.map((m) => m.member_id);
}

/** Locks the member's row so their requests are decided one at a time, then settles their ledger. */
export async function lockMember(db: Db, memberId: string, now: number): Promise<void> {
  await db.query("SELECT 1 FROM members WHERE id = $1 FOR UPDATE", [memberId]);
  await settleMember(db, memberId, now);
}

/** The live holds a member has at `now`. */
export async function liveHoldCount(db: Db, memberId: string, now: number): Promise<number> {
  const held = await rows<{ hold_expires_at: Date }>(db, "SELECT hold_expires_at FROM bookings WHERE member_id = $1 AND status = 'held'", [memberId]);
  return held.filter((h) => !holdExpired(h.hold_expires_at.getTime(), now)).length;
}

/** The sweep's settle: a member whose row is locked by a request is left to that request and the next sweep. */
export async function settleIfFree(db: Db, memberId: string, now: number): Promise<void> {
  const free = await db.query("SELECT 1 FROM members WHERE id = $1 FOR UPDATE SKIP LOCKED", [memberId]);
  if (free.rowCount) await settleMember(db, memberId, now);
}

export async function availableQuarters(db: Db, memberId: string): Promise<Quarters> {
  const row = await theRow<{ q: number | null }>(
    db,
    `SELECT SUM(e.quarters) AS q FROM entries e JOIN movements m ON m.id = e.movement_id
      WHERE m.member_id = $1 AND e.account = 'available'`,
    [memberId],
  );
  return row.q ?? 0;
}

/**
 * The expiring-soon verdict: `valid_through` minus the home site's current date is 0 to 14 days.
 * The opening lot has no valid-through date and is never expiring soon.
 */
function expiringSoon(validThrough: IsoDate | null, homeToday: IsoDate): boolean {
  if (validThrough === null) return false;
  const left = daysBetween(homeToday, validThrough);
  return left >= 0 && left <= EXPIRING_SOON_DAYS;
}

export async function balances(db: Db, memberId: string, now: number): Promise<Balances> {
  const today = await homeDate(db, memberId, now);
  const sums = await rows<{ account: Account; q: number }>(
    db,
    `SELECT e.account, SUM(e.quarters) AS q FROM entries e JOIN movements m ON m.id = e.movement_id
      WHERE m.member_id = $1 AND e.account IN ('available', 'committed') GROUP BY e.account`,
    [memberId],
  );
  const total = (account: Account): Quarters => sums.find((s) => s.account === account)?.q ?? 0;
  const lots = (await lotsInDrawingOrder(db, memberId)).filter((lot) => lot.remaining > 0);
  return {
    available_hours: quartersToHours(total("available")),
    committed_hours: quartersToHours(total("committed")),
    lots: lots.map((lot) => ({
      purchase_id: lot.purchase_id,
      pack_name: lot.pack_name,
      hours: quartersToHours(lot.remaining),
      valid_through: lot.valid_through,
      expiring_soon: expiringSoon(lot.valid_through, today),
    })),
  };
}
