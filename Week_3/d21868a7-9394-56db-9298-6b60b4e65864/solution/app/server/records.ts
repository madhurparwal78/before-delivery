// Loading records and shaping them for the API. Every window figure is derived here from the stored
// window, restriction, order and allocation figures, so every screen and endpoint shows the same values.
import type { Db } from "./db.ts";
import { capVolume, effectiveCap, formatMl, type Milli } from "./decimal.ts";
import { DISTRICT_ZONE, isoInstant, minutesBefore, orderingHorizon, windowLabel, windowStatus, type WindowStatus } from "./time.ts";

interface WindowRow {
  id: string;
  channel_id: string;
  channel_name: string;
  opens_at: Date;
  closes_at: Date;
  hours: number;
  table_cap_milli: Milli;
  restriction_id: number | null;
  restriction_cap_milli: Milli | null;
  restriction_effective_at: Date | null;
  rostered_operator: string;
  committed_milli: Milli;
  delivered_milli: Milli;
  channel_flow_milli: Milli;
}

export interface WindowFigures extends WindowRow {
  label: string;
  status: WindowStatus;
  orderable: boolean;
  effective_cap_milli: Milli;
  cap_volume_milli: Milli;
  remaining_milli: Milli;
}

const WINDOW_SELECT = `
  SELECT w.id, w.channel_id, c.name AS channel_name, w.opens_at, w.closes_at, w.hours, w.table_cap_milli,
         r.id AS restriction_id, r.cap_milli AS restriction_cap_milli, r.effective_at AS restriction_effective_at,
         w.rostered_operator, w.committed_milli,
         COALESCE((SELECT sum(o.volume_milli) FROM water_order o
                   WHERE o.window_id = w.id AND o.status = 'delivered'), 0)::bigint AS delivered_milli,
         COALESCE((SELECT sum(o.rate_milli) FROM water_order o JOIN delivery_window ow ON ow.id = o.window_id
                   WHERE ow.channel_id = w.channel_id AND o.flow_started_at IS NOT NULL
                     AND o.flow_stopped_at IS NULL), 0)::bigint AS channel_flow_milli
  FROM delivery_window w
  JOIN channel c ON c.id = w.channel_id
  LEFT JOIN restriction r ON r.window_id = w.id`;

const WINDOW_ORDER = "ORDER BY c.rail_order, w.opens_at, w.id";

/** The window's cap volume by the one conversion rule, at its own table cap or at a proposed one. */
export function capVolumeOf(w: WindowRow, tableCap: Milli = w.table_cap_milli): Milli {
  const restriction =
    w.restriction_cap_milli === null
      ? null
      : { cap: w.restriction_cap_milli, minutesBefore: minutesBefore(w.opens_at, w.restriction_effective_at!) };
  return capVolume(tableCap, w.hours, restriction);
}

function figures(row: WindowRow, now: Date): WindowFigures {
  const effective = effectiveCap(row.table_cap_milli, row.restriction_cap_milli);
  const volume = capVolumeOf(row);
  return {
    ...row,
    label: windowLabel(row.opens_at, row.closes_at),
    status: windowStatus(row.opens_at, row.closes_at, now),
    orderable: orderingHorizon(row.opens_at, row.closes_at, now) === "orderable",
    effective_cap_milli: effective,
    cap_volume_milli: volume,
    remaining_milli: volume - row.committed_milli,
  };
}

export async function loadWindows(db: Db, where = "", params: unknown[] = []): Promise<WindowFigures[]> {
  const rows = await db.query<WindowRow>(`${WINDOW_SELECT} ${where} ${WINDOW_ORDER}`, params);
  const now = new Date();
  return rows.rows.map((row) => figures(row, now));
}

/** Windows whose opening falls on the given district dates (either bound optional), inclusive. */
export async function windowsOpeningBetween(db: Db, from: string | null, to: string | null): Promise<WindowFigures[]> {
  const day = `(w.opens_at AT TIME ZONE '${DISTRICT_ZONE}')::date`;
  return loadWindows(db, `WHERE ($1::date IS NULL OR ${day} >= $1::date) AND ($2::date IS NULL OR ${day} <= $2::date)`, [from, to]);
}

export async function loadWindow(db: Db, id: string): Promise<WindowFigures | null> {
  return (await loadWindows(db, "WHERE w.id = $1", [id]))[0] ?? null;
}

export function windowRecord(w: WindowFigures) {
  return {
    id: w.id,
    channel_id: w.channel_id,
    channel_name: w.channel_name,
    label: w.label,
    opens_at: isoInstant(w.opens_at),
    closes_at: isoInstant(w.closes_at),
    hours: w.hours,
    status: w.status,
    orderable: w.orderable,
    table_cap_ml_day: formatMl(w.table_cap_milli),
    restriction_cap_ml_day: w.restriction_cap_milli === null ? null : formatMl(w.restriction_cap_milli),
    restriction_effective_at: w.restriction_effective_at === null ? null : isoInstant(w.restriction_effective_at),
    restriction_id: w.restriction_id,
    effective_cap_ml_day: formatMl(w.effective_cap_milli),
    cap_volume_ml: formatMl(w.cap_volume_milli),
    committed_ml: formatMl(w.committed_milli),
    remaining_ml: formatMl(w.remaining_milli),
    delivered_ml: formatMl(w.delivered_milli),
    channel_flow_ml_day: formatMl(w.channel_flow_milli),
    rostered_operator: w.rostered_operator,
  };
}

export type OrderStatus = "requested" | "scheduled" | "running" | "delivered" | "closed";

export interface OrderRow {
  number: string;
  grower_id: number;
  turnout: string;
  window_id: string;
  requested_milli: Milli;
  volume_milli: Milli;
  rate_milli: Milli;
  status: OrderStatus;
  holder_code: string;
  standby_code: string | null;
  conflict: "restriction" | "lapsed" | null;
  closed_after_flow: boolean;
  rationed: boolean;
  scheduled_at: Date | null;
  grower_name: string;
}

/** Orders with their grower's name, which the board's Window orders table shows. */
export const ORDER_SELECT = "SELECT o.*, p.name AS grower_name FROM water_order o JOIN person p ON p.id = o.grower_id";

export async function loadOrder(db: Db, number: string): Promise<OrderRow | null> {
  const found = await db.query<OrderRow>(`${ORDER_SELECT} WHERE o.number = $1`, [number]);
  return found.rows[0] ?? null;
}

export function orderRecord(o: OrderRow) {
  return {
    number: o.number,
    grower_id: o.grower_id,
    grower_name: o.grower_name,
    turnout: o.turnout,
    window_id: o.window_id,
    requested_ml: formatMl(o.requested_milli),
    volume_ml: formatMl(o.volume_milli),
    rate_ml_day: formatMl(o.rate_milli),
    status: o.status,
    holder_code: o.holder_code,
    standby_code: o.standby_code,
    conflict: o.conflict,
    closed_after_flow: o.closed_after_flow,
    rationed: o.rationed,
    scheduled_at: o.scheduled_at === null ? null : isoInstant(o.scheduled_at),
  };
}

type CardState = "open" | "waiting-for-store" | "spent";

export interface CardRow {
  id: number;
  order_number: string;
  kind: "start" | "finish";
  state: CardState;
  holder_code: string;
  handed_over: boolean;
  from_milli: Milli;
  to_milli: Milli;
  stroke_key: string | null;
  stroke_operator_code: string | null;
  committed_at: Date | null;
  confirmed_at: Date | null;
  turnout: string;
  channel_id: string;
  window_id: string;
  window_opens_at: Date;
  window_closes_at: Date;
  grower_name: string;
}

export const CARD_SELECT = `
  SELECT g.*, o.turnout, w.channel_id, o.window_id, w.opens_at AS window_opens_at, w.closes_at AS window_closes_at,
         p.name AS grower_name
  FROM gate_card g
  JOIN water_order o ON o.number = g.order_number
  JOIN delivery_window w ON w.id = o.window_id
  JOIN person p ON p.id = o.grower_id`;

export async function loadCard(db: Db, id: number): Promise<CardRow | null> {
  const found = await db.query<CardRow>(`${CARD_SELECT} WHERE g.id = $1`, [id]);
  return found.rows[0] ?? null;
}

export function cardRecord(c: CardRow) {
  return {
    id: c.id,
    order_number: c.order_number,
    turnout: c.turnout,
    channel_id: c.channel_id,
    window_id: c.window_id,
    window_status: windowStatus(c.window_opens_at, c.window_closes_at, new Date()),
    grower_name: c.grower_name,
    kind: c.kind,
    state: c.state,
    holder_code: c.holder_code,
    handed_over: c.handed_over,
    from_ml_day: formatMl(c.from_milli),
    to_ml_day: formatMl(c.to_milli),
    stroke:
      c.committed_at === null
        ? null
        : {
            key: c.stroke_key,
            committed_at: isoInstant(c.committed_at),
            confirmed_at: c.confirmed_at === null ? null : isoInstant(c.confirmed_at),
            operator_code: c.stroke_operator_code,
          },
  };
}

export async function allocationRecord(db: Db, growerId: number) {
  const found = await db.query<{ allocation_milli: Milli; debited_milli: Milli }>(
    "SELECT allocation_milli, debited_milli FROM allocation WHERE grower_id = $1",
    [growerId],
  );
  const a = found.rows[0]!;
  return {
    allocation_ml: formatMl(a.allocation_milli),
    debited_ml: formatMl(a.debited_milli),
    remaining_ml: formatMl(a.allocation_milli - a.debited_milli),
  };
}
