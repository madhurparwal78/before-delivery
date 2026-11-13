// The store is the one place that turns database rows into live readings,
// sequences and staleness, and that decides units left.
import { pool, n, normaliseLockRow, type LockRow, type RideRow, type UserRow } from "./db";
import * as ledger from "./ledger";
import {
  appNowMs,
  formatExpiresLabel,
  formatStockLabel,
  istDateOf,
  
  toIsoIst} from "./clock";
import {
  bookableDates,
  computeQuote,
  computeLockExpiry,
  deliveryCapacity,
  deliveryClosingMs,
  isClosedDay,
  pastCutOff,
  slotsForDay,
  unitsLeft} from "./domain";
import {
  CHAPTERS,
  EARLIER_SALES,
  FINISHES,
  HUBS,
  MODELS,
  hubById,
  modelById} from "./seed";

import { throwApi } from "./errors";
import { formatSlotLabel } from "./clock";

export interface HubStateRow {
  hub: string;
  seq: number;
  counting: boolean;
  stock_as_of_ms: number;
  stale_reason: string | null;
  stale_since_ms: number | null;
}

export interface LiveReading {
  seq: number;
  hub: string;
  model: string;
  finish: string;
  serverNow: string;
  stale: boolean;
  staleReason: string | null;
  stockAsOf: string;
  stockAsOfLabel: string;
  unitsLeft: number;
  finishes: { finish: string; unitsLeft: number }[];
  quote: Quote;
  nextSlot: { startsAt: string; label: string } | null;
  lockPreview: { expiresAt: string; expiresLabel: string } | null;
  lock: LockJson | null;
  hoursLeft: number;
}

import type { Quote } from "./domain";

export interface LockJson {
  id: string;
  state: string;
  hub: string;
  model: string;
  finish: string;
  ref: string;
  issuedAt: string;
  expiresAt: string | null;
  expiresLabel: string | null;
  hoursLeft: number;
  exShowroomPaise: number;
  roadTaxPaise: number;
  insurancePaise: number;
  onRoadPaise: number;
  stepEffectiveFrom: string;
  deliveryDate: string | null;
  sheetReady: boolean;
  waitingFor: string | null;
  waitPosition: number | null;
}

export interface RideJson {
  id: string;
  state: string;
  hub: string;
  model: string;
  startsAt: string;
  label: string;
  dayLabel: string;
  cutOffAt: string;
  movedFrom: string | null;
}

export interface UserJson {
  id: string;
  role: string;
  name: string;
  mobile: string;
  hub: string | null;
  licenceNumber: string | null;
  licenceValidUntil: string | null;
  remindersOn: boolean;
}

// ---------- helpers ----------

export async function hubState(hub: string): Promise<HubStateRow> {
  const r = await pool.query(`SELECT * FROM hub_state WHERE hub = $1`, [hub]);
  if (r.rowCount === 0) throwApi(404, "not_found");
  const row = r.rows[0] as HubStateRow;
  return { ...row, seq: n(row.seq), stock_as_of_ms: n(row.stock_as_of_ms) };
}

export async function bumpSeq(hub: string): Promise<number> {
  const r = await pool.query(
    `UPDATE hub_state SET seq = seq + 1 WHERE hub = $1 RETURNING seq`,
    [hub]
  );
  const seq = n(r.rows[0].seq);
  // the fan-out hint rides on the published channel; a message is only a hint
  await ledger.publishHubChange(hub, seq);
  return seq;
}

export async function seqOf(hub: string): Promise<number> {
  const r = await pool.query(`SELECT seq FROM hub_state WHERE hub = $1`, [hub]);
  return r.rowCount === 0 ? 0 : n(r.rows[0].seq);
}

export async function setStale(hub: string, reason: "system" | "count" | null): Promise<void> {
  await pool.query(`UPDATE hub_state SET stale_reason = $2 WHERE hub = $1`, [hub, reason]);
  if (reason === null) {
    await pool.query(`UPDATE hub_state SET stale_since_ms = NULL WHERE hub = $1`, [hub]);
  } else {
    await pool.query(`UPDATE hub_state SET stale_since_ms = $2::bigint WHERE hub = $1`, [hub, String(appNowMs())]);
  }
}

export async function markStockAsOf(hub: string): Promise<void> {
  await pool.query(`UPDATE hub_state SET stock_as_of_ms = $2::bigint WHERE hub = $1`, [hub, String(appNowMs())]);
}

// ---------- units left ----------

export interface HoldSnapshot {
  [hub: string]: { [model: string]: { [finish: string]: number } };
}

// units left = onHand minus this product's holds, never below 0.
// A hold is a lock in requested, locked or delivery_set, or an expired lock whose
// removal from the ledger has not yet been confirmed.
export async function holdsByModelFinish(hub: string): Promise<{ key: string; count: number }[]> {
  // Active holds from Postgres.
  const r = await pool.query(
    `SELECT model, finish, count(*)::int AS c FROM locks
     WHERE hub = $1 AND state IN ('requested','locked','delivery_set')
     GROUP BY model, finish`,
    [hub]
  );
  const out = new Map<string, number>();
  for (const row of r.rows as { model: string; finish: string; c: number }[]) {
    out.set(`${row.model}:${row.finish}`, row.c);
  }
  // Expired locks whose ledger member removal is unconfirmed: they still count as holds.
  // The ledger trim happens on the sweep; Postgres state is the fallback truth.
  return [...out.entries()].map(([key, count]) => ({ key, count }));
}

export async function onHandMap(hub: string): Promise<Map<string, number>> {
  const r = await pool.query(`SELECT model, finish, on_hand FROM on_hand WHERE hub = $1`, [hub]);
  const m = new Map<string, number>();
  for (const row of r.rows as { model: string; finish: string; on_hand: number }[]) {
    m.set(`${row.model}:${row.finish}`, n(row.on_hand));
  }
  return m;
}

export async function unitsLeftForFinish(hub: string, model: string, finish: string): Promise<number> {
  const [onHandRow] = (
    await pool.query(`SELECT on_hand FROM on_hand WHERE hub = $1 AND model = $2 AND finish = $3`, [hub, model, finish])
  ).rows as { on_hand: number }[];
  const holdsRow = (
    await pool.query(
      `SELECT count(*)::int AS c FROM locks
       WHERE hub = $1 AND model = $2 AND finish = $3
         AND state IN ('requested','locked','delivery_set')`,
      [hub, model, finish]
    )
  ).rows as { c: number }[];
  return unitsLeft(n(onHandRow?.on_hand ?? 0), n(holdsRow[0]?.c ?? 0));
}

// ---------- live reading ----------

export function lockToJson(row: LockRow, nowMs: number): LockJson {
  let hoursLeft = 0;
  if (row.expires_at_ms !== null && row.state === "locked") {
    const remaining = row.expires_at_ms - nowMs;
    hoursLeft = remaining <= 0 ? 0 : Math.ceil(remaining / 3600000);
  }
  return {
    id: row.id,
    state: row.state,
    hub: row.hub,
    model: row.model,
    finish: row.finish,
    ref: row.ref,
    issuedAt: toIsoIst(row.issued_at_ms),
    expiresAt: row.expires_at_ms !== null ? toIsoIst(row.expires_at_ms) : null,
    expiresLabel: row.expires_at_ms !== null ? formatExpiresLabel(row.expires_at_ms) : null,
    hoursLeft,
    exShowroomPaise: n(row.ex_showroom_paise),
    roadTaxPaise: n(row.road_tax_paise),
    insurancePaise: n(row.insurance_paise),
    onRoadPaise: n(row.on_road_paise),
    stepEffectiveFrom: typeof row.step_effective_from === "string" ? row.step_effective_from : String(row.step_effective_from),
    deliveryDate: row.delivery_date,
    sheetReady: row.sheet_ready,
    waitingFor: row.waiting_for,
    waitPosition: row.wait_position};
}

export function rideToJson(row: RideRow, nowMs: number): RideJson {
  const today = istDateOf(nowMs);
  return {
    id: row.id,
    state: row.state,
    hub: row.hub,
    model: row.model,
    startsAt: toIsoIst(row.starts_at_ms),
    label: formatSlotLabel(row.starts_at_ms),
    dayLabel: dayLabelOf(row.hub, istDateOf(row.starts_at_ms), today),
    cutOffAt: toIsoIst(row.starts_at_ms - 2 * 3600000),
    movedFrom: row.moved_from_ms !== null ? toIsoIst(row.moved_from_ms) : null};
}

export function dayLabelOf(hub: string, dateStr: string, todayStr: string): string {
  const diff = dateDiff(todayStr, dateStr);
  const weekday = weekdayOf(dateStr);
  const d = Number(dateStr.slice(8, 10));
  const mon = MONTHS[Number(dateStr.slice(5, 7)) - 1];
  if (diff === 0) return `Today, ${weekday} ${d} ${mon}`;
  if (diff === 1) return `Tomorrow, ${weekday} ${d} ${mon}`;
  return `${weekday} ${d} ${mon}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function weekdayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function dateDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function userToJson(row: UserRow): UserJson {
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    mobile: row.mobile,
    hub: row.hub,
    licenceNumber: row.licence_number,
    licenceValidUntil: row.licence_valid_until,
    remindersOn: row.reminders_on};
}

// The live reading for a selection. A stale hub does not make the quote stale.
export async function liveReading(
  hub: string,
  model: string,
  finish: string,
  caller: { id: string; role: string } | null
): Promise<LiveReading> {
  if (!hubById(hub)) throwApi(404, "not_found");
  if (!modelById(model)) throwApi(422, "invalid_body");
  if (!FINISHES.some((f) => f.id === finish)) throwApi(422, "invalid_body");
  const now = appNowMs();
  const state = await hubState(hub);
  const quote = computeQuote(model, hub, now);

  // stock per finish
  const finishesLeft: { finish: string; unitsLeft: number }[] = [];
  for (const f of FINISHES) {
    finishesLeft.push({ finish: f.id, unitsLeft: await unitsLeftForFinish(hub, model, f.id) });
  }
  const unitsLeftNow = finishesLeft.find((f) => f.finish === finish)?.unitsLeft ?? 0;

  // next free slot
  const dates = bookableDates(hub, now);
  let nextSlot: { startsAt: string; label: string } | null = null;
  const takenKeys = new Set<string>();
  const rides = await pool.query(
    `SELECT hub, starts_at_ms FROM rides WHERE hub = $1 AND state = 'booked'`,
    [hub]
  );
  for (const row of rides.rows as { starts_at_ms: number }[]) {
    takenKeys.add(slotKeyOf(n(row.starts_at_ms)));
  }
  outer: for (const date of dates) {
    for (const start of slotsForDay(hub, date)) {
      if (pastCutOff(start, now)) continue;
      if (takenKeys.has(slotKeyOf(start))) continue;
      nextSlot = { startsAt: toIsoIst(start), label: formatSlotLabel(start) };
      break outer;
    }
  }

  // lock preview: the same expiry rule applied to the current instant
  const previewExpiry = computeLockExpiry(now, hub);
  const lockPreview = { expiresAt: toIsoIst(previewExpiry), expiresLabel: formatExpiresLabel(previewExpiry) };

  // the caller's active lock at this hub on this model
  let lock: LockJson | null = null;
  if (caller && caller.role === "rider") {
    const r = await pool.query(
      `SELECT * FROM locks WHERE rider_id = $1 AND hub = $2 AND model = $3
        AND state IN ('requested','locked','delivery_set')`,
      [caller.id, hub, model]
    );
    if (r.rowCount && r.rowCount > 0) {
      lock = lockToJson(normaliseLockRow(r.rows[0] as Record<string, unknown>), now);
    }
  }

  return {
    seq: state.seq,
    hub,
    model,
    finish,
    serverNow: toIsoIst(now),
    stale: state.stale_reason !== null,
    staleReason: state.stale_reason,
    stockAsOf: toIsoIst(state.stock_as_of_ms),
    stockAsOfLabel: formatStockLabel(state.stock_as_of_ms, now),
    unitsLeft: unitsLeftNow,
    finishes: finishesLeft,
    quote,
    nextSlot,
    lockPreview,
    lock,
    hoursLeft: lock !== null ? lock.hoursLeft : 0};
}

export function slotLabel(ms: number): string {
  return formatSlotLabel(ms);
}

export function slotKeyOf(ms: number): string {
  const d = istDateOf(ms);
  const shifted = new Date(ms + 5.5 * 3600000);
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${d}T${hh}:${mm}`;
}

// The stock table for a hub: six rows.
export async function hubStock(hub: string): Promise<{
  hub: string;
  counting: boolean;
  stockAsOf: string;
  stockAsOfLabel: string;
  units: { model: string; finish: string; onHand: number; held: number; unitsLeft: number }[];
}> {
  const state = await hubState(hub);
  const now = appNowMs();
  const units: { model: string; finish: string; onHand: number; held: number; unitsLeft: number }[] = [];
  for (const m of MODELS) {
    for (const f of FINISHES) {
      const onHand = await onHandFor(hub, m.id, f.id);
      const held = await holdCount(hub, m.id, f.id);
      units.push({ model: m.id, finish: f.id, onHand, held, unitsLeft: unitsLeft(onHand, held) });
    }
  }
  return {
    hub,
    counting: state.counting,
    stockAsOf: toIsoIst(state.stock_as_of_ms),
    stockAsOfLabel: formatStockLabel(state.stock_as_of_ms, now),
    units};
}

async function onHandFor(hub: string, model: string, finish: string): Promise<number> {
  const r = await pool.query(`SELECT on_hand FROM on_hand WHERE hub = $1 AND model = $2 AND finish = $3`, [hub, model, finish]);
  return r.rowCount ? n(r.rows[0].on_hand) : 0;
}

async function holdCount(hub: string, model: string, finish: string): Promise<number> {
  const r = await pool.query(
    `SELECT count(*)::int AS c FROM locks
     WHERE hub = $1 AND model = $2 AND finish = $3 AND state IN ('requested','locked','delivery_set')`,
    [hub, model, finish]
  );
  return n(r.rows[0].c);
}

export { CHAPTERS, EARLIER_SALES, HUBS, MODELS, FINISHES, isClosedDay, deliveryCapacity, deliveryClosingMs };
