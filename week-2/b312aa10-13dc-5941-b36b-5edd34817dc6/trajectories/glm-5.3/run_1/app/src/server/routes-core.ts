import type { AuthedRequest } from './api-core.js';
import { callerOf, forbidden, notFound, requireRole } from './api-core.js';
import { ApiError, monthName, statusWord } from './errors.js';
import { getPool, withContentionRetry } from './db.js';
import { parseJsonBody, type Handler, type RouteContext } from './pipeline.js';
import { requireIdempotencyKey, bodyFingerprint, checkIdempotency, storeIdempotentResponse } from './idempotency.js';
import { currentMonthInZone, formatInstant, localDateInZone, localTimeInZone, monthOf, resolveLocal, todayInZone } from './time.js';
import { bookingObject, bookedObject, hourBankObject, monthClosed, stationIndex } from './serialize.js';
import type { BookingRow } from './booking.js';
import { OCCUPYING, applyLapses } from './booking.js';
import { verifyPassword } from './seed.js';
import { isValidEmail, newId, randomToken } from './util.js';
import type { PoolClient } from 'pg';

const now = (): Date => new Date();

// ---------------------------------------------------------------------------
// POST /api/session — sign in
// ---------------------------------------------------------------------------
export const signIn: Handler = async (req, res, ctx) => {
  const body = parseBody(req);
  if (typeof body !== 'object' || body === null) throw new ApiError('bad_request');
  const errors: Record<string, string> = {};
  const email = typeof body.email === 'string' ? body.email : undefined;
  const password = typeof body.password === 'string' ? body.password : undefined;
  if (!email || !isValidEmail(email.trim())) errors.email = 'Enter a valid email address.';
  if (password === undefined || typeof body.password !== 'string') errors.password = 'Enter your password.';
  if (Object.keys(errors).length > 0) throw new ApiError('validation_failed', { errors });

  const emailNorm = email!.trim().toLowerCase();
  const cfg = ctx.config;

  // Throttle first, without checking the password. Attempts for one email
  // are counted one at a time, in arrival order, in PostgreSQL.
  const pool = getPool();
  const lockKey = `signin:${emailNorm}`;
  const throttleClient = await pool.connect();
  let throttled: { retryAfter: number } | null = null;
  try {
    await throttleClient.query('BEGIN');
    await throttleClient.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [lockKey]);
    const cutoff = new Date(Date.now() - cfg.signinWindowSeconds * 1000);
    const failures = await throttleClient.query<{ at: Date }>(
      `SELECT at FROM signin_failures WHERE email_norm=$1 AND at>$2 ORDER BY at ASC`,
      [emailNorm, cutoff],
    );
    if (failures.rows.length >= 5) {
      const oldest = failures.rows[0].at.getTime();
      const retryAfter = Math.max(1, Math.ceil((oldest + cfg.signinWindowSeconds * 1000 - Date.now()) / 1000));
      throttled = { retryAfter };
    } else {
      await throttleClient.query(`INSERT INTO signin_failures (email_norm, at) VALUES ($1, now())`, [emailNorm]);
    }
    await throttleClient.query('COMMIT');
  } catch (err) {
    try {
      await throttleClient.query('ROLLBACK');
    } catch {
      /* connection gone */
    }
    throttleClient.release();
    throw err;
  }
  throttleClient.release();

  if (throttled) {
    const minutes = Math.max(1, Math.ceil(throttled.retryAfter / 60));
    res.setHeader('Retry-After', String(throttled.retryAfter));
    throw new ApiError('rate_limited', {}, (n) => (n === 'minutes' ? String(minutes) : ''));
  }

  const personResult = await pool.query<{ id: string; name: string; email: string; role: string; member_id: string | null; kitchen_id: string; password_hash: string }>(
    `SELECT p.* FROM people p WHERE lower(p.email)=$1`,
    [emailNorm],
  );
  const person = personResult.rows[0];
  const passwordOk = person ? verifyPassword(password!, person.password_hash) : false;
  if (!person || !passwordOk) {
    throw new ApiError('invalid_credentials');
  }
  const sessionId = newId('ses') + randomToken(20);
  const kitchen = await pool.query<{ id: string; name: string; slug: string; time_zone: string }>(
    `SELECT id, name, slug, time_zone FROM kitchens WHERE id=$1`,
    [person.kitchen_id],
  );
  await withContentionRetry(async (client) => {
    // A successful sign-in clears that email's counted failures and ends any
    // session whose cookie came with the request.
    await client.query(`DELETE FROM signin_failures WHERE email_norm=$1`, [emailNorm]);
    const oldCookie = (req.headers.cookie ?? '').match(/lineboard_session=([A-Za-z0-9_-]+)/);
    if (oldCookie) {
      await client.query(`DELETE FROM sessions WHERE id=$1`, [oldCookie[1]]);
    }
    await client.query(`INSERT INTO sessions (id, person_id, kitchen_id) VALUES ($1,$2,$3)`, [sessionId, person.id, person.kitchen_id]);
  });
  res.setHeader('Set-Cookie', `lineboard_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`);
  res.status(200).json({
    user: { id: person.id, name: person.name, email: person.email, role: person.role, memberId: person.member_id },
    kitchen: kitchen.rows[0],
  });
};

// ---------------------------------------------------------------------------
// GET /api/session
// ---------------------------------------------------------------------------
export const getSession: Handler = async (req, res) => {
  const caller = callerOf(req);
  res.status(200).json({
    user: {
      id: caller.person.id,
      name: caller.person.name,
      email: caller.person.email,
      role: caller.person.role,
      memberId: caller.person.member_id,
    },
    kitchen: { id: caller.kitchen.id, name: caller.kitchen.name, slug: caller.kitchen.slug, timeZone: caller.kitchen.time_zone },
  });
};

// ---------------------------------------------------------------------------
// DELETE /api/session
// ---------------------------------------------------------------------------
export const signOut: Handler = async (req, res) => {
  const cookie = req.headers.cookie ?? '';
  const match = /(?:^|;\s*)lineboard_session=([A-Za-z0-9_-]+)/.exec(cookie);
  if (match) {
    await withContentionRetry(async (client) => {
      await client.query(`DELETE FROM sessions WHERE id=$1`, [match[1]]);
    });
  }
  res.setHeader('Set-Cookie', 'lineboard_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.status(204).end();
};

// ---------------------------------------------------------------------------
// GET /api/kitchen
// ---------------------------------------------------------------------------
export const getKitchen: Handler = async (req, res) => {
  const caller = callerOf(req);
  const tz = caller.kitchen.time_zone;
  const instant = now();
  res.status(200).json({
    id: caller.kitchen.id,
    name: caller.kitchen.name,
    slug: caller.kitchen.slug,
    timeZone: tz,
    today: todayInZone(instant, tz),
    currentMonth: currentMonthInZone(instant, tz),
    peakWindows: caller.kitchen.peak_windows,
    requiredDocuments: caller.kitchen.required_documents,
    rulesVersion: caller.kitchen.rules_version,
  });
};

// ---------------------------------------------------------------------------
// GET /api/board?date=
// ---------------------------------------------------------------------------
export const getBoard: Handler = async (req, res, ctx) => {
  const caller = callerOf(req);
  const tz = caller.kitchen.time_zone;
  const instant = now();
  const today = todayInZone(instant, tz);
  let date = today;
  const dateParam = req.query.date as string | undefined;
  if (dateParam !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam) || Number.isNaN(Date.parse(`${dateParam}T00:00:00Z`))) {
      throw new ApiError('validation_failed', { errors: { date: 'Use a date in the form YYYY-MM-DD.' } });
    }
    date = dateParam;
  }
  await withContentionRetry(async (client) => {
    // Apply due lapses for bookings on the board date.
    const dueHolds = await client.query<{ id: string }>(
      `SELECT id FROM bookings WHERE kitchen_id=$1 AND hold_expires_at IS NOT NULL AND hold_expires_at<=$2 AND status='held'`,
      [caller.kitchen.id, instant],
    );
    for (const row of dueHolds.rows) await applyLapses(client, row.id, instant, ctx.config.noShowGraceSeconds);
    const stations = await client.query<{ id: string; name: string; kind: string; capacity: number | null; lane_order: number }>(
      `SELECT id, name, kind, capacity, lane_order FROM stations WHERE kitchen_id=$1 ORDER BY lane_order`,
      [caller.kitchen.id],
    );
    const laneOrder = new Map(stations.rows.map((s: { id: string }, i: number) => [s.id, i] as [string, number]));
    const blocksResult = await client.query<BookingRow>(
      `SELECT * FROM bookings WHERE kitchen_id=$1 AND (
        (kind='hourly' AND local_date=$2) OR (kind='shelf' AND local_date<=$2 AND local_date + (days-1) >= $2)
      )`,
      [caller.kitchen.id, date],
    );
    const isStaff = caller.person.role !== 'member';
    const shown: Record<string, unknown>[] = [];
    for (const booking of blocksResult.rows) {
      if (isStaff) {
        if (OCCUPYING.includes(booking.status)) {
          shown.push(await bookingObject(client, booking, caller.person, caller.kitchen, instant, ctx.config.noShowGraceSeconds));
        }
      } else if (booking.member_id === caller.person.member_id) {
        // A member's own blocks, including their expired tickets for the rail;
        // cancelled bookings never appear on the board.
        if (OCCUPYING.includes(booking.status) || booking.status === 'expired') {
          shown.push(await bookingObject(client, booking, caller.person, caller.kitchen, instant, ctx.config.noShowGraceSeconds));
        }
      } else if (OCCUPYING.includes(booking.status)) {
        shown.push(bookedObject(booking, caller.kitchen));
      }
    }
    shown.sort((a, b) => {
      const sa = laneOrder.get(a.stationId as string) ?? 99;
      const sb = laneOrder.get(b.stationId as string) ?? 99;
      if (sa !== sb) return sa - sb;
      if (a.kind === 'shelf' && b.kind === 'shelf') return String(a.start).localeCompare(String(b.start));
      return String(a.start).localeCompare(String(b.start));
    });
    const oos = await client.query<{ id: string; station_id: string; start_at: Date; end_at: Date; local_date: string; local_start: string; local_end: string; reason: string }>(
      `SELECT * FROM out_of_service_windows WHERE kitchen_id=$1 AND start_at < $3 AND end_at > $2`,
      [caller.kitchen.id, dayStart(date, tz), dayEnd(date, tz)],
    );
    void laneOrder;
    const outOfService = oos.rows
      .map((w) => ({
        id: w.id,
        stationId: w.station_id,
        start: formatInstant(w.start_at, tz),
        end: formatInstant(w.end_at, tz),
        localDate: w.local_date,
        localStart: w.local_start,
        localEnd: w.local_end,
        reason: w.reason,
      }))
      .sort((a, b) => a.stationId.localeCompare(b.stationId) || a.start.localeCompare(b.start));
    const hourBank = caller.person.member_id
      ? await hourBankObject(client, caller.person.member_id, monthOf(date))
      : null;
    res.status(200).json({
      date,
      today,
      now: formatInstant(instant, tz),
      timeZone: tz,
      stations: stations.rows.map((s) => ({ id: s.id, name: s.name, kind: s.kind, capacity: s.capacity })),
      peakWindows: caller.kitchen.peak_windows,
      blocks: shown,
      outOfService,
      hourBank,
    });
  });
};

function dayStart(date: string, tz: string): Date {
  return resolveLocal(date, '00:00', tz).ok ? (resolveLocal(date, '00:00', tz) as { instant: Date }).instant : new Date(Date.parse(`${date}T00:00:00Z`));
}

function dayEnd(date: string, tz: string): Date {
  const next = new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return resolveLocal(next, '00:00', tz).ok ? (resolveLocal(next, '00:00', tz) as { instant: Date }).instant : new Date(Date.parse(`${next}T00:00:00Z`));
}

function parseBody(req: AuthedRequest): Record<string, unknown> {
  const body = parseJsonBody(req.rawBody);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// GET /api/stations
// ---------------------------------------------------------------------------
export const getStations: Handler = async (req, res) => {
  const caller = callerOf(req);
  const instant = now();
  await withContentionRetry(async (client) => {
    const stations = await client.query<{ id: string; name: string; kind: string; capacity: number | null; lane_order: number }>(
      `SELECT id, name, kind, capacity, lane_order FROM stations WHERE kitchen_id=$1 ORDER BY lane_order`,
      [caller.kitchen.id],
    );
    const result = [];
    for (const station of stations.rows) {
      const versions = (await client.query<any>(`SELECT * FROM rate_versions WHERE station_id=$1 ORDER BY effective_at`, [station.id])).rows;
      const current = [...versions].reverse().find((v) => v.effective_at.getTime() <= instant.getTime()) ?? null;
      const rateObj = (v: any) => {
        const base: Record<string, unknown> = {
          effectiveFrom: v.effective_from_local,
          effectiveAt: formatInstant(v.effective_at, caller.kitchen.time_zone),
          status: rateStatusOf(v, versions, instant),
        };
        if (station.kind === 'hourly') {
          base.offPeakHourlyCents = v.off_peak_cents;
          base.peakHourlyCents = v.peak_cents;
        } else {
          base.shelfDayCents = v.shelf_day_cents;
        }
        return base;
      };
      result.push({
        id: station.id,
        name: station.name,
        kind: station.kind,
        capacity: station.capacity,
        currentRate: current ? rateObj(current) : null,
        rates: versions.map(rateObj),
      });
    }
    res.status(200).json({ stations: result });
  });
};

function rateStatusOf(version: any, versions: any[], instant: Date): 'past' | 'current' | 'scheduled' {
  const inForce = versions.filter((v) => v.effective_at.getTime() <= instant.getTime());
  const current = inForce.length > 0 ? inForce[inForce.length - 1] : null;
  if (current && current.id === version.id) return 'current';
  if (version.effective_at.getTime() > instant.getTime()) return 'scheduled';
  return 'past';
}



// ---------------------------------------------------------------------------
// POST /api/stations/{stationId}/rates — schedule a rate change
// ---------------------------------------------------------------------------
export const postStationRates: import('./pipeline.js').Handler = async (req, res) => {
  const caller = callerOf(req);
  if (caller.person.role !== 'operator') throw new ApiError('forbidden');
  const stationId = String(req.params.stationId);
  const body = parseBody(req);
  await withContentionRetry(async (client) => {
    const station = await client.query<{ id: string; name: string; kind: string; capacity: number | null; lane_order: number }>(
      `SELECT * FROM stations WHERE id=$1 AND kitchen_id=$2`,
      [stationId, caller.kitchen.id],
    );
    if (station.rows.length === 0) throw new ApiError('not_found');
    const row = station.rows[0];
    const isShelf = row.kind === 'shelf';
    const allowed = isShelf ? ['shelfDayCents', 'effectiveFrom'] : ['offPeakHourlyCents', 'peakHourlyCents', 'effectiveFrom'];
    const errors: Record<string, string> = {};
    for (const key of Object.keys(body)) {
      if (!allowed.includes(key)) errors[key] = 'This field cannot be set.';
    }
    const rates = isShelf
      ? { shelfDayCents: Number(body.shelfDayCents), offPeakHourlyCents: undefined, peakHourlyCents: undefined }
      : { shelfDayCents: undefined, offPeakHourlyCents: Number(body.offPeakHourlyCents), peakHourlyCents: Number(body.peakHourlyCents) };
    const effectiveFrom = typeof body.effectiveFrom === 'string' ? body.effectiveFrom : '';
    if (!isShelf) {
      if (!Number.isInteger(rates.offPeakHourlyCents) || rates.offPeakHourlyCents! < 1 || rates.offPeakHourlyCents! > 100000) {
        errors.offPeakHourlyCents = 'Enter a rate from $0.01 to $1,000.00.';
      }
      if (!Number.isInteger(rates.peakHourlyCents) || rates.peakHourlyCents! < 1 || rates.peakHourlyCents! > 100000) {
        errors.peakHourlyCents = 'Enter a rate from $0.01 to $1,000.00.';
      }
    } else {
      if (!Number.isInteger(rates.shelfDayCents) || rates.shelfDayCents! < 1 || rates.shelfDayCents! > 100000) {
        errors.shelfDayCents = 'Enter a rate from $0.01 to $1,000.00.';
      }
    }
    const tz = caller.kitchen.time_zone;
    let effectiveAt: Date | null = null;
    if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(effectiveFrom)) {
      errors.effectiveFrom = 'Rate changes must start in the future.';
    } else {
      const date = effectiveFrom.slice(0, 10);
      const hhmm = effectiveFrom.slice(11);
      const resolved = resolveLocal(date, hhmm, tz);
      if (!resolved.ok) {
        errors.effectiveFrom = `${hhmm} does not exist on ${date} in ${tz} (clocks go forward).`;
      } else {
        effectiveAt = resolved.instant;
        if (effectiveAt.getTime() <= Date.now()) errors.effectiveFrom = 'Rate changes must start in the future.';
      }
    }
    if (Object.keys(errors).length > 0) throw new ApiError('validation_failed', { errors });

    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`rate:${stationId}`]);
    const exists = await client.query<{ id: string }>(`SELECT id FROM rate_versions WHERE station_id=$1 AND effective_at=$2`, [stationId, effectiveAt]);
    if (exists.rows.length > 0) {
      throw new ApiError('rate_version_exists', {}, (n) =>
        n === 'station' ? row.name : n === 'effective' ? formatDateTimeLocal(effectiveAt!, tz) : '',
      );
    }
    const id = newId('rate');
    await client.query(
      `INSERT INTO rate_versions (id, station_id, effective_from_local, effective_at, off_peak_cents, peak_cents, shelf_day_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, stationId, effectiveFrom, effectiveAt, isShelf ? null : rates.offPeakHourlyCents, isShelf ? null : rates.peakHourlyCents, isShelf ? rates.shelfDayCents : null],
    );
    const instant = new Date();
    const versions = (await client.query<any>(`SELECT * FROM rate_versions WHERE station_id=$1 ORDER BY effective_at`, [stationId])).rows;
    const current = [...versions].reverse().find((v) => v.effective_at.getTime() <= instant.getTime()) ?? null;
    const rateObj = (v: any) => {
      const base: Record<string, unknown> = {
        effectiveFrom: v.effective_from_local,
        effectiveAt: formatInstant(v.effective_at, tz),
        status: rateStatusOf(v, versions, instant),
      };
      if (row.kind === 'hourly') {
        base.offPeakHourlyCents = v.off_peak_cents;
        base.peakHourlyCents = v.peak_cents;
      } else {
        base.shelfDayCents = v.shelf_day_cents;
      }
      return base;
    };
    res.status(201).json({
      station: {
        id: row.id,
        name: row.name,
        kind: row.kind,
        capacity: row.capacity,
        currentRate: current ? rateObj(current) : null,
        rates: versions.map(rateObj),
      },
    });
  });
};

function formatDateTimeLocal(instant: Date, tz: string): string {
  return `${localDateInZone(instant, tz)} ${localTimeInZone(instant, tz)}`;
}

// ---------------------------------------------------------------------------
// PUT /api/kitchen/peak-windows and /api/kitchen/document-requirements
// ---------------------------------------------------------------------------
function kitchenObject(kitchen: any, instant: Date): Record<string, unknown> {
  return {
    id: kitchen.id,
    name: kitchen.name,
    slug: kitchen.slug,
    timeZone: kitchen.time_zone,
    today: todayInZone(instant, kitchen.time_zone),
    currentMonth: todayInZone(instant, kitchen.time_zone).slice(0, 7),
    peakWindows: kitchen.peak_windows,
    requiredDocuments: kitchen.required_documents,
    rulesVersion: kitchen.rules_version,
  };
}

const DAY_VALUES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const putPeakWindows: import('./pipeline.js').Handler = async (req, res) => {
  const caller = callerOf(req);
  if (caller.person.role !== 'operator') throw new ApiError('forbidden');
  const body = parseBody(req);
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (key !== 'windows' && key !== 'rulesVersion') errors[key] = 'This field cannot be set.';
  }
  const windows = body.windows;
  const rulesVersion = Number(body.rulesVersion);
  if (!Number.isInteger(rulesVersion)) errors.rulesVersion = 'Reload and try again.';
  if (!Array.isArray(windows) || windows.length > 10) {
    errors.windows = 'Peak windows need days and a start before the end, on the quarter hour.';
  } else {
    for (const w of windows) {
      const win = w as Record<string, unknown>;
      if (!Array.isArray(win.days) || win.days.length === 0 || !(win.days as unknown[]).every((d) => DAY_VALUES.includes(String(d)))) {
        errors.windows = 'Peak windows need days and a start before the end, on the quarter hour.';
        break;
      }
      const start = String(win.start ?? '');
      const end = String(win.end ?? '');
      const quarter = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t) && Number(t.slice(3)) % 15 === 0;
      const endTime = (t: string) => t === '24:00' || quarter(t);
      const endMinutes = end === '24:00' ? 24 * 60 : Number(end.slice(0, 2)) * 60 + Number(end.slice(3));
      if (!quarter(start) || !endTime(end) || !(endMinutes > Number(start.slice(0, 2)) * 60 + Number(start.slice(3)))) {
        errors.windows = 'Peak windows need days and a start before the end, on the quarter hour.';
        break;
      }
    }
  }
  if (Object.keys(errors).length > 0) throw new ApiError('validation_failed', { errors });
  await withContentionRetry(async (client) => {
    
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`kitchen:${caller.kitchen.id}`]);
    const kitchen = (await client.query<any>(`SELECT * FROM kitchens WHERE id=$1 FOR UPDATE`, [caller.kitchen.id])).rows[0];
    if (rulesVersion !== kitchen.rules_version) {
      const instant = new Date();
      throw new ApiError(
        'stale_version',
        { current: kitchenObject(kitchen, instant) },
        (n) => (n === 'action' ? 'kitchen' : ''),
      );
    }
    await client.query(`UPDATE kitchens SET peak_windows=$1::jsonb, rules_version=rules_version+1 WHERE id=$2`, [
      JSON.stringify(windows),
      caller.kitchen.id,
    ]);
    const updated = (await client.query<any>(`SELECT * FROM kitchens WHERE id=$1`, [caller.kitchen.id])).rows[0];
    res.status(200).json(kitchenObject(updated, new Date()));
  });
};

export const putRequirements: import('./pipeline.js').Handler = async (req, res) => {
  const caller = callerOf(req);
  if (caller.person.role !== 'operator') throw new ApiError('forbidden');
  const body = parseBody(req);
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (key !== 'required' && key !== 'rulesVersion') errors[key] = 'This field cannot be set.';
  }
  const required = body.required;
  const rulesVersion = Number(body.rulesVersion);
  if (!Number.isInteger(rulesVersion)) errors.rulesVersion = 'Reload and try again.';
  if (!Array.isArray(required) || !(required as unknown[]).every((r) => r === 'insurance_certificate' || r === 'food_handler_card')) {
    errors.required = 'This field cannot be set.';
  }
  if (Object.keys(errors).length > 0) throw new ApiError('validation_failed', { errors });
  await withContentionRetry(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`kitchen:${caller.kitchen.id}`]);
    const kitchen = (await client.query<any>(`SELECT * FROM kitchens WHERE id=$1 FOR UPDATE`, [caller.kitchen.id])).rows[0];
    if (rulesVersion !== kitchen.rules_version) {
      throw new ApiError(
        'stale_version',
        { current: kitchenObject(kitchen, new Date()) },
        (n) => (n === 'action' ? 'kitchen' : ''),
      );
    }
    await client.query(`UPDATE kitchens SET required_documents=$1, rules_version=rules_version+1 WHERE id=$2`, [
      required,
      caller.kitchen.id,
    ]);
    const updated = (await client.query<any>(`SELECT * FROM kitchens WHERE id=$1`, [caller.kitchen.id])).rows[0];
    res.status(200).json(kitchenObject(updated, new Date()));
  });
};
