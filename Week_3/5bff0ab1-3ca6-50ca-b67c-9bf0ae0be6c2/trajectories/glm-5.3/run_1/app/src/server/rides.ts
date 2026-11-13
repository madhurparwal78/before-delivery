// The rider service: price locks, delivery days, wait lines, rides.
// A claim passes an atomic gate on its ledger key and then commits in Postgres.
// A failed commit undoes the gate.
import { pool, newId, newRef, n, normaliseLockRow, normaliseRideRow, type LockRow, type RideRow } from "./db";
import {
  appNowMs,
  istDateOf,
  istStartOfDay,
  
  
  addDays,
  
  parseIsoTime} from "./clock";
import * as ledger from "./ledger";
import {
  computeLockExpiry,
  computeQuote,
  deliveryCapacity,
  
  deliveryDayClosed,
  insideBookablePattern,
  insideDeliveryWindow,
  isClosedDay,
  normaliseLicence,
  pastCutOff,
  
  validLicenceNumber,
  licenceValidFor,
  unitsLeft} from "./domain";
import { bumpSeq} from "./store";
import { ApiError, throwApi } from "./errors";

import { cancelNoticesForLock, cancelNoticesForRide, ensurePendingNotice } from "./notices";

// ---------- price lock claims ----------

export async function activeLockForRider(riderId: string, model: string): Promise<LockRow | null> {
  const r = await pool.query(
    `SELECT * FROM locks WHERE rider_id = $1 AND model = $2 AND state IN ('requested','locked','delivery_set') LIMIT 1`,
    [riderId, model]
  );
  return r.rowCount ? normaliseLockRow(r.rows[0] as Record<string, unknown>) : null;
}

export interface LockClaimInput {
  hub: string;
  model: string;
  finish: string;
  stepEffectiveFrom: string;
}

// POST /api/locks
export async function claimLock(riderId: string, body: LockClaimInput): Promise<{ status: number; lock: LockRow }> {
  const now = appNowMs();
  // Replay: the rider's active lock on this model returns before any state check.
  const existing = await activeLockForRider(riderId, body.model);
  if (existing) {
    if (existing.hub === body.hub && existing.finish === body.finish) {
      return { status: existing.state === "requested" ? 202 : 200, lock: existing };
    }
    throwApi(409, "lock_exists_other_finish");
  }
  // A finish already at 0 units gets 409 none_left before anything else.
  const left = await unitsLeftAt(body.hub, body.model, body.finish, now);
  if (left <= 0) throwApi(409, "none_left");
  // Price comparison: no price is accepted from a client, this is a comparison only.
  const quote = computeQuote(body.model, body.hub, now);
  if (body.stepEffectiveFrom !== quote.stepEffectiveFrom) throwApi(409, "price_moved");
  // Stale hub: claims are refused.
  if (await hubStale(body.hub)) throwApi(503, "hub_unreachable");

  const ref = newRef();
  const expiresAt = computeLockExpiry(now, body.hub);
  const isLastUnit = left === 1;
  const id = newId("lock");
  // Ledger gate: the claim passes the atomic gate, then commits in Postgres.
  // Right after the prefix's keys are deleted, the gate finds them rebuilt from
  // Postgres, so no claim wins what a record already holds.
  const gate = await ledger.claimHold(body.hub, body.model, body.finish, ref, expiresAt).catch(() => -1);
  if (gate === 0) throwApi(409, "none_left");
  if (gate < 0) {
    // the on-hand key may be missing: rebuild it from Postgres and retry once
    const healthy = await ledger.onHandKeyHealthy(body.hub, body.model, body.finish).catch(() => false);
    if (!healthy) {
      const pgRow = (
        await pool.query(`SELECT on_hand FROM on_hand WHERE hub = $1 AND model = $2 AND finish = $3`, [
          body.hub,
          body.model,
          body.finish,
        ])
      ).rows[0] as { on_hand: number } | undefined;
      const value = pgRow ? n(pgRow.on_hand) : 0;
      try {
        await ledger.writeOnHand(body.hub, body.model, body.finish, value);
      } catch {
        throwApi(503, "hub_unreachable");
      }
      const retry = await ledger.claimHold(body.hub, body.model, body.finish, ref, expiresAt).catch(() => -1);
      if (retry === 0) throwApi(409, "none_left");
      if (retry < 0) throwApi(503, "hub_unreachable");
    } else {
      throwApi(503, "hub_unreachable");
    }
  }
  try {
    const state = isLastUnit ? "requested" : "locked";
    const r = await pool.query(
      `INSERT INTO locks (id, ref, rider_id, hub, model, finish, state, issued_at_ms, expires_at_ms,
        step_effective_from, ex_showroom_paise, road_tax_paise, insurance_paise, on_road_paise)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        id,
        ref,
        riderId,
        body.hub,
        body.model,
        body.finish,
        state,
        now,
        expiresAt,
        quote.stepEffectiveFrom,
        quote.exShowroomPaise,
        quote.roadTaxPaise,
        quote.insurancePaise,
        quote.onRoadPaise,
      ]
    );
    const lock = normaliseLockRow(r.rows[0] as Record<string, unknown>);
    await bumpSeq(body.hub);
    if (!isLastUnit) {
      await ensureLockEndingNotice(lock);
    }
    return { status: isLastUnit ? 202 : 201, lock };
  } catch (e) {
    // a failed commit undoes the gate
    await ledger.releaseHold(body.hub, body.model, body.finish, ref).catch(() => {});
    throw e;
  }
}

async function ensureLockEndingNotice(lock: LockRow): Promise<void> {
  if (lock.state !== "locked") return;
  // Lock ending goes at 12:00 IST on the expiry date, while the lock is still locked.
  const expiryMs = n(lock.expires_at_ms ?? 0);
  const dueAt = istStartOfDay(istDateOf(expiryMs)) + 12 * 3600000;
  await ensurePendingNotice({
    riderId: lock.rider_id,
    kind: "lock_ending",
    dueAtMs: dueAt,
    lockId: lock.id,
    dedupeKey: `lock-end-${lock.id}`});
}

async function unitsLeftAt(hub: string, model: string, finish: string, now: number): Promise<number> {
  const onHandRow = (
    await pool.query(`SELECT on_hand FROM on_hand WHERE hub = $1 AND model = $2 AND finish = $3`, [hub, model, finish])
  ).rows[0] as { on_hand: number } | undefined;
  const holdRow = (
    await pool.query(
      `SELECT count(*)::int AS c FROM locks WHERE hub = $1 AND model = $2 AND finish = $3
        AND state IN ('requested','locked','delivery_set')`,
      [hub, model, finish]
    )
  ).rows[0] as { c: number };
  return unitsLeft(n(onHandRow?.on_hand ?? 0), n(holdRow.c));
}

// A hub's claims are refused when the ledger is unreachable. During a stock count
// only lock claims pause; rides, delivery days and releases work as usual.
async function hubStale(hub: string): Promise<boolean> {
  const r = await pool.query(`SELECT stale_reason FROM hub_state WHERE hub = $1`, [hub]);
  return r.rowCount ? (r.rows[0] as { stale_reason: string | null }).stale_reason !== null : true;
}

async function hubSystemStale(hub: string): Promise<boolean> {
  const r = await pool.query(`SELECT stale_reason FROM hub_state WHERE hub = $1`, [hub]);
  return r.rowCount ? (r.rows[0] as { stale_reason: string | null }).stale_reason === "system" : true;
}

export async function releaseLock(riderId: string, lockId: string): Promise<LockRow> {
  const lock = await riderLock(riderId, lockId);
  // Acting on an expired lock gets lock_expired; any other non-locked state is illegal_state.
  if (lock.state === "expired") throwApi(409, "lock_expired");
  if (lock.state !== "locked") throwApi(409, "illegal_state");
  // The lock becomes released only once the ledger confirms removal.
  await ledger.releaseHold(lock.hub, lock.model, lock.finish, lock.ref).catch((e) => {
    throw ledgerOutage(e);
  });
  const r = await pool.query(
    `UPDATE locks SET state = 'released', waiting_for = NULL, wait_position = NULL, joined_line_ms = NULL
     WHERE id = $1 AND state = 'locked' RETURNING *`,
    [lockId]
  );
  if (!r.rowCount) throwApi(409, "illegal_state");
  await bumpSeq(lock.hub);
  await cancelNoticesForLock(lockId);
  return normaliseLockRow(r.rows[0] as Record<string, unknown>);
}

function ledgerOutage(e: unknown): ApiError {
  return new ApiError(503, "hub_unreachable");
}

export async function riderLock(riderId: string, lockId: string): Promise<LockRow> {
  const r = await pool.query(`SELECT * FROM locks WHERE id = $1`, [lockId]);
  if (!r.rowCount) throwApi(404, "not_found");
  const lock = normaliseLockRow(r.rows[0] as Record<string, unknown>);
  if (lock.rider_id !== riderId) throwApi(404, "not_found");
  return lock;
}

// ---------- delivery days ----------

export interface DeliveryDayRow {
  date: string;
  dayLabel: string;
  capacity: number;
  placesLeft: number;
  state: "closed" | "full" | "open";
}

export async function deliveryDays(lock: LockRow): Promise<DeliveryDayRow[]> {
  const now = appNowMs();
  const issueDate = istDateOf(n(lock.issued_at_ms));
  const dates: string[] = [];
  for (let i = 3; i <= 30; i++) dates.push(addDays(issueDate, i));
  const rows: DeliveryDayRow[] = [];
  for (const date of dates) {
    const cap = deliveryCapacity(lock.hub, date);
    const taken = await placesTaken(lock.hub, date);
    const placesLeft = Math.max(0, cap - taken);
    const closed = deliveryDayClosed(lock.hub, date, now);
    const weekday = weekdayShort(date);
    const label = `${weekday} ${Number(date.slice(8, 10))} ${monthShort(date)}`;
    rows.push({
      date,
      dayLabel: label,
      capacity: cap,
      placesLeft: closed ? (placesLeft === 0 ? 0 : placesLeft) : placesLeft,
      state: closed ? "closed" : placesLeft === 0 ? "full" : "open"});
  }
  return rows;
}

async function placesTaken(hub: string, date: string): Promise<number> {
  // Places taken are the seeded earlier sales plus the delivery_set and delivered locks.
  const earlier = (
    await pool.query(`SELECT value FROM app_state WHERE key = $1`, [`earlier-sales:${hub}:${date}`])
  ).rows[0] as { value: string } | undefined;
  const locksRow = (
    await pool.query(
      `SELECT count(*)::int AS c FROM locks WHERE hub = $1 AND delivery_date = $2 AND state IN ('delivery_set','delivered')`,
      [hub, date]
    )
  ).rows[0] as { c: number };
  return n(earlier?.value ?? 0) + n(locksRow.c);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function weekdayShort(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
function monthShort(dateStr: string): string {
  return MONTHS[Number(dateStr.slice(5, 7)) - 1];
}

export async function setDeliveryDay(riderId: string, lockId: string, date: string): Promise<LockRow> {
  const lock = await riderLock(riderId, lockId);
  const now = appNowMs();
  // Replay of the same day on a delivery_set lock returns before any refusal.
  if (lock.state === "delivery_set" && lock.delivery_date === date) {
    return lock;
  }
  if (n(lock.expires_at_ms ?? 0) !== 0 && n(lock.expires_at_ms ?? 0) <= now) {
    throwApi(409, "lock_expired");
  }
  if (lock.state !== "locked") throwApi(409, "illegal_state");
  const issueDate = istDateOf(n(lock.issued_at_ms));
  if (!insideDeliveryWindow(issueDate, date) || isClosedDay(lock.hub, date)) {
    throwApi(409, "delivery_day_closed");
  }
  if (deliveryDayClosed(lock.hub, date, now)) throwApi(409, "delivery_day_closed");
  if (await placesTaken(lock.hub, date) >= deliveryCapacity(lock.hub, date)) {
    throwApi(409, "delivery_day_full");
  }
  // Ledger gate for the place, then Postgres commit; a failed commit undoes the gate.
  const gate = await ledger.claimPlace(lock.hub, date, lock.ref, deliveryCapacity(lock.hub, date));
  if (gate === 0) throwApi(409, "delivery_day_full");
  if (gate < 0) throwApi(503, "hub_unreachable");
  try {
    const r = await pool.query(
      `UPDATE locks SET delivery_date = $2, state = 'delivery_set', waiting_for = NULL, wait_position = NULL, joined_line_ms = NULL
       WHERE id = $1 AND state = 'locked' RETURNING *`,
      [lockId, date]
    );
    if (!r.rowCount) {
      await ledger.removePlace(lock.hub, date, lock.ref);
      throwApi(409, "illegal_state");
    }
    // A delivery_set lock no longer expires: expiresAt and expiresLabel become null.
    await pool.query(`UPDATE locks SET expires_at_ms = NULL WHERE id = $1 AND state = 'delivery_set'`, [lockId]);
    // The hold score becomes infinity once a delivery day is set.
    await ledger.setHoldScoreInfinity(lock.hub, lock.model, lock.finish, lock.ref);
    await bumpSeq(lock.hub);
    await cancelNoticesForLock(lockId);
    return normaliseLockRow((await pool.query(`SELECT * FROM locks WHERE id = $1`, [lockId])).rows[0] as Record<string, unknown>);
  } catch (e) {
    await ledger.removePlace(lock.hub, date, lock.ref).catch(() => {});
    throw e;
  }
}

export async function joinWaitLine(riderId: string, lockId: string, date: string): Promise<{ status: number; lock: LockRow }> {
  const lock = await riderLock(riderId, lockId);
  if (lock.waiting_for === date && lock.state === "locked") return { status: 200, lock };
  const now = appNowMs();
  if (n(lock.expires_at_ms ?? 0) !== 0 && n(lock.expires_at_ms ?? 0) <= now) {
    throwApi(409, "lock_expired");
  }
  if (lock.state !== "locked") throwApi(409, "illegal_state");
  const issueDate = istDateOf(n(lock.issued_at_ms));
  if (!insideDeliveryWindow(issueDate, date) || isClosedDay(lock.hub, date)) {
    throwApi(409, "delivery_day_closed");
  }
  if (deliveryDayClosed(lock.hub, date, now)) throwApi(409, "delivery_day_closed");
  if ((await placesTaken(lock.hub, date)) < deliveryCapacity(lock.hub, date)) {
    throwApi(409, "delivery_day_has_places");
  }
  // Joining another full day's line leaves the first and joins the back of the new one.
  const joined = appNowMs();
  await pool.query(
    `UPDATE locks SET waiting_for = $2, joined_line_ms = $3 WHERE id = $1 AND state = 'locked'`,
    [lockId, date, joined]
  );
  await renumberWaiters(lock.hub, date);
  const r0 = await pool.query(`SELECT * FROM locks WHERE id = $1`, [lockId]);
  const fresh = normaliseLockRow(r0.rows[0] as Record<string, unknown>);
  return { status: 201, lock: fresh };
}

// Exported for the hub service: positions renumber whenever a waiter leaves.
export async function renumberWaiters(hub: string, date: string): Promise<void> {
  const rows = await pool.query(
    `SELECT id FROM locks WHERE hub = $1 AND waiting_for = $2 AND state = 'locked' ORDER BY joined_line_ms ASC`,
    [hub, date]
  );
  let pos = 1;
  for (const row of rows.rows as { id: string }[]) {
    await pool.query(`UPDATE locks SET wait_position = $2 WHERE id = $1`, [row.id, pos]);
    pos++;
  }
}

export async function leaveWaitLine(riderId: string, lockId: string): Promise<LockRow> {
  const lock = await riderLock(riderId, lockId);
  if (lock.waiting_for === null || lock.state !== "locked") throwApi(409, "illegal_state");
  await pool.query(
    `UPDATE locks SET waiting_for = NULL, wait_position = NULL, joined_line_ms = NULL WHERE id = $1`,
    [lockId]
  );
  await renumberWaiters(lock.hub, lock.waiting_for);
  const r0 = await pool.query(`SELECT * FROM locks WHERE id = $1`, [lockId]);
  const fresh = normaliseLockRow(r0.rows[0] as Record<string, unknown>);
  return fresh;
}

// ---------- rides ----------

export interface RideClaimInput {
  hub: string;
  model: string;
  startsAt: string;
  licenceNumber: string;
  licenceValidUntil: string;
  hasMcwg: boolean;
}

export async function claimRide(riderId: string, body: RideClaimInput): Promise<{ status: number; ride: RideRow }> {
  const now = appNowMs();
  const startMs = parseStartsAt(body.startsAt);
  // Replay: the rider's booked ride on this model at the same hub and start returns
  // before any refusal.
  const rawBooked = (
    await pool.query(
      `SELECT * FROM rides WHERE rider_id = $1 AND model = $2 AND state = 'booked'`,
      [riderId, body.model]
    )
  ).rows as Record<string, unknown>[];
  const booked = rawBooked.map(normaliseRideRow);
  if (booked.length > 0) {
    const same = booked.find((r) => r.hub === body.hub && n(r.starts_at_ms) === startMs);
    if (same) return { status: 200, ride: same };
    throwApi(409, "ride_exists");
  }
  if (!insideBookablePattern(body.hub, startMs, now)) throwApi(422, "invalid_slot");
  if (pastCutOff(startMs, now)) throwApi(409, "ride_cut_off");
  // licence checks
  checkLicence(body, istDateOf(startMs));
  if (await hubSystemStale(body.hub)) throwApi(503, "hub_unreachable");
  // Slot claim through the ledger key.
  const rideId = newId("ride");
  const gate = await ledger.claimSlot(body.hub, slotKeyFromMs(startMs), rideId);
  if (gate === 0) throwApi(409, "slot_taken");
  if (gate < 0) throwApi(503, "hub_unreachable");
  try {
    const r = await pool.query(
      `INSERT INTO rides (id, rider_id, hub, model, starts_at_ms, state, moved_from_ms, licence_last4, created_at_ms)
       VALUES ($1,$2,$3,$4,$5,'booked',NULL,$6,$7) RETURNING *`,
      [rideId, riderId, body.hub, body.model, startMs, normaliseLicence(body.licenceNumber).slice(-4), now]
    );
    await ensureRideReminder(normaliseRideRow(r.rows[0]));
    await bumpSeq(body.hub);
    return { status: 201, ride: normaliseRideRow(r.rows[0]) };
  } catch (e) {
    await ledger.releaseSlot(body.hub, slotKeyFromMs(startMs)).catch(() => {});
    throw e;
  }
}

function slotKeyFromMs(ms: number): string {
  const shifted = new Date(ms + 5.5 * 3600000);
  const d = shifted.toISOString().slice(0, 10);
  const hh = String(shifted.getUTCHours()).padStart(2, "0");
  const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${d}T${hh}:${mm}`;
}

// A ride start arrives as an ISO 8601 time; parseIsoTime is the one parser.
function parseStartsAt(s: string): number {
  const ms = parseIsoTime(s);
  if (ms === null) throwApi(422, "invalid_body");
  return ms;
}

function checkLicence(body: RideClaimInput, rideDate: string): void {
  if (!validLicenceNumber(body.licenceNumber)) throwApi(422, "licence_invalid");
  if (!body.hasMcwg) throwApi(422, "mcwg_required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.licenceValidUntil) || !isValidDate(body.licenceValidUntil)) {
    throwApi(422, "invalid_body");
  }
  if (!licenceValidFor(body.licenceValidUntil, rideDate)) throwApi(422, "licence_expired");
}

function isValidDate(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

async function ensureRideReminder(ride: RideRow): Promise<void> {
  // Ride reminder goes at 18:00 IST on the calendar day before the ride, while the
  // ride is booked, and not at all if the ride was first booked at or after that time.
  const rideDate = istDateOf(n(ride.starts_at_ms));
  const dueAt = istStartOfDay(addDays(rideDate, -1)) + 18 * 3600000;
  const createdAt = n((ride as { created_at_ms?: number }).created_at_ms ?? 0);
  if (createdAt >= dueAt) return;
  await ensurePendingNotice({
    riderId: ride.rider_id,
    kind: "ride_reminder",
    dueAtMs: dueAt,
    rideId: ride.id,
    dedupeKey: `ride-rem-${ride.id}`});
}

export async function riderRide(riderId: string, rideId: string): Promise<RideRow> {
  const r = await pool.query(`SELECT * FROM rides WHERE id = $1`, [rideId]);
  if (!r.rowCount) throwApi(404, "not_found");
  const ride = normaliseRideRow(r.rows[0]);
  if (ride.rider_id !== riderId) throwApi(404, "not_found");
  return ride;
}

export async function moveRide(riderId: string, rideId: string, startsAt: string): Promise<RideRow> {
  const ride = await riderRide(riderId, rideId);
  const now = appNowMs();
  if (ride.state !== "booked") throwApi(409, "illegal_state");
  if (pastCutOff(n(ride.starts_at_ms), now)) throwApi(409, "ride_cut_off");
  const newStart = parseStartsAt(startsAt);
  if (newStart === n(ride.starts_at_ms)) throwApi(409, "illegal_state");
  if (!insideBookablePattern(ride.hub, newStart, now)) throwApi(422, "invalid_slot");
  if (pastCutOff(newStart, now)) throwApi(409, "ride_cut_off");
  if (await hubSystemStale(ride.hub)) throwApi(503, "hub_unreachable");
  // A move swaps its ledger keys: take the new one, then give up the old one.
  const gate = await ledger.claimSlot(ride.hub, slotKeyFromMs(newStart), ride.id);
  if (gate === 0) throwApi(409, "slot_taken");
  if (gate < 0) throwApi(503, "hub_unreachable");
  try {
    const r = await pool.query(
      `UPDATE rides SET starts_at_ms = $2, moved_from_ms = $3 WHERE id = $1 AND state = 'booked' RETURNING *`,
      [rideId, newStart, n(ride.starts_at_ms)]
    );
    if (!r.rowCount) {
      await ledger.releaseSlot(ride.hub, slotKeyFromMs(newStart));
      throwApi(409, "illegal_state");
    }
    await ledger.releaseSlot(ride.hub, slotKeyFromMs(n(ride.starts_at_ms)));
    await cancelNoticesForRide(rideId);
    await ensureRideReminder(normaliseRideRow(r.rows[0]));
    await bumpSeq(ride.hub);
    return normaliseRideRow(r.rows[0]);
  } catch (e) {
    await ledger.releaseSlot(ride.hub, slotKeyFromMs(newStart)).catch(() => {});
    throw e;
  }
}

export async function cancelRide(riderId: string, rideId: string): Promise<RideRow> {
  const ride = await riderRide(riderId, rideId);
  const now = appNowMs();
  if (ride.state !== "booked") throwApi(409, "illegal_state");
  if (pastCutOff(n(ride.starts_at_ms), now)) throwApi(409, "ride_cut_off");
  if (await hubSystemStale(ride.hub)) throwApi(503, "hub_unreachable");
  await ledger.releaseSlot(ride.hub, slotKeyFromMs(n(ride.starts_at_ms))).catch((e) => {
    throw ledgerOutage(e);
  });
  const r = await pool.query(`UPDATE rides SET state = 'cancelled' WHERE id = $1 AND state = 'booked' RETURNING *`, [rideId]);
  if (!r.rowCount) throwApi(409, "illegal_state");
  await cancelNoticesForRide(rideId);
  await bumpSeq(ride.hub);
  return normaliseRideRow(r.rows[0]);
}

export { ledger };
