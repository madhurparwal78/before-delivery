// Hub host service: day sheet, held units, marks, stock counts.
import { pool, n, normaliseLockRow, normaliseRideRow, type LockRow, type RideRow } from "./db";
import { appNowMs, istDateOf, istStartOfDay, addDays, daysBetween } from "./clock";
import { bumpSeq, setStale } from "./store";
import * as ledger from "./ledger";
import { ApiError, throwApi } from "./errors";
import { FINISHES, MODELS} from "./seed";
import { cancelNoticesForLock, ensurePendingNotice } from "./notices";
import { renumberWaiters } from "./rides";

// ---------- day sheet ----------

export interface DaySheetRow {
  kind: "ride" | "handover";
  id: string;
  label: string;
  riderName: string;
  model: string;
  finish: string | null;
  licenceLast4: string | null;
  state: string;
  actions: string[];
}

export async function daySheet(host: { hub: string }, date: string): Promise<{
  hub: string;
  date: string;
  dayLabel: string;
  dates: { date: string; dayLabel: string }[];
  rows: DaySheetRow[];
}> {
  const now = appNowMs();
  const today = istDateOf(now);
  const dates: { date: string; dayLabel: string }[] = [];
  for (let i = -7; i <= 30; i++) {
    const d = addDays(today, i);
    dates.push({ date: d, dayLabel: dayLabelShort(d, today) });
  }
  const rows: DaySheetRow[] = [];
  // ride rows by start time ascending
  const rides = await pool.query(
    `SELECT r.*, u.name AS rider_name FROM rides r JOIN users u ON u.id = r.rider_id
     WHERE r.hub = $1 AND r.state IN ('booked','ridden','no_show') AND $2 <= r.starts_at_ms AND r.starts_at_ms < $3
     ORDER BY r.starts_at_ms ASC`,
    [host.hub, istStartOfDay(date), istStartOfDay(date) + 86400000]
  );
  for (const raw of rides.rows as (Record<string, unknown> & { rider_name: string })[]) {
    const r = { ...normaliseRideRow(raw), riderName: raw.rider_name };
    const start = n(r.starts_at_ms);
    rows.push({
      kind: "ride",
      id: r.id,
      label: slotTimeLabel(start),
      riderName: r.riderName,
      model: r.model,
      finish: null,
      licenceLast4: r.licence_last4,
      state: r.state,
      actions: rideActions(r, now),
    });
  }
  // handover rows by lock issue time ascending
  const locks = await pool.query(
    `SELECT l.*, u.name AS rider_name FROM locks l JOIN users u ON u.id = l.rider_id
     WHERE l.hub = $1 AND l.state IN ('delivery_set','delivered') AND l.delivery_date = $2
     ORDER BY l.issued_at_ms ASC`,
    [host.hub, date]
  );
  for (const raw of locks.rows as (Record<string, unknown> & { rider_name: string })[]) {
    const l = { ...normaliseLockRow(raw), riderName: raw.rider_name };
    rows.push({
      kind: "handover",
      id: l.id,
      label: "Handover",
      riderName: l.riderName,
      model: l.model,
      finish: l.finish,
      licenceLast4: null,
      state: l.state,
      actions: l.state === "delivery_set" ? ["delivered"] : [],
    });
  }
  return { hub: host.hub, date, dayLabel: dayLabelShort(date, today), dates, rows };
}

function rideActions(r: RideRow, now: number): string[] {
  if (r.state !== "booked") return [];
  return now >= n(r.starts_at_ms) ? ["ridden", "no_show"] : [];
}

export function slotTimeLabel(ms: number): string {
  const shifted = new Date(ms + 5.5 * 3600000);
  const h = shifted.getUTCHours();
  const m = shifted.getUTCMinutes();
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h < 12 ? "am" : "pm";
  return `${h12}:${String(m).padStart(2, "0")} ${ampm} IST`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayLabelShort(dateStr: string, todayStr: string): string {
  const diff = daysBetween(todayStr, dateStr);
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  if (diff === 0) return `Today, ${weekday} ${d} ${MONTHS[m - 1]}`;
  if (diff === 1) return `Tomorrow, ${weekday} ${d} ${MONTHS[m - 1]}`;
  return `${weekday} ${d} ${MONTHS[m - 1]}`;
}

// ---------- marks ----------

export async function hubRide(host: { hub: string }, rideId: string): Promise<RideRow> {
  const r = await pool.query(`SELECT * FROM rides WHERE id = $1`, [rideId]);
  if (!r.rowCount) throwApi(404, "not_found");
  const ride = normaliseRideRow(r.rows[0]);
  if (ride.hub !== host.hub) throwApi(404, "not_found");
  return ride;
}

export async function hubLock(host: { hub: string }, lockId: string): Promise<LockRow> {
  const r = await pool.query(`SELECT * FROM locks WHERE id = $1`, [lockId]);
  if (!r.rowCount) throwApi(404, "not_found");
  const lock = normaliseLockRow(r.rows[0] as Record<string, unknown>);
  if (lock.hub !== host.hub) throwApi(404, "not_found");
  return lock;
}

export async function markRide(host: { hub: string }, rideId: string, outcome: "ridden" | "no_show"): Promise<RideRow> {
  const ride = await hubRide(host, rideId);
  const now = appNowMs();
  if (ride.state !== "booked") throwApi(409, "illegal_state");
  if (now < n(ride.starts_at_ms)) throwApi(409, "too_early");
  // One outcome when two hosts mark one record: the update applies only from its state.
  const r = await pool.query(
    `UPDATE rides SET state = $2 WHERE id = $1 AND state = 'booked' RETURNING *`,
    [rideId, outcome]
  );
  if (!r.rowCount) throwApi(409, "illegal_state");
  return normaliseRideRow(r.rows[0]);
}

export async function markDelivered(host: { hub: string }, lockId: string): Promise<LockRow> {
  const lock = await hubLock(host, lockId);
  const now = appNowMs();
  if (lock.state !== "delivery_set") throwApi(409, "illegal_state");
  // Delivered on or after its delivery day in IST.
  if (now < istStartOfDay(lock.delivery_date ?? "")) throwApi(409, "too_early");
  if (await hubStaleNow(lock.hub)) throwApi(503, "hub_unreachable");
  // Delivered lowers onHand by 1 together with the hold.
  const updated = await pool.query(
    `UPDATE locks SET state = 'delivered' WHERE id = $1 AND state = 'delivery_set' RETURNING *`,
    [lockId]
  );
  if (!updated.rowCount) throwApi(409, "illegal_state");
  await ledger.releaseHold(lock.hub, lock.model, lock.finish, lock.ref).catch((e) => {
    throw new ApiError(503, "hub_unreachable");
  });
  await ledger.decOnHand(lock.hub, lock.model, lock.finish).catch((e) => {
    throw new ApiError(503, "hub_unreachable");
  });
  await bumpSeq(lock.hub);
  return normaliseLockRow(updated.rows[0] as Record<string, unknown>);
}

async function hubStaleNow(hub: string): Promise<boolean> {
  const r = await pool.query(`SELECT stale_reason FROM hub_state WHERE hub = $1`, [hub]);
  return r.rowCount ? (r.rows[0] as { stale_reason: string | null }).stale_reason !== null : true;
}

export async function confirmUnit(host: { hub: string }, lockId: string): Promise<LockRow> {
  const lock = await hubLock(host, lockId);
  if (lock.state === "expired") throwApi(409, "lock_expired");
  if (lock.state !== "requested") throwApi(409, "illegal_state");
  if (await hubStaleNow(lock.hub)) throwApi(503, "hub_unreachable");
  const r = await pool.query(
    `UPDATE locks SET state = 'locked' WHERE id = $1 AND state = 'requested' RETURNING *`,
    [lockId]
  );
  if (!r.rowCount) throwApi(409, "illegal_state");
  const updated = normaliseLockRow(r.rows[0] as Record<string, unknown>);
  await ensurePendingNotice({
    riderId: lock.rider_id,
    kind: "lock_ending",
    dueAtMs: istStartOfDay(istDateOf(n(updated.expires_at_ms ?? 0))) + 12 * 3600000,
    lockId: lock.id,
    dedupeKey: `lock-end-${lock.id}`,
  });
  await bumpSeq(lock.hub);
  return updated;
}

export async function refuseUnit(host: { hub: string }, lockId: string): Promise<LockRow> {
  const lock = await hubLock(host, lockId);
  if (lock.state === "expired") throwApi(409, "lock_expired");
  if (lock.state !== "requested") throwApi(409, "illegal_state");
  if (await hubStaleNow(lock.hub)) throwApi(503, "hub_unreachable");
  // Refusal means the unit left the floor: onHand falls by 1 together with the hold.
  const r = await pool.query(`UPDATE locks SET state = 'refused' WHERE id = $1 AND state = 'requested' RETURNING *`, [lockId]);
  if (!r.rowCount) throwApi(409, "illegal_state");
  await ledger.releaseHold(lock.hub, lock.model, lock.finish, lock.ref).catch(() => {
    throw new ApiError(503, "hub_unreachable");
  });
  await ledger.decOnHand(lock.hub, lock.model, lock.finish).catch(() => {
    throw new ApiError(503, "hub_unreachable");
  });
  await bumpSeq(lock.hub);
  return normaliseLockRow(r.rows[0] as Record<string, unknown>);
}

// Withdrawal: one transition does all of this together.
export async function withdrawUnit(host: { hub: string }, lockId: string): Promise<LockRow> {
  const lock = await hubLock(host, lockId);
  if (lock.state === "expired") throwApi(409, "lock_expired");
  if (lock.state !== "locked" && lock.state !== "delivery_set") throwApi(409, "illegal_state");
  if (await hubStaleNow(lock.hub)) throwApi(503, "hub_unreachable");
  const r = await pool.query(
    `UPDATE locks SET state = 'withdrawn', waiting_for = NULL, wait_position = NULL, joined_line_ms = NULL
     WHERE id = $1 AND state IN ('locked','delivery_set') RETURNING *`,
    [lockId]
  );
  if (!r.rowCount) throwApi(409, "illegal_state");
  const updated = normaliseLockRow(r.rows[0] as Record<string, unknown>);
  // 1. the hold stops; 2. onHand falls; 3. the delivery place is freed, then promoted.
  await ledger.releaseHold(lock.hub, lock.model, lock.finish, lock.ref).catch(() => {
    throw new ApiError(503, "hub_unreachable");
  });
  await ledger.decOnHand(lock.hub, lock.model, lock.finish).catch(() => {
    throw new ApiError(503, "hub_unreachable");
  });
  if (lock.delivery_date !== null) {
    await ledger.removePlace(lock.hub, lock.delivery_date, lock.ref).catch(() => {
      throw new ApiError(503, "hub_unreachable");
    });
    await promoteWaiter(lock.hub, lock.delivery_date);
  }
  await cancelNoticesForLock(lockId);
  await bumpSeq(lock.hub);
  return updated;
}

// A place freed by a withdrawal goes to the earliest waiter with no moment when it
// is open, atomically in the ledger and Postgres.
export async function promoteWaiter(hub: string, date: string): Promise<void> {
  const rawWaiters = (
    await pool.query(
      `SELECT * FROM locks WHERE hub = $1 AND waiting_for = $2 AND state = 'locked'
       ORDER BY joined_line_ms ASC LIMIT 1`,
      [hub, date]
    )
  ).rows as Record<string, unknown>[];
  const earliest = rawWaiters.map(normaliseLockRow);
  if (earliest.length === 0) return;
  const winner = earliest[0];
  const cap = deliveryCapacityFor(hub, date);
  const gate = await ledger.claimPlace(hub, date, winner.ref, cap);
  if (gate !== 1) {
    // the place stays held for the waiter; retry on the next sweep
    return;
  }
  const r = await pool.query(
    `UPDATE locks SET delivery_date = $2, state = 'delivery_set', expires_at_ms = NULL,
       waiting_for = NULL, wait_position = NULL, joined_line_ms = NULL
     WHERE id = $1 AND state = 'locked' AND waiting_for = $2 RETURNING *`,
    [winner.id, date]
  );
  if (!r.rowCount) {
    await ledger.removePlace(hub, date, winner.ref).catch(() => {});
    return;
  }
  await ledger.setHoldScoreInfinity(hub, winner.model, winner.finish, winner.ref).catch(() => {});
  await renumberWaiters(hub, date);
  await cancelNoticesForLock(winner.id);
  // a delivery_place notice goes once to an opted-in rider
  const user = (await pool.query(`SELECT reminders_on FROM users WHERE id = $1`, [winner.rider_id])).rows[0] as
    | { reminders_on: boolean }
    | undefined;
  if (user?.reminders_on) {
    await ensurePendingNotice({
      riderId: winner.rider_id,
      kind: "delivery_place",
      dueAtMs: appNowMs(),
      lockId: winner.id,
      dedupeKey: `delivery-place-${winner.id}`,
    });
  }
  await bumpSeq(hub);
}

function deliveryCapacityFor(hub: string, date: string): number {
  return date === "2026-11-06" ? 12 : 4;
}

// ---------- held units ----------

export async function heldUnits(host: { hub: string }): Promise<
  { id: string; riderName: string; model: string; finish: string; state: string; expiresLabel: string | null; deliveryDate: string | null; waitingFor: string | null; actions: string[] }[]
> {
  const rows = await pool.query(
    `SELECT l.*, u.name AS rider_name FROM locks l JOIN users u ON u.id = l.rider_id
     WHERE l.hub = $1 AND l.state IN ('requested','locked','delivery_set')
     ORDER BY l.issued_at_ms ASC`,
    [host.hub]
  );
  const out: {
    id: string; riderName: string; model: string; finish: string; state: string;
    expiresLabel: string | null; deliveryDate: string | null; waitingFor: string | null; actions: string[];
  }[] = [];
  for (const raw of rows.rows as (Record<string, unknown> & { rider_name: string })[]) {
    const l = { ...normaliseLockRow(raw), riderName: raw.rider_name };
    out.push({
      id: l.id,
      riderName: l.riderName,
      model: l.model,
      finish: l.finish,
      state: l.state,
      expiresLabel:
        l.state === "delivery_set"
          ? null
          : l.expires_at_ms !== null
            ? expiresLabelFor(n(l.expires_at_ms))
            : null,
      deliveryDate: l.delivery_date,
      waitingFor: l.waiting_for,
      actions: l.state === "requested" ? ["confirm", "refuse"] : ["withdraw"],
    });
  }
  return out;
}

function expiresLabelFor(ms: number): string {
  const shifted = new Date(ms + 5.5 * 3600000);
  const d = shifted.getUTCDate();
  const mon = MONTHS[shifted.getUTCMonth()];
  const h = shifted.getUTCHours();
  const m = shifted.getUTCMinutes();
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h < 12 ? "am" : "pm";
  return `${d} ${mon}, ${h12}:${String(m).padStart(2, "0")} ${ampm} IST`;
}

// ---------- stock counts ----------

export async function startStockCount(host: { hub: string }): Promise<void> {
  const r = await pool.query(`UPDATE hub_state SET counting = true WHERE hub = $1 AND counting = false RETURNING hub`, [host.hub]);
  if (!r.rowCount) throwApi(409, "illegal_state");
  await setStale(host.hub, "count");
  await bumpSeq(host.hub);
}

export async function finishStockCount(host: { hub: string }, units: { model: string; finish: string; onHand: number }[]): Promise<void> {
  const counting = await pool.query(`SELECT counting FROM hub_state WHERE hub = $1`, [host.hub]);
  if (!counting.rowCount || !(counting.rows[0] as { counting: boolean }).counting) {
    throwApi(409, "illegal_state");
  }
  // six rows exactly
  const expected = new Set<string>();
  for (const m of MODELS) for (const f of FINISHES) expected.add(`${m.id}:${f.id}`);
  if (!Array.isArray(units) || units.length !== 6) throwApi(422, "invalid_body");
  for (const row of units) {
    const key = `${row.model}:${row.finish}`;
    if (!expected.has(key)) throwApi(422, "invalid_body");
    if (!Number.isInteger(row.onHand) || row.onHand < 0) throwApi(422, "invalid_body");
    expected.delete(key);
  }
  if (expected.size > 0) throwApi(422, "invalid_body");
  if (await hubStaleNow(host.hub)) {
    // The ledger may be out; the count stays open.
    if ((await ledgerReadStale(host.hub))) throwApi(503, "hub_unreachable");
  }
  for (const row of units) {
    await pool.query(`UPDATE on_hand SET on_hand = $4 WHERE hub = $1 AND model = $2 AND finish = $3`, [
      host.hub,
      row.model,
      row.finish,
      row.onHand,
    ]);
    await ledger.writeOnHand(host.hub, row.model, row.finish, row.onHand).catch(() => {
      throw new ApiError(503, "hub_unreachable");
    });
  }
  await pool.query(`UPDATE hub_state SET counting = false, stock_as_of_ms = $2::bigint WHERE hub = $1`, [host.hub, String(appNowMs())]);
  await setStale(host.hub, null);
  await bumpSeq(host.hub);
}

async function ledgerReadStale(hub: string): Promise<boolean> {
  try {
    return !(await ledger.ledgerTestWrite());
  } catch {
    return true;
  }
}

export { ledger };
