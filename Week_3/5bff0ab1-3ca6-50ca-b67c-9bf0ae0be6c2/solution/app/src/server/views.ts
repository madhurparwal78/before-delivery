import { FINISHES, MODELS, type FinishId, type HubId, type ModelId } from "../shared/catalogue.js";
import { addDays, asOfLabel, dayLabel, expiryLabel, isoIst, istDate, istInstant, timeLabel } from "../shared/clock.js";
import type { Lock, LockState, Reading, Ride, RideState, SlotsReply } from "../shared/types.js";
import { hubStatus } from "./core.js";
import { q } from "./db.js";
import { cutOffOf, effectiveState, hoursLeft, isPastCutOff, isRideDay, lockExpiry, quoteFor, rideDays, slotsOf, unitsLeft } from "./rules.js";

// --- locks

export type LockRow = {
  id: string;
  ref: string;
  rider_id: string;
  hub: HubId;
  model: ModelId;
  finish: FinishId;
  state: LockState;
  issued_ms: number;
  expires_ms: number | null;
  ex_showroom_paise: number;
  road_tax_paise: number;
  insurance_paise: number;
  on_road_paise: number;
  step_effective_from: string;
  delivery_date: string | null;
  waiting_for: string | null;
  wait_seq: number | null;
  in_ledger: boolean;
  sheet_ready: boolean;
  wait_position: number | null;
};

export const LOCK_SELECT = `SELECT l.*, EXISTS(SELECT 1 FROM sheets s WHERE s.lock_id = l.id) AS sheet_ready,
  CASE WHEN l.waiting_for IS NOT NULL THEN 1 + (SELECT count(*) FROM locks w WHERE w.hub = l.hub AND w.waiting_for = l.waiting_for
    AND w.state = 'locked' AND w.wait_seq < l.wait_seq) END AS wait_position FROM locks l`;

export function serializeLock(row: LockRow, nowMs: number): Lock {
  const state = effectiveState(row, nowMs);
  const expires = row.expires_ms;
  return {
    id: row.id,
    state,
    hub: row.hub,
    model: row.model,
    finish: row.finish,
    ref: row.ref,
    issuedAt: isoIst(row.issued_ms),
    expiresAt: expires === null ? null : isoIst(expires),
    expiresLabel: expires === null ? null : expiryLabel(expires),
    hoursLeft: state === "locked" && expires !== null ? hoursLeft(expires, nowMs) : 0,
    exShowroomPaise: row.ex_showroom_paise,
    roadTaxPaise: row.road_tax_paise,
    insurancePaise: row.insurance_paise,
    onRoadPaise: row.on_road_paise,
    stepEffectiveFrom: row.step_effective_from,
    deliveryDate: row.delivery_date,
    sheetReady: row.sheet_ready,
    waitingFor: row.waiting_for,
    waitPosition: row.wait_position,
  };
}

export const lockById = async (id: string): Promise<LockRow | null> => (await q<LockRow>(`${LOCK_SELECT} WHERE l.id = $1`, [id]))[0] ?? null;

// --- rides

export type RideRow = { id: string; rider_id: string; hub: HubId; model: ModelId; starts_ms: number; state: RideState; moved_from_ms: number | null; booked_ms: number; licence_last4: string };

export function serializeRide(row: RideRow, nowMs: number): Ride {
  return {
    id: row.id,
    state: row.state,
    hub: row.hub,
    model: row.model,
    startsAt: isoIst(row.starts_ms),
    label: timeLabel(row.starts_ms),
    dayLabel: dayLabel(istDate(row.starts_ms), istDate(nowMs)),
    cutOffAt: isoIst(cutOffOf(row.starts_ms)),
    movedFrom: row.moved_from_ms === null ? null : isoIst(row.moved_from_ms),
  };
}

/** The states in which a ride holds its slot. */
export const TAKEN_SQL = "('booked','ridden','no_show')";

async function takenStarts(hub: HubId, fromMs: number, toMs: number): Promise<Set<number>> {
  const rows = await q<{ starts_ms: number }>(`SELECT starts_ms FROM rides WHERE hub=$1 AND state IN ${TAKEN_SQL} AND starts_ms >= $2 AND starts_ms < $3`, [hub, fromMs, toMs]);
  return new Set(rows.map((r) => r.starts_ms));
}

export async function slotsReply(hub: HubId, date: string, nowMs: number): Promise<SlotsReply> {
  const today = istDate(nowMs);
  const open = isRideDay(hub, date, nowMs);
  const base = { date, dayLabel: dayLabel(date, today), open };
  if (!open) return { ...base, slots: [] };
  const taken = await takenStarts(hub, istInstant(date, "00:00"), istInstant(addDays(date, 1), "00:00"));
  return {
    ...base,
    slots: slotsOf(date).map((ms) => ({
      startsAt: isoIst(ms),
      label: timeLabel(ms),
      state: isPastCutOff(ms, nowMs) ? "past_cut_off" : taken.has(ms) ? "taken" : "free",
    })),
  };
}

export const rideDaysReply = (hub: HubId, nowMs: number): { days: { date: string; dayLabel: string }[] } => {
  const today = istDate(nowMs);
  return { days: rideDays(hub, nowMs).map((date) => ({ date, dayLabel: dayLabel(date, today) })) };
};

// --- stock

type StockLine = { model: ModelId; finish: FinishId; onHand: number; held: number; unitsLeft: number };

/** The states in which a lock holds a unit and a rider's one lock per model. */
export const ACTIVE_SQL = "('requested','locked','delivery_set')";

/** A hold is an active lock, or an expired lock whose removal from the ledger is not yet confirmed. */
export const HELD_SQL = `(l.state IN ${ACTIVE_SQL} OR (l.state = 'expired' AND l.in_ledger))`;

export async function stockLines(hub: HubId): Promise<StockLine[]> {
  const rows = await q<{ model: ModelId; finish: FinishId; on_hand: number; held: number }>(
    `SELECT s.model, s.finish, s.on_hand, (SELECT count(*) FROM locks l WHERE l.hub = s.hub AND l.model = s.model AND l.finish = s.finish AND ${HELD_SQL}) AS held
     FROM stock s WHERE s.hub = $1`,
    [hub],
  );
  const order = (m: string, f: string): number => MODELS.findIndex((x) => x.id === m) * 10 + FINISHES.findIndex((x) => x.id === f);
  return rows
    .map((r) => ({ model: r.model, finish: r.finish, onHand: r.on_hand, held: r.held, unitsLeft: unitsLeft(r.on_hand, r.held) }))
    .sort((a, b) => order(a.model, a.finish) - order(b.model, b.finish));
}

// --- the live reading

async function nextFreeSlot(hub: HubId, nowMs: number): Promise<{ startsAt: string; label: string } | null> {
  const days = rideDays(hub, nowMs);
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return null;
  const taken = await takenStarts(hub, istInstant(first, "00:00"), istInstant(addDays(last, 1), "00:00"));
  for (const date of days) {
    for (const ms of slotsOf(date)) {
      if (!taken.has(ms) && !isPastCutOff(ms, nowMs)) return { startsAt: isoIst(ms), label: timeLabel(ms) };
    }
  }
  return null;
}

export async function readingFor(hub: HubId, model: ModelId, finish: FinishId, riderId: string | null, nowMs: number): Promise<Reading> {
  const [status, lines, nextSlot, lockRows] = await Promise.all([
    hubStatus(hub),
    stockLines(hub),
    nextFreeSlot(hub, nowMs),
    riderId
      ? q<LockRow>(`${LOCK_SELECT} WHERE l.rider_id = $1 AND l.hub = $2 AND l.model = $3 AND l.state IN ${ACTIVE_SQL}`, [riderId, hub, model])
      : Promise.resolve([] as LockRow[]),
  ]);
  const mine = lockRows[0] ? serializeLock(lockRows[0], nowMs) : null;
  const mineActive = mine && mine.state !== "expired" ? mine : null;
  const forModel = lines.filter((l) => l.model === model);
  const expires = lockExpiry(hub, nowMs);
  return {
    seq: status.seq,
    hub,
    model,
    finish,
    serverNow: isoIst(nowMs),
    stale: status.stale,
    staleReason: status.reason,
    stockAsOf: isoIst(status.asOfMs),
    stockAsOfLabel: asOfLabel(status.asOfMs, nowMs),
    unitsLeft: forModel.find((l) => l.finish === finish)?.unitsLeft ?? 0,
    finishes: forModel.map((l) => ({ finish: l.finish, unitsLeft: l.unitsLeft })),
    quote: quoteFor(hub, model, nowMs),
    nextSlot,
    lockPreview: { expiresAt: isoIst(expires), expiresLabel: expiryLabel(expires) },
    lock: mineActive,
    hoursLeft: mineActive?.hoursLeft ?? 0,
  };
}

