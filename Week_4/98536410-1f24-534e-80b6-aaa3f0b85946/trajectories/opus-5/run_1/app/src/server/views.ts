import { asNumber, query } from './db.js';
import type { Queryable, Row } from './db.js';
import {
  SLOT_CAPACITY,
  SLOT_WINDOW_FROM_SECONDS,
  SLOT_WINDOW_TO_SECONDS,
  STATE_LABELS,
  dayPlanFor,
  displayStateOf,
  planInEffect,
} from './domain/hours.js';
import type { DayEntry, DayPlan, HoursPlan, Slot } from './domain/hours.js';
import type { DisplayState } from './domain/hours.js';
import { addLocalDays, isoMillis, localDate } from './domain/time.js';
import { lineTotalCents, vatCents } from './domain/money.js';
import type { HoldStatus, OrderStatus, ReturnStatus } from './domain/transitions.js';

export type StoreRecord = {
  id: string;
  operatorId: string;
  name: string;
  city: string;
  region: string;
  lat: number;
  lon: number;
  timezone: string;
  vatRate: number;
  suspended: boolean;
  suspensionReason: string | null;
  criticalLines: number;
  plans: HoursPlan[];
};

export type StoreObject = {
  id: string;
  name: string;
  city: string;
  region: string;
  lat: number;
  lon: number;
  timezone: string;
  vat_rate: number;
  display_state: DisplayState;
  state_label: string;
  suspended: boolean;
  suspension_reason: string | null;
  closes_local: string | null;
  critical_lines: number;
};

const STORE_SELECT = `
  SELECT s.id, s.operator_id, s.name, s.city, s.region, s.lat, s.lon, s.timezone,
         s.vat_rate, s.suspended, s.suspension_reason,
         COALESCE(c.critical_lines, 0) AS critical_lines,
         COALESCE(p.plans, '[]'::jsonb) AS plans
    FROM stores s
    LEFT JOIN (
      SELECT store_id, count(*) AS critical_lines FROM stock WHERE on_hand <= 2 GROUP BY store_id
    ) c ON c.store_id = s.id
    LEFT JOIN (
      SELECT store_id,
             jsonb_agg(jsonb_build_object('effectiveFrom', to_char(effective_from, 'YYYY-MM-DD'),
                                          'days', days)) AS plans
        FROM hours_plans GROUP BY store_id
    ) p ON p.store_id = s.id`;

function toStoreRecord(row: Row): StoreRecord {
  return {
    id: row['id'] as string,
    operatorId: row['operator_id'] as string,
    name: row['name'] as string,
    city: row['city'] as string,
    region: row['region'] as string,
    lat: asNumber(row['lat']),
    lon: asNumber(row['lon']),
    timezone: row['timezone'] as string,
    vatRate: asNumber(row['vat_rate']),
    suspended: row['suspended'] as boolean,
    suspensionReason: row['suspension_reason'] as string | null,
    criticalLines: asNumber(row['critical_lines']),
    plans: row['plans'] as HoursPlan[],
  };
}

export async function loadStores(operatorId: string, text: string): Promise<StoreRecord[]> {
  const rows = await query(
    `${STORE_SELECT}
     WHERE s.operator_id = $1
       AND ($2 = '' OR strpos(tramela_fold(s.name), tramela_fold($2)) > 0
                    OR strpos(tramela_fold(s.id), tramela_fold($2)) > 0
                    OR strpos(tramela_fold(s.city), tramela_fold($2)) > 0)
     ORDER BY s.id`,
    [operatorId, text],
  );
  return rows.map(toStoreRecord);
}

export async function loadStore(
  operatorId: string,
  storeId: string,
): Promise<StoreRecord | null> {
  const rows = await query(`${STORE_SELECT} WHERE s.operator_id = $1 AND s.id = $2`, [
    operatorId,
    storeId,
  ]);
  const row = rows[0];
  return row ? toStoreRecord(row) : null;
}

export function storeObject(store: StoreRecord, now: Date): StoreObject {
  const state = displayStateOf({
    timezone: store.timezone,
    plans: store.plans,
    now,
    suspended: store.suspended,
    criticalLines: store.criticalLines,
  });
  return {
    id: store.id,
    name: store.name,
    city: store.city,
    region: store.region,
    lat: store.lat,
    lon: store.lon,
    timezone: store.timezone,
    vat_rate: store.vatRate,
    display_state: state.displayState,
    state_label: STATE_LABELS[state.displayState],
    suspended: store.suspended,
    suspension_reason: store.suspensionReason,
    closes_local: state.closesLocal,
    critical_lines: store.criticalLines,
  };
}

export type HoursObject = {
  store_id: string;
  timezone: string;
  local_today: string;
  days: DayEntry[];
  upcoming: { effective_from: string; days: DayEntry[] } | null;
};

function orderedDays(days: DayEntry[]): DayEntry[] {
  return days.map((day) => ({
    weekday: day.weekday,
    open: day.open,
    opens: day.opens,
    closes: day.closes,
  }));
}

export function hoursObject(store: StoreRecord, now: Date): HoursObject {
  const today = localDate(store.timezone, now);
  const current = planInEffect(store.plans, today);
  const upcoming = store.plans
    .filter((plan) => plan.effectiveFrom > today)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0];
  return {
    store_id: store.id,
    timezone: store.timezone,
    local_today: today,
    days: orderedDays(current.days),
    upcoming: upcoming
      ? { effective_from: upcoming.effectiveFrom, days: orderedDays(upcoming.days) }
      : null,
  };
}

/** Orders that are not cancelled, per slot start, for one shop inside an instant range. */
async function slotTakenCounts(
  storeId: string,
  fromUtc: Date,
  toUtc: Date,
): Promise<Map<string, number>> {
  const rows = await query(
    `SELECT slot_start_utc, count(*) AS taken FROM orders
      WHERE store_id = $1 AND status <> 'cancelled' AND slot_start_utc >= $2 AND slot_start_utc <= $3
      GROUP BY slot_start_utc`,
    [storeId, fromUtc, toUtc],
  );
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(isoMillis(row['slot_start_utc'] as Date), asNumber(row['taken']));
  }
  return counts;
}

function remainingFrom(counts: Map<string, number>, startUtc: string): 0 | 1 | 2 {
  const left = SLOT_CAPACITY - (counts.get(startUtc) ?? 0);
  return (left < 0 ? 0 : left) as 0 | 1 | 2;
}

export async function dayPlanOf(store: StoreRecord, date: string): Promise<DayPlan> {
  const windowStart = new Date(`${addLocalDays(date, -1)}T00:00:00.000Z`);
  const windowEnd = new Date(`${addLocalDays(date, 2)}T00:00:00.000Z`);
  const counts = await slotTakenCounts(store.id, windowStart, windowEnd);
  return dayPlanFor(store.timezone, store.plans, date, (startUtc) =>
    remainingFrom(counts, startUtc),
  );
}



export async function offeredSlots(
  store: StoreRecord,
  now: Date,
): Promise<{ date: string; slots: Slot[] }[]> {
  if (store.suspended) return [];
  const from = new Date(now.getTime() + SLOT_WINDOW_FROM_SECONDS * 1000);
  const to = new Date(now.getTime() + SLOT_WINDOW_TO_SECONDS * 1000);
  const counts = await slotTakenCounts(store.id, from, to);
  const days: { date: string; slots: Slot[] }[] = [];
  const firstDate = localDate(store.timezone, from);
  for (let offset = 0; offset <= 8; offset += 1) {
    const date = addLocalDays(firstDate, offset);
    const plan = dayPlanFor(store.timezone, store.plans, date, (startUtc) =>
      remainingFrom(counts, startUtc),
    );
    const slots = plan.slots.filter((slot) => {
      const at = new Date(slot.start_utc).getTime();
      return at >= from.getTime() && at <= to.getTime() && slot.remaining > 0;
    });
    if (slots.length > 0) days.push({ date, slots });
  }
  return days;
}

export async function isOfferedSlot(
  store: StoreRecord,
  now: Date,
  slotStartUtc: string,
): Promise<boolean> {
  const days = await offeredSlots(store, now);
  return days.some((day) => day.slots.some((slot) => slot.start_utc === slotStartUtc));
}

export type HoldObject = {
  id: string;
  status: HoldStatus;
  store_id: string;
  lines: { sku: string; quantity: number }[];
  created_at: string;
  expires_at: string;
  seconds_left: number;
  released_at: string | null;
};

export function holdObject(row: Row, lines: Row[], now: Date): HoldObject {
  const expiresAt = row['expires_at'] as Date;
  const left = Math.ceil((expiresAt.getTime() - now.getTime()) / 1000);
  return {
    id: row['id'] as string,
    status: row['status'] as HoldStatus,
    store_id: row['store_id'] as string,
    lines: lines.map((line) => ({
      sku: line['sku'] as string,
      quantity: asNumber(line['quantity']),
    })),
    created_at: isoMillis(row['created_at'] as Date),
    expires_at: isoMillis(expiresAt),
    seconds_left: row['status'] === 'active' && left > 0 ? left : 0,
    released_at: row['released_at'] ? isoMillis(row['released_at'] as Date) : null,
  };
}

export async function loadHoldObject(
  holdId: string,
  now: Date,
  runner: Queryable | null = null,
): Promise<HoldObject | null> {
  const run = runner
    ? async (text: string, values: unknown[]) => (await runner.query(text, values)).rows
    : query;
  const rows = await run(`SELECT * FROM holds WHERE id = $1`, [holdId]);
  const row = rows[0];
  if (!row) return null;
  const lines = await run(`SELECT sku, quantity FROM hold_lines WHERE hold_id = $1 ORDER BY sku`, [
    holdId,
  ]);
  return holdObject(row, lines, now);
}

export type CartLineObject = {
  sku: string;
  name: string;
  quantity: number;
  unit_price_milli: number;
  line_total_cents: number;
  vat_cents: number | null;
  available: number | null;
  status: 'ok' | 'short';
};

export type CartObject = {
  store_id: string | null;
  store_name: string | null;
  area: { lat: number; lon: number } | null;
  lines: CartLineObject[];
  total_cents: number;
  vat_cents: number | null;
  units: number;
  hold: HoldObject | null;
};

export async function buildCart(userId: string, now: Date): Promise<CartObject> {
  const cartRows = await query(
    `SELECT c.store_id, c.area_lat, c.area_lon, s.name AS store_name, s.vat_rate
       FROM carts c LEFT JOIN stores s ON s.id = c.store_id WHERE c.user_id = $1`,
    [userId],
  );
  const cart = cartRows[0];
  const storeId = (cart?.['store_id'] as string | null) ?? null;
  const vatRate = cart?.['vat_rate'] === undefined ? null : asNumber(cart['vat_rate']);

  const lineRows = await query(
    `SELECT l.sku, l.quantity, p.name, p.unit_price_milli
       FROM cart_lines l
       JOIN users u ON u.id = l.user_id
       JOIN products p ON p.operator_id = u.operator_id AND p.sku = l.sku
      WHERE l.user_id = $1 ORDER BY l.added_seq`,
    [userId],
  );

  const activeHold = await query(
    `SELECT * FROM holds WHERE user_id = $1 AND status = 'active' AND expires_at > $2`,
    [userId, now],
  );
  const holdRow = activeHold[0];
  const holdLines = holdRow
    ? await query(`SELECT sku, quantity FROM hold_lines WHERE hold_id = $1 ORDER BY sku`, [
        holdRow['id'],
      ])
    : [];
  const heldByOwnHold = new Map<string, number>();
  for (const line of holdLines) {
    heldByOwnHold.set(line['sku'] as string, asNumber(line['quantity']));
  }

  const stockBySku = new Map<string, number>();
  if (storeId) {
    const stockRows = await query(
      `SELECT sku, on_hand - held AS available FROM stock WHERE store_id = $1`,
      [storeId],
    );
    for (const row of stockRows) {
      stockBySku.set(row['sku'] as string, asNumber(row['available']));
    }
  }

  const lines: CartLineObject[] = [];
  let totalCents = 0;
  let totalVat = 0;
  let units = 0;

  for (const row of lineRows) {
    const sku = row['sku'] as string;
    const quantity = asNumber(row['quantity']);
    const unitPrice = asNumber(row['unit_price_milli']);
    const lineTotal = lineTotalCents(quantity, unitPrice);
    const available =
      storeId === null
        ? null
        : (stockBySku.get(sku) ?? 0) + (heldByOwnHold.get(sku) ?? 0);
    const short = available !== null && available < quantity;
    const lineVat = storeId === null || vatRate === null ? null : vatCents(lineTotal, vatRate);
    if (!short) {
      totalCents += lineTotal;
      totalVat += lineVat ?? 0;
      units += quantity;
    }
    lines.push({
      sku,
      name: row['name'] as string,
      quantity,
      unit_price_milli: unitPrice,
      line_total_cents: lineTotal,
      vat_cents: lineVat,
      available,
      status: short ? 'short' : 'ok',
    });
  }

  return {
    store_id: storeId,
    store_name: (cart?.['store_name'] as string | null) ?? null,
    area:
      cart?.['area_lat'] === null || cart?.['area_lat'] === undefined
        ? null
        : { lat: asNumber(cart['area_lat']), lon: asNumber(cart['area_lon']) },
    lines,
    total_cents: totalCents,
    vat_cents: storeId === null ? null : totalVat,
    units,
    hold: holdRow ? holdObject(holdRow, holdLines, now) : null,
  };
}

export type OrderLineObject = {
  sku: string;
  name: string;
  quantity: number;
  unit_price_milli: number;
  line_total_cents: number;
  vat_rate: number;
  vat_cents: number;
  returned_quantity: number;
};

export type OrderObject = {
  id: string;
  number: string;
  status: OrderStatus;
  store_id: string;
  store_name: string;
  timezone: string;
  slot_start_utc: string;
  slot_local_date: string;
  slot_local_time: string;
  customer: { name: string; email: string };
  lines: OrderLineObject[];
  total_cents: number;
  vat_cents: number;
  refunded_cents: number;
  created_at: string;
};

export type ReturnObject = {
  id: string;
  number: string;
  order_id: string;
  status: ReturnStatus;
  lines: { sku: string; quantity: number; refund_cents: number }[];
  refund_cents: number;
  reason: string;
  created_at: string;
};
