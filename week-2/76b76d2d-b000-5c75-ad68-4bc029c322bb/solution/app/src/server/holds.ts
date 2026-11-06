import { FARES, UPLIFT_PRESETS, type Fare, type Tier } from "../shared/domain.ts";
import { defaultFares, MEMBER_GUEST_ALLOWANCE } from "../shared/fares.ts";
import { config } from "./config.ts";
import { creditBalance } from "./credit.ts";
import { one, query, transaction, type Db } from "./db.ts";
import { ApiError } from "./errors.ts";
import { newHoldId } from "./ids.ts";
import { requireBilling } from "./killbill.ts";
import { activeMembership } from "./membership.ts";
import { priceSeats, type Totals } from "./money.ts";
import { findScreening, liveHold, occupancy, seatCodes, sortSeats, type ScreeningRow } from "./screenings.ts";
import { findSeason, saleOpenings, seasonState } from "./seasons.ts";
import type { Session } from "./sessions.ts";
import { stepupRequired } from "./stepup.ts";
import { isoToronto, torontoDate } from "./time.ts";
import { Fields } from "./validate.ts";

export type Owner = { accountId: number | null; guestId: string | null };

type HoldRow = {
  id: string; screening_id: string; account_id: number | null; guest_id: string | null; seats: string[]; is_group: boolean;
  created_at: Date; expires_at: Date; ended_by: string | null; booking_ref: string | null; quoted_total_cents: number | null; live: boolean;
};

export async function findHold(id: string, now: Date, db?: Db, lock = false): Promise<HoldRow | undefined> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return undefined;
  return one<HoldRow>(`SELECT h.*, ${liveHold("$2")} AS live FROM holds h WHERE h.id = $1${lock ? " FOR UPDATE" : ""}`, [id, now], db);
}

/** A hold that is not the caller's answers exactly like a missing one. */
export async function ownHold(id: string, owner: Owner, now: Date, db?: Db, lock = false): Promise<HoldRow> {
  const hold = await findHold(id, now, db, lock);
  const mine = hold && ((hold.account_id !== null && hold.account_id === owner.accountId) || (hold.guest_id !== null && hold.guest_id === owner.guestId));
  if (!hold || !mine) throw new ApiError("not_found");
  return hold;
}

function holdState(hold: HoldRow): "held" | "expired" | "paid" {
  return hold.booking_ref ? "paid" : hold.live ? "held" : "expired";
}

/** Checkout, quote and release refuse a hold that is paid or no longer live. */
export function requireLiveHold(hold: HoldRow): void {
  const state = holdState(hold);
  if (state === "paid") throw new ApiError("hold_already_paid");
  if (state === "expired") throw new ApiError("hold_expired");
}

export function holdView(hold: HoldRow, now: Date): Record<string, unknown> {
  const state = holdState(hold);
  return {
    id: hold.id, screening_id: hold.screening_id, seats: hold.seats, group: hold.is_group, state,
    ended_by: hold.ended_by ?? (state === "expired" ? "timeout" : null),
    expires_at: isoToronto(hold.expires_at), server_time: isoToronto(now), booking_ref: hold.booking_ref,
  };
}

/** Who may hold seats, by season state and showtime (brief: Who may hold seats). */
async function checkSaleOpen(screening: ScreeningRow, session: Session | null, now: Date, db: Db): Promise<void> {
  const season = await findSeason(screening.season_slug, db);
  if (!season) throw new ApiError("not_found");
  const state = seasonState(season, now);
  if (state === "draft") throw new ApiError("not_found");
  if (state === "archived" || state === "withdrawn" || screening.starts_at <= now) throw new ApiError("screening_closed");
  const { priorityOpensAt, publicOpensAt } = saleOpenings(season.public_sale_date);
  if (state === "scheduled") throw new ApiError("not_on_sale", { date: torontoDate(priorityOpensAt) });
  if (state === "member-priority" && !(session && (await activeMembership(session.account.id, now, db)))) {
    throw new ApiError("members_priority", { date: torontoDate(publicOpensAt) });
  }
}

export async function createHold(body: Record<string, unknown>, session: Session | null, owner: Owner): Promise<HoldRow> {
  const group = body.group === true;
  if (group && !session) throw new ApiError("unauthenticated");
  const fields = new Fields(body);
  const screeningId = fields.text("screening_id", 1, 200);
  fields.done();
  const now = new Date();
  return transaction(async (tx) => {
    const screening = await findScreening(screeningId, tx, true);
    if (!screening) throw new ApiError("not_found");
    await checkSaleOpen(screening, session, now, tx);
    const known = new Set(seatCodes(screening));
    const requested = Array.isArray(body.seats) ? body.seats.filter((seat): seat is string => typeof seat === "string") : [];
    const occupied = (await occupancy([screening.id], now, tx)).get(screening.id);
    const contested = sortSeats([...new Set(requested)].filter((seat) => known.has(seat) && (occupied?.sold.has(seat) || occupied?.held.has(seat))));
    if (contested.length) throw new ApiError("seat_taken", { seats: contested.join(", ") }, { seats: contested });
    const [min, max] = group ? [10, 40] : [1, 10];
    const valid = Array.isArray(body.seats) && requested.length === body.seats.length && new Set(requested).size === requested.length
      && requested.every((seat) => known.has(seat));
    if (!valid || requested.length < min || requested.length > max) {
      fields.add("seats", group ? { kind: "group_seat_count" } : { kind: "seat_count" });
    }
    fields.done();
    requireBilling();
    const id = newHoldId();
    const expiresAt = new Date(now.getTime() + config.holdTtlSeconds * 1000);
    await tx.query(
      "INSERT INTO holds (id, screening_id, account_id, guest_id, seats, is_group, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [id, screening.id, owner.accountId, owner.accountId ? null : owner.guestId, sortSeats(requested), group, now, expiresAt],
    );
    const hold = await findHold(id, now, tx);
    if (!hold) throw new Error("hold vanished");
    return hold;
  });
}

/** The fare rules; a breach is a `fares.<seat>` field error on the first seat past the allowance. */
function resolveFares(fields: Fields, hold: HoldRow, requested: unknown, tier: Tier | null): Fare[] {
  const given = requested !== null && typeof requested === "object" && !Array.isArray(requested) ? (requested as Record<string, unknown>) : {};
  for (const seat of Object.keys(given)) if (!hold.seats.includes(seat)) fields.add(`fares.${seat}`, { kind: "fare" });
  const counts: Record<Fare, number> = { regular: 0, reduced: 0, member: 0, "member-guest": 0, group: 0 };
  const defaults = defaultFares(hold.seats, tier, hold.is_group);
  return hold.seats.map((seat) => {
    const raw = given[seat];
    const fare = raw === undefined ? (defaults[seat] ?? "regular") : (raw as Fare);
    if (!FARES.includes(fare)) {
      fields.add(`fares.${seat}`, { kind: "fare" });
      return "regular";
    }
    counts[fare] += 1;
    const allowed = hold.is_group ? fare === "group"
      : fare === "group" ? false
      : fare === "member" ? tier !== null && counts.member <= 1
      : fare === "member-guest" ? tier !== null && counts["member-guest"] <= MEMBER_GUEST_ALLOWANCE[tier]
      : true;
    if (!allowed) fields.add(`fares.${seat}`, { kind: "fare" });
    return fare;
  });
}

/** Supporter uplift: 0, a preset, or a whole number of cents from 100 to 50000. */
function resolveUplift(fields: Fields, value: unknown): number {
  if (value === undefined || value === null) return 0;
  const ok = typeof value === "number" && Number.isInteger(value) && (value === 0 || (UPLIFT_PRESETS as readonly number[]).includes(value) || (value >= 100 && value <= 50000));
  if (!ok) {
    fields.add("uplift_cents", { kind: "uplift" });
    return 0;
  }
  return value as number;
}

type Priced = Totals & { credit_applied_cents: number; pay_now_cents: number };

export async function priceHold(hold: HoldRow, body: Record<string, unknown>, session: Session | null, now: Date, fields: Fields, db?: Db): Promise<{ fares: Fare[]; priced: Priced }> {
  const membership = session ? await activeMembership(session.account.id, now, db) : null;
  const fares = resolveFares(fields, hold, body.fares, membership?.tier ?? null);
  const uplift = resolveUplift(fields, body.uplift_cents);
  const totals = priceSeats(fares, uplift);
  const balance = await creditBalance(session?.account.number ?? null, db);
  const credit = Math.min(balance, totals.total_cents);
  return { fares, priced: { ...totals, credit_applied_cents: credit, pay_now_cents: totals.total_cents - credit } };
}

export async function quoteHold(id: string, body: Record<string, unknown>, session: Session | null, owner: Owner): Promise<Record<string, unknown>> {
  const now = new Date();
  const hold = await ownHold(id, owner, now);
  requireLiveHold(hold);
  const fields = new Fields(body);
  const { priced } = await priceHold(hold, body, session, now, fields);
  fields.done();
  requireBilling();
  await query("UPDATE holds SET quoted_total_cents = $2 WHERE id = $1", [hold.id, priced.total_cents]);
  return {
    quote: {
      lines: priced.lines, admission_cents: priced.admission_cents, gst_cents: priced.gst_cents, qst_cents: priced.qst_cents,
      uplift_cents: priced.uplift_cents, total_cents: priced.total_cents, credit_applied_cents: priced.credit_applied_cents,
      pay_now_cents: priced.pay_now_cents, currency: "CAD",
      stepup_required: stepupRequired(session, { creditApplied: priced.credit_applied_cents, tierChange: false }, now),
    },
  };
}

export async function releaseHold(id: string, owner: Owner): Promise<Record<string, unknown>> {
  const now = new Date();
  return transaction(async (tx) => {
    const hold = await ownHold(id, owner, now, tx, true);
    requireLiveHold(hold);
    requireBilling();
    await tx.query("UPDATE holds SET ended_by = 'patron' WHERE id = $1", [hold.id]);
    const ended = await findHold(hold.id, now, tx);
    if (!ended) throw new Error("hold vanished");
    return { hold: holdView(ended, now), released_amount: { cents: hold.quoted_total_cents ?? 0, currency: "CAD" } };
  });
}
