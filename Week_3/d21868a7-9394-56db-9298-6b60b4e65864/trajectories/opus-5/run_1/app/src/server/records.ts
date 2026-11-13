import { capVolumeMl, effectiveCap } from '../domain/conversion.ts';
import { formatMl, type Ml } from '../domain/decimal.ts';
import type { OrderConflict, OrderStatus } from '../domain/orders.ts';
import { formatInstant, isOrderable, windowLabel, windowStatus, type WindowStatus } from '../domain/time.ts';

/** The stored rows behind each API record, and the one way each is serialised. */

export interface WindowRow {
  id: string;
  channel_id: string;
  channel_name: string;
  rail_order: number;
  opens_at: Date;
  closes_at: Date;
  hours: number;
  table_cap_ml_day: string;
  rostered_operator: string;
  committed_ml: string;
  delivered_ml: string;
  restriction_cap_ml_day: string | null;
  restriction_effective_at: Date | null;
  restriction_id: string | null;
}

export interface WindowFigures {
  tableCapMlDay: Ml;
  restrictionCapMlDay: Ml | null;
  effectiveCapMlDay: Ml;
  capVolumeMl: Ml;
  committedMl: Ml;
  remainingMl: Ml;
  deliveredMl: Ml;
}

export const WINDOW_COLUMNS = `w.id, w.channel_id, c.name as channel_name, c.rail_order, w.opens_at, w.closes_at,
  w.hours, w.table_cap_ml_day, w.rostered_operator, w.committed_ml, w.delivered_ml,
  r.cap_ml_day as restriction_cap_ml_day, r.effective_at as restriction_effective_at, r.id as restriction_id`;

export const WINDOW_FROM = `from windows w
  join channels c on c.id = w.channel_id
  left join restrictions r on r.window_id = w.id`;

export function windowFigures(row: WindowRow): WindowFigures {
  const tableCapMlDay = BigInt(row.table_cap_ml_day);
  const restrictionCapMlDay = row.restriction_cap_ml_day === null ? null : BigInt(row.restriction_cap_ml_day);
  const capVolume = capVolumeMl({
    tableCapMlDay,
    hours: row.hours,
    restrictionCapMlDay,
    opensAt: row.opens_at,
    restrictionEffectiveAt: row.restriction_effective_at,
  });
  const committedMl = BigInt(row.committed_ml);
  return {
    tableCapMlDay,
    restrictionCapMlDay,
    effectiveCapMlDay: effectiveCap(tableCapMlDay, restrictionCapMlDay),
    capVolumeMl: capVolume,
    committedMl,
    remainingMl: capVolume - committedMl,
    deliveredMl: BigInt(row.delivered_ml),
  };
}

function statusOf(row: WindowRow, now: Date): WindowStatus {
  return windowStatus(row.opens_at, row.closes_at, now);
}

export function labelOf(row: WindowRow): string {
  return windowLabel(row.opens_at, row.closes_at);
}

export type ChannelFlows = ReadonlyMap<string, Ml>;

export function windowRecord(row: WindowRow, now: Date, flows: ChannelFlows): Record<string, unknown> {
  const figures = windowFigures(row);
  return {
    id: row.id,
    channel_id: row.channel_id,
    channel_name: row.channel_name,
    label: labelOf(row),
    opens_at: formatInstant(row.opens_at),
    closes_at: formatInstant(row.closes_at),
    hours: row.hours,
    status: statusOf(row, now),
    orderable: isOrderable(row.opens_at, row.closes_at, now),
    table_cap_ml_day: formatMl(figures.tableCapMlDay),
    restriction_cap_ml_day: figures.restrictionCapMlDay === null ? null : formatMl(figures.restrictionCapMlDay),
    restriction_effective_at: row.restriction_effective_at === null ? null : formatInstant(row.restriction_effective_at),
    restriction_id: row.restriction_id,
    effective_cap_ml_day: formatMl(figures.effectiveCapMlDay),
    cap_volume_ml: formatMl(figures.capVolumeMl),
    committed_ml: formatMl(figures.committedMl),
    remaining_ml: formatMl(figures.remainingMl),
    delivered_ml: formatMl(figures.deliveredMl),
    channel_flow_ml_day: formatMl(flows.get(row.channel_id) ?? 0n),
    rostered_operator: row.rostered_operator,
  };
}

export interface OrderRow {
  number: string;
  grower_id: number;
  grower_name: string;
  turnout: string;
  window_id: string;
  requested_ml: string;
  volume_ml: string;
  rate_ml_day: string;
  status: OrderStatus;
  holder_code: string;
  standby_code: string | null;
  conflict: OrderConflict;
  rationed: boolean;
  closed_after_flow: boolean;
  scheduled_at: Date | null;
}

export function orderRecord(row: OrderRow): Record<string, unknown> {
  return {
    number: row.number,
    grower_id: row.grower_id,
    grower_name: row.grower_name,
    turnout: row.turnout,
    window_id: row.window_id,
    requested_ml: formatMl(BigInt(row.requested_ml)),
    volume_ml: formatMl(BigInt(row.volume_ml)),
    rate_ml_day: formatMl(BigInt(row.rate_ml_day)),
    status: row.status,
    holder_code: row.holder_code,
    standby_code: row.standby_code,
    conflict: row.conflict,
    rationed: row.rationed,
    closed_after_flow: row.closed_after_flow,
    scheduled_at: row.scheduled_at === null ? null : formatInstant(row.scheduled_at),
  };
}

export interface CardRow {
  id: string;
  order_number: string;
  turnout: string;
  grower_name: string;
  channel_id: string;
  window_id: string;
  kind: 'start' | 'finish';
  state: 'open' | 'waiting-for-store' | 'spent';
  holder_code: string;
  from_ml_day: string;
  to_ml_day: string;
  stroke_key: string | null;
  committed_at: Date | null;
  confirmed_at: Date | null;
  operator_code: string | null;
  opens_at: Date;
  closes_at: Date;
}

export const CARD_SELECT = `select gc.id, gc.order_number, o.turnout, g.name as grower_name, w.channel_id,
    w.id as window_id, gc.kind, gc.state, gc.holder_code, gc.from_ml_day, gc.to_ml_day, gc.stroke_key,
    gc.committed_at, gc.confirmed_at, gc.operator_code, w.opens_at, w.closes_at
  from gate_cards gc
  join orders o on o.number = gc.order_number
  join users g on g.id = o.grower_id
  join windows w on w.id = o.window_id`;

export function cardRecord(row: CardRow, now: Date): Record<string, unknown> {
  return {
    id: row.id,
    order_number: row.order_number,
    turnout: row.turnout,
    grower_name: row.grower_name,
    channel_id: row.channel_id,
    window_id: row.window_id,
    window_status: windowStatus(row.opens_at, row.closes_at, now),
    kind: row.kind,
    state: row.state,
    holder_code: row.holder_code,
    from_ml_day: formatMl(BigInt(row.from_ml_day)),
    to_ml_day: formatMl(BigInt(row.to_ml_day)),
    stroke:
      row.stroke_key === null || row.committed_at === null
        ? null
        : {
            key: row.stroke_key,
            committed_at: formatInstant(row.committed_at),
            confirmed_at: row.confirmed_at === null ? null : formatInstant(row.confirmed_at),
            operator_code: row.operator_code,
          },
  };
}

export interface PackRow {
  number: string;
  from_date: string;
  to_date: string;
  signatory: string;
  state: 'building' | 'stored' | 'mailed' | 'withdrawn';
  stalled_on: 'store' | 'mail' | null;
  object_key: string;
  sha256: string | null;
  created_at: Date;
  mailed_at: Date | null;
}

export function packRecord(row: PackRow): Record<string, unknown> {
  return {
    id: row.number,
    number: row.number,
    from: row.from_date,
    to: row.to_date,
    signatory: row.signatory,
    state: row.state,
    stalled_on: row.stalled_on,
    key: row.object_key,
    sha256: row.sha256,
    created_at: formatInstant(row.created_at),
    mailed_at: row.mailed_at === null ? null : formatInstant(row.mailed_at),
  };
}
