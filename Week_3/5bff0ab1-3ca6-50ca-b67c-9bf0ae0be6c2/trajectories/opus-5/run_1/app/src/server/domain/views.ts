import type { FinishId, HubId, ModelId } from '../../shared/catalogue.js';
import type {
  DaySheetRow,
  DeliveryDayView,
  HeldUnitRow,
  Lock,
  LockState,
  Notice,
  Ride,
  RideState,
  SlotView,
  User,
} from '../../shared/types.js';
import {
  iso,
  istDate,
  labelDMonTimeIst,
  labelDay,
  istInstant,
} from '../clock.js';
import { query, type Row } from '../db.js';
import {
  deliveryCapacity,
  deliveryWindow,
  isClosed,
  isDeliveryDateClosed,
  slotCutOff,
  slotLabel,
  slotStarts,
} from './calendar.js';

export interface LockRow extends Row {
  id: string;
  ref: string;
  rider_id: string;
  hub: string;
  model: string;
  finish: string;
  state: string;
  issued_at: Date;
  expires_at: Date | null;
  hold_active: boolean;
  step_effective_from: string;
  ex_factory_paise: number;
  gst_percent: number;
  gst_paise: number;
  ex_showroom_paise: number;
  road_tax_percent: number;
  road_tax_paise: number;
  insurance_paise: number;
  on_road_paise: number;
  delivery_date: string | null;
  waiting_for: string | null;
  waiting_since: Date | null;
  sheet_ready?: boolean;
  wait_position?: number | null;
}

export const LOCK_SELECT = `
  select l.*, (sh.lock_id is not null) as sheet_ready,
    case when l.waiting_for is null then null else (
      select count(*) + 1 from locks w
      where w.hub = l.hub and w.waiting_for = l.waiting_for and w.waiting_since < l.waiting_since
    ) end as wait_position
  from locks l left join lock_sheets sh on sh.lock_id = l.id
`;

/** A lock past its expiry reads as ended whatever has been written yet. */
export function effectiveState(row: LockRow, now: Date): LockState {
  if (
    (row.state === 'requested' || row.state === 'locked') &&
    row.expires_at !== null &&
    row.expires_at.getTime() <= now.getTime()
  ) {
    return 'expired';
  }
  return row.state as LockState;
}

export function hoursLeftOf(expiresAt: Date | null, state: LockState, now: Date): number {
  if (!expiresAt) return 0;
  if (state !== 'locked' && state !== 'requested') return 0;
  const remaining = expiresAt.getTime() - now.getTime();
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / 3_600_000);
}

export function lockView(row: LockRow, now: Date): Lock {
  const state = effectiveState(row, now);
  const expiresAt = row.expires_at;
  return {
    id: row.id,
    state,
    hub: row.hub as HubId,
    model: row.model as ModelId,
    finish: row.finish as FinishId,
    ref: row.ref,
    issuedAt: iso(row.issued_at),
    expiresAt: expiresAt ? iso(expiresAt) : null,
    expiresLabel: expiresAt ? labelDMonTimeIst(expiresAt) : null,
    hoursLeft: hoursLeftOf(expiresAt, state, now),
    exShowroomPaise: row.ex_showroom_paise,
    roadTaxPaise: row.road_tax_paise,
    insurancePaise: row.insurance_paise,
    onRoadPaise: row.on_road_paise,
    stepEffectiveFrom: row.step_effective_from,
    deliveryDate: row.delivery_date,
    sheetReady: row.sheet_ready === true,
    waitingFor: row.waiting_for,
    waitPosition: row.waiting_for ? Number(row.wait_position ?? 1) : null,
  };
}

export interface RideRow extends Row {
  id: string;
  rider_id: string;
  hub: string;
  model: string;
  state: string;
  starts_at: Date;
  moved_from: Date | null;
  booked_at: Date;
  marked_at: Date | null;
}

export function rideView(row: RideRow, now: Date): Ride {
  return {
    id: row.id,
    state: row.state as RideState,
    hub: row.hub as HubId,
    model: row.model as ModelId,
    startsAt: iso(row.starts_at),
    label: slotLabel(row.starts_at),
    dayLabel: labelDay(istDate(row.starts_at), now),
    cutOffAt: iso(slotCutOff(row.starts_at)),
    movedFrom: row.moved_from ? iso(row.moved_from) : null,
  };
}

export function userView(row: Row): User {
  return {
    id: row.id as string,
    role: row.role as 'rider' | 'hub_host',
    name: row.name as string,
    mobile: row.mobile as string,
    hub: (row.hub as HubId | null) ?? null,
    licenceNumber: (row.licence_number as string | null) ?? null,
    licenceValidUntil: (row.licence_valid_until as string | null) ?? null,
    remindersOn: row.reminders_on === true,
  };
}

export function noticeView(row: Row): Notice {
  return {
    id: row.id as string,
    kind: row.kind as Notice['kind'],
    state: row.state as Notice['state'],
    dueAt: iso(row.due_at as Date),
    sentAt: row.sent_at ? iso(row.sent_at as Date) : null,
    lockId: (row.lock_id as string | null) ?? null,
    rideId: (row.ride_id as string | null) ?? null,
  };
}

export async function slotsForDay(
  hub: HubId,
  date: string,
  now: Date,
): Promise<{ open: boolean; slots: SlotView[] }> {
  const starts = slotStarts(hub, date);
  if (starts.length === 0) return { open: false, slots: [] };
  const booked = await query<{ starts_at: Date }>(
    `select starts_at from rides where hub = $1 and state = 'booked'
       and starts_at >= $2 and starts_at < $3`,
    [hub, istInstant(date, 0), istInstant(date, 24 * 60)],
  );
  const takenTimes = new Set(booked.map((row) => row.starts_at.getTime()));
  const slots = starts.map((startsAt) => {
    const pastCutOff = now.getTime() >= slotCutOff(startsAt).getTime();
    const state: SlotView['state'] = pastCutOff
      ? 'past_cut_off'
      : takenTimes.has(startsAt.getTime())
        ? 'taken'
        : 'free';
    return { startsAt: iso(startsAt), label: slotLabel(startsAt), state };
  });
  return { open: true, slots };
}

/** The earliest free slot at a hub with now before its cut-off, inside the booking window. */
export async function nextFreeSlot(
  hub: HubId,
  now: Date,
): Promise<{ startsAt: string; label: string } | null> {
  const today = istDate(now);
  const booked = await query<{ starts_at: Date }>(
    `select starts_at from rides where hub = $1 and state = 'booked' and starts_at >= $2`,
    [hub, now],
  );
  const taken = new Set(booked.map((row) => row.starts_at.getTime()));
  for (let offset = 0; offset <= 14; offset += 1) {
    const date = offset === 0 ? today : addDays(today, offset);
    for (const startsAt of slotStarts(hub, date)) {
      if (now.getTime() >= slotCutOff(startsAt).getTime()) continue;
      if (taken.has(startsAt.getTime())) continue;
      return { startsAt: iso(startsAt), label: slotLabel(startsAt) };
    }
  }
  return null;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map((p) => Number(p));
  const next = new Date(Date.UTC(y as number, (m as number) - 1, (d as number) + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(
    next.getUTCDate(),
  ).padStart(2, '0')}`;
}

export async function placesTaken(hub: HubId, dates: readonly string[]): Promise<Map<string, number>> {
  const taken = new Map<string, number>();
  if (dates.length === 0) return taken;
  const seeded = await query<{ delivery_date: string; taken: number }>(
    `select delivery_date, taken from delivery_seed where hub = $1 and delivery_date = any($2::date[])`,
    [hub, dates as string[]],
  );
  for (const row of seeded) taken.set(row.delivery_date, row.taken);
  const held = await query<{ delivery_date: string; n: number }>(
    `select delivery_date, count(*) as n from locks
      where hub = $1 and delivery_date = any($2::date[]) and state in ('delivery_set','delivered')
      group by delivery_date`,
    [hub, dates as string[]],
  );
  for (const row of held) taken.set(row.delivery_date, (taken.get(row.delivery_date) ?? 0) + Number(row.n));
  return taken;
}

export async function deliveryDaysFor(row: LockRow, now: Date): Promise<DeliveryDayView[]> {
  const hub = row.hub as HubId;
  const dates = deliveryWindow(row.issued_at);
  const taken = await placesTaken(hub, dates);
  return dates.map((date) => {
    const capacity = deliveryCapacity(date);
    const used = taken.get(date) ?? 0;
    const placesLeft = Math.max(0, capacity - used);
    const closed = isClosed(hub, date) || isDeliveryDateClosed(hub, row.issued_at, date, now);
    const state: DeliveryDayView['state'] = closed ? 'closed' : placesLeft === 0 ? 'full' : 'open';
    return {
      date,
      dayLabel: labelDay(date, now),
      capacity,
      placesLeft: closed && placesLeft > 0 ? 0 : placesLeft,
      state,
    };
  });
}

export async function daySheetRows(hub: HubId, date: string, now: Date): Promise<DaySheetRow[]> {
  const dayStart = istInstant(date, 0);
  const dayEnd = istInstant(date, 24 * 60);
  const rides = await query<RideRow & { rider_name: string; licence_number: string | null }>(
    `select r.*, u.name as rider_name, u.licence_number from rides r join users u on u.id = r.rider_id
      where r.hub = $1 and r.starts_at >= $2 and r.starts_at < $3
        and r.state in ('booked','ridden','no_show')
      order by r.starts_at asc`,
    [hub, dayStart, dayEnd],
  );
  const handovers = await query<LockRow & { rider_name: string }>(
    `select l.*, u.name as rider_name from locks l join users u on u.id = l.rider_id
      where l.hub = $1 and l.delivery_date = $2 and l.state in ('delivery_set','delivered')
      order by l.issued_at asc`,
    [hub, date],
  );
  const rows: DaySheetRow[] = rides.map((row) => ({
    kind: 'ride' as const,
    id: row.id,
    label: slotLabel(row.starts_at),
    riderName: row.rider_name,
    model: row.model as ModelId,
    finish: null,
    licenceLast4: row.licence_number ? row.licence_number.slice(-4) : null,
    state: row.state as 'booked' | 'ridden' | 'no_show',
    actions:
      row.state === 'booked' && now.getTime() >= row.starts_at.getTime()
        ? (['ridden', 'no_show'] as DaySheetRow['actions'])
        : [],
  }));
  for (const row of handovers) {
    const onOrAfter = now.getTime() >= istInstant(date, 0).getTime();
    rows.push({
      kind: 'handover',
      id: row.id,
      label: 'Handover',
      riderName: row.rider_name,
      model: row.model as ModelId,
      finish: row.finish as FinishId,
      licenceLast4: null,
      state: row.state as 'delivery_set' | 'delivered',
      actions: row.state === 'delivery_set' && onOrAfter ? ['delivered'] : [],
    });
  }
  return rows;
}

export async function heldUnitRows(hub: HubId, now: Date): Promise<HeldUnitRow[]> {
  const rows = await query<LockRow & { rider_name: string }>(
    `select l.*, u.name as rider_name,
       case when l.waiting_for is null then null else (
         select count(*) + 1 from locks w
         where w.hub = l.hub and w.waiting_for = l.waiting_for and w.waiting_since < l.waiting_since
       ) end as wait_position
     from locks l join users u on u.id = l.rider_id
     where l.hub = $1 and l.state in ('requested','locked','delivery_set')
     order by l.issued_at asc`,
    [hub],
  );
  return rows
    .filter((row) => effectiveState(row, now) !== 'expired')
    .map((row) => {
      const state = effectiveState(row, now) as 'requested' | 'locked' | 'delivery_set';
      return {
        id: row.id,
        riderName: row.rider_name,
        model: row.model as ModelId,
        finish: row.finish as FinishId,
        state,
        expiresLabel:
          state === 'delivery_set' || !row.expires_at ? null : labelDMonTimeIst(row.expires_at),
        deliveryDate: row.delivery_date,
        waitingFor: row.waiting_for,
        actions:
          state === 'requested'
            ? (['confirm', 'refuse'] as HeldUnitRow['actions'])
            : (['withdraw'] as HeldUnitRow['actions']),
      };
    });
}

