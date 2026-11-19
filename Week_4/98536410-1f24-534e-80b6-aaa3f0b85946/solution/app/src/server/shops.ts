// Shops: the shop object, its display state, opening hours, day plans, slots and availability.
import { one, pool, query, transaction } from "./db.js";
import { FieldErrors, forbidden, notFound, validationFailed } from "./errors.js";
import {
  PUBLISH_HORIZON_DAYS, SLOT_CAPACITY, dayOn, dayPlanTimes, hasUpcoming, inOfferWindow, isCalendarDate, localToday, offerDates,
  parseDays, planDaysFor, slotObject, slotsOn, upcomingDue,
} from "./hours.js";
import { byCodePoint } from "./json.js";
import { CRITICAL_ON_HAND } from "./stock.js";
import { matchesLiterally } from "./search.js";
import type { DayHours } from "./seedData.js";
import type { SessionUser } from "./auth.js";
import { addDays, clockOf, localMoment, minutesOf } from "./time.js";

export const DISPLAY_STATES = ["open", "closing_soon", "closed", "stock_critical", "suspended"] as const;
export type DisplayState = (typeof DISPLAY_STATES)[number];

const STATE_LABELS: Record<DisplayState, string> = {
  open: "Open", closing_soon: "Closing soon", closed: "Closed", stock_critical: "Stock critical", suspended: "Suspended",
};

const CLOSING_SOON_MINUTES = 30;

interface ShopRow {
  id: string;
  operator_id: string;
  name: string;
  city: string;
  region: string;
  lat: number;
  lon: number;
  timezone: string;
  vat_rate: number;
  suspended: boolean;
  suspension_reason: string | null;
  hours: DayHours[];
  upcoming_from: string | null;
  upcoming_hours: DayHours[] | null;
  critical_lines: number;
}

const SHOP_COLUMNS = `s.id, s.operator_id, s.name, s.city, s.region, s.lat, s.lon, s.timezone, s.vat_rate, s.suspended,
  s.suspension_reason, s.hours, s.upcoming_from::text AS upcoming_from, s.upcoming_hours,
  (SELECT count(*) FROM stock k WHERE k.store_id = s.id AND k.on_hand <= ${CRITICAL_ON_HAND})::int AS critical_lines`;

export async function loadShops(db: Pick<typeof pool, "query">, operatorId: string): Promise<ShopRow[]> {
  const rows = await query<ShopRow>(db, `SELECT ${SHOP_COLUMNS} FROM shops s WHERE s.operator_id = $1`, [operatorId]);
  return rows.sort((a, b) => byCodePoint(a.id, b.id));
}

/** The shop, or null when it does not exist or belongs to another operator. */
async function loadShop(db: Pick<typeof pool, "query">, user: Pick<SessionUser, "operatorId">, id: unknown): Promise<ShopRow | null> {
  if (typeof id !== "string") return null;
  return one<ShopRow>(db, `SELECT ${SHOP_COLUMNS} FROM shops s WHERE s.id = $1 AND s.operator_id = $2`, [id, user.operatorId]);
}

export async function requireShop(db: Pick<typeof pool, "query">, user: Pick<SessionUser, "operatorId">, id: unknown): Promise<ShopRow> {
  const shop = await loadShop(db, user, id);
  if (!shop) throw notFound();
  return shop;
}

/** The one place a shop's display state is decided, in the shop's own timezone and with the stated precedence. */
export function displayStateOf(shop: ShopRow, now: Date): DisplayState {
  if (shop.suspended) return "suspended";
  if (shop.critical_lines > 0) return "stock_critical";
  const moment = localMoment(shop.timezone, now.getTime());
  const day = dayOn(shop, moment.date, moment.date);
  if (!day || !day.open || day.opens === null || day.closes === null) return "closed";
  const closes = minutesOf(day.closes);
  if (moment.minutes >= minutesOf(day.opens) && moment.minutes < closes) {
    return moment.minutes >= closes - CLOSING_SOON_MINUTES ? "closing_soon" : "open";
  }
  return "closed";
}

export function shopObject(shop: ShopRow, now: Date) {
  const state = displayStateOf(shop, now);
  const today = localToday(shop.timezone, now);
  const day = dayOn(shop, today, today);
  return {
    id: shop.id, name: shop.name, city: shop.city, region: shop.region, lat: shop.lat, lon: shop.lon,
    timezone: shop.timezone, vat_rate: shop.vat_rate, display_state: state, state_label: STATE_LABELS[state],
    suspended: shop.suspended, suspension_reason: shop.suspension_reason,
    closes_local: day?.open ? day.closes : null, critical_lines: shop.critical_lines,
  };
}

export function isDisplayState(value: string): value is DisplayState {
  return DISPLAY_STATES.some((state) => state === value);
}

export async function listShops(user: SessionUser, term: string, states: DisplayState[] | null, now: Date) {
  const shops = (await loadShops(pool, user.operatorId))
    .filter((shop) => matchesLiterally(term, [shop.name, shop.id, shop.city]))
    .map((shop) => shopObject(shop, now))
    .filter((shop) => states === null || states.includes(shop.display_state));
  return { count: shops.length, stores: shops };
}

// ---- who may see a shop's stock --------------------------------------------------------

/** Lead and the shop's managers may read stock and holds; everyone else gets the not-found answer. */
export function requireStockReader(user: SessionUser, shopId: string): void {
  if (user.role === "lead") return;
  if (user.role === "manager" && user.shopIds.includes(shopId)) return;
  throw notFound();
}

export function requireShopManager(user: SessionUser, shopId: string): void {
  if (user.role === "manager" && user.shopIds.includes(shopId)) return;
  throw forbidden();
}

// ---- suspension -------------------------------------------------------------------------

export async function setSuspension(user: SessionUser, shopId: string, input: Record<string, unknown>, now: Date) {
  const shop = await requireShop(pool, user, shopId);
  if (user.role !== "lead") throw forbidden();
  const errors = new FieldErrors();
  if (typeof input.suspended !== "boolean") errors.add("suspended", "Use true or false.");
  const reason = typeof input.reason === "string" ? input.reason : "";
  if (input.suspended === true && (reason.length < 1 || reason.length > 200)) errors.add("reason", "Give a reason of 1 to 200 characters.");
  errors.throwIfAny();
  await pool.query("UPDATE shops SET suspended = $2, suspension_reason = $3 WHERE id = $1",
    [shop.id, input.suspended, input.suspended === true ? reason : null]);
  return shopObject(await requireShop(pool, user, shopId), now);
}

// ---- hours ------------------------------------------------------------------------------

export function hoursObject(shop: ShopRow, now: Date) {
  const today = localToday(shop.timezone, now);
  const upcoming = hasUpcoming(shop, today) && shop.upcoming_from && shop.upcoming_hours
    ? { effective_from: shop.upcoming_from, days: shop.upcoming_hours } : null;
  return { store_id: shop.id, timezone: shop.timezone, local_today: today, days: planDaysFor(shop, today, today), upcoming };
}

export async function publishHours(user: SessionUser, shopId: string, input: Record<string, unknown>, now: Date) {
  const shop = await requireShop(pool, user, shopId);
  if (user.role !== "manager" || !user.shopIds.includes(shop.id)) throw forbidden();
  const today = localToday(shop.timezone, now);
  const parsed = parseDays(input.days);
  const errors = new FieldErrors();
  for (const [field, message] of Object.entries(parsed.errors)) errors.add(field, message);
  const requested = input.effective_from;
  const effectiveFrom = requested === undefined ? today : requested;
  if (!isCalendarDate(effectiveFrom) || effectiveFrom < today || effectiveFrom > addDays(today, PUBLISH_HORIZON_DAYS)) {
    errors.add("effective_from", "Pick a date from today to 60 days ahead.");
  }
  errors.throwIfAny();
  if (!isCalendarDate(effectiveFrom)) throw validationFailed({ effective_from: "Pick a date from today to 60 days ahead." });
  await transaction(async (db) => {
    const locked = await one<ShopRow>(db, `SELECT ${SHOP_COLUMNS} FROM shops s WHERE s.id = $1 FOR UPDATE OF s`, [shop.id]);
    if (locked && upcomingDue(locked, today)) await promotePlan(db, shop.id);
    if (effectiveFrom === today) {
      await db.query("UPDATE shops SET hours = $2, upcoming_hours = NULL, upcoming_from = NULL WHERE id = $1", [shop.id, JSON.stringify(parsed.days)]);
    } else {
      await db.query("UPDATE shops SET upcoming_hours = $2, upcoming_from = $3 WHERE id = $1", [shop.id, JSON.stringify(parsed.days), effectiveFrom]);
    }
  });
  return hoursObject(await requireShop(pool, user, shopId), now);
}

async function promotePlan(db: Pick<typeof pool, "query">, shopId: string): Promise<void> {
  await db.query("UPDATE shops SET hours = upcoming_hours, upcoming_hours = NULL, upcoming_from = NULL WHERE id = $1", [shopId]);
}

/** Makes an upcoming plan current once its effective date has begun in the shop's own timezone. */
export async function promoteDueHours(now: Date): Promise<void> {
  const waiting = await query<ShopRow>(pool, `SELECT ${SHOP_COLUMNS} FROM shops s WHERE s.upcoming_from IS NOT NULL`);
  for (const shop of waiting) {
    if (upcomingDue(shop, localToday(shop.timezone, now))) await promotePlan(pool, shop.id);
  }
}

// ---- day plans and slots ----------------------------------------------------------------

/** How many places are left in each slot of a shop (same order as `startsMs`); cancelled orders hold none. */
export async function remainingPlaces(db: Pick<typeof pool, "query">, shopId: string, startsMs: number[]): Promise<number[]> {
  const rows = await query<{ slot: Date; used: number }>(db,
    `SELECT o.slot_start_utc AS slot, count(*)::int AS used FROM orders o JOIN order_view v ON v.order_id = o.id
     WHERE o.store_id = $1 AND o.slot_start_utc = ANY($2::timestamptz[]) AND v.status <> 'cancelled' GROUP BY o.slot_start_utc`,
    [shopId, startsMs.map((ms) => new Date(ms))]);
  const taken = new Map(rows.map((row) => [row.slot.getTime(), row.used]));
  return startsMs.map((ms) => SLOT_CAPACITY - (taken.get(ms) ?? 0));
}

export async function dayPlan(user: SessionUser, shopId: string, rawDate: string | null, now: Date) {
  const shop = await requireShop(pool, user, shopId);
  if (!isCalendarDate(rawDate) || rawDate < "2026-01-01" || rawDate > "2030-12-31") {
    throw validationFailed({ date: "Pick a date from 2026 to 2030." });
  }
  const today = localToday(shop.timezone, now);
  const day = dayOn(shop, rawDate, today);
  const slots = slotsOn(shop.timezone, rawDate, day);
  const left = await remainingPlaces(pool, shop.id, slots.map((slot) => slot.startUtcMs));
  return {
    store_id: shop.id, date: rawDate, timezone: shop.timezone, ...dayPlanTimes(shop.timezone, rawDate, day),
    slots: slots.map((slot, index) => slotObject(slot, left[index])),
  };
}

/** The slots a shopper can pick: inside the offer window, with room, and none at all for a suspended shop. */
async function offeredSlots(shop: ShopRow, now: Date) {
  if (shop.suspended) return [];
  const today = localToday(shop.timezone, now);
  const planned = offerDates(shop.timezone, now).map((date) => ({ date, slots: slotsOn(shop.timezone, date, dayOn(shop, date, today)).filter((slot) => inOfferWindow(slot, now)) }));
  const left = await remainingPlaces(pool, shop.id, planned.flatMap((entry) => entry.slots.map((slot) => slot.startUtcMs)));
  let next = 0;
  return planned
    .map((entry) => ({
      date: entry.date,
      slots: entry.slots.flatMap((slot) => {
        const remaining = left[next++];
        return remaining > 0 ? [slotObject(slot, remaining)] : [];
      }),
    }))
    .filter((entry) => entry.slots.length > 0);
}

export async function slotsAnswer(user: SessionUser, shopId: string, now: Date) {
  const shop = await requireShop(pool, user, shopId);
  return { store_id: shop.id, timezone: shop.timezone, days: await offeredSlots(shop, now) };
}

/** True when `startUtcMs` is one of the shop's slots inside the offer window (room is checked in the placing transaction). */
export function isOfferedInstant(shop: ShopRow, startUtcMs: number, now: Date): boolean {
  if (shop.suspended) return false;
  const today = localToday(shop.timezone, now);
  const local = localMoment(shop.timezone, startUtcMs);
  return slotsOn(shop.timezone, local.date, dayOn(shop, local.date, today))
    .some((slot) => slot.startUtcMs === startUtcMs && inOfferWindow(slot, now));
}

export function localTimeOf(shop: Pick<ShopRow, "timezone">, utcMs: number): { date: string; time: string } {
  const moment = localMoment(shop.timezone, utcMs);
  return { date: moment.date, time: clockOf(moment.minutes) };
}


