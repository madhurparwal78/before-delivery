// Intake appointments (DP-38 to DP-42).

import crypto from 'node:crypto';
import type { Route, RouteContext } from '../http.js';
import { sendJson, parseJsonBody, asObject, str, instantOf } from '../http.js';
import { ApiError } from '../errors.js';
import { brusselsDateOf, addDays, cutToSecond, toZ } from '../../shared/time.js';
import { bookingMail, formatDateTime } from '../mails.js';

const SLOT_MINUTES = 20;
const DAY_START_MIN = 10 * 60;      // 10:00
const DAY_END_MIN = 17 * 60 + 40;   // last slot starts 17:40
const WEEK_RANGE_DAYS = 224;        // 32 weeks

export const appointmentRoutes: Route[] = [
  {
    method: 'GET', pattern: '/api/appointment-slots', bodyLimit: 0, auth: 'public',
    handle: async (ctx) => {
      const weekParam = ctx.url.searchParams.get('week');
      const now = cutToSecond(new Date());
      const today = brusselsDateOf(now);
      const tomorrow = addDays(today, 1);
      const firstDay = tomorrow;                      // bookable from 00:00 Brussels tomorrow
      const lastDay = addDays(tomorrow, WEEK_RANGE_DAYS - 1);

      let weekStart: string;
      if (weekParam === null) {
        weekStart = mondayOf(tomorrow);
      } else {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(weekParam)) {
          throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', { week: 'Choose a Monday.' });
        }
        const monday = mondayOf(weekParam);
        if (monday !== weekParam || weekParam < mondayOf(firstDay) || weekParam > mondayOf(lastDay)) {
          throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', { week: 'Choose a Monday inside the bookable range.' });
        }
        weekStart = weekParam;
      }

      const slots = [];
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const date = addDays(weekStart, dayOffset);
        const weekday = weekdayOf(date);
        if (weekday < 2 || weekday > 6) continue;    // Tuesday to Saturday
        if (date < firstDay || date > lastDay) continue;
        for (let minutes = DAY_START_MIN; minutes <= DAY_END_MIN; minutes += SLOT_MINUTES) {
          const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
          const mm = String(minutes % 60).padStart(2, '0');
          const startsAt = localWallClock(date, hh, mm);
          const endsAt = new Date(startsAt.getTime() + SLOT_MINUTES * 60 * 1000);
          slots.push({ startsAt: toZ(startsAt), endsAt: toZ(endsAt), free: true });
        }
      }

      const taken = await takenSlots(ctx, slots.map((s) => s.startsAt));
      for (const slot of slots) slot.free = !taken.has(slot.startsAt);

      const prevMonday = addDays(weekStart, -7);
      const nextMonday = addDays(weekStart, 7);
      const rangeStartMonday = mondayOf(firstDay);
      const rangeEndMonday = mondayOf(lastDay);
      sendJson(ctx.res, 200, {
        weekStart,
        previousWeek: prevMonday >= rangeStartMonday && prevMonday <= rangeEndMonday ? prevMonday : null,
        nextWeek: nextMonday >= rangeStartMonday && nextMonday <= rangeEndMonday ? nextMonday : null,
        slots,
      });
    },
  },
  {
    method: 'POST', pattern: '/api/appointments', bodyLimit: 65536, auth: 'public',
    handle: async (ctx) => {
      requireJson(ctx);
      const body = asObject(parseJsonBody(ctx));
      const fields: Record<string, string> = {};
      const startsAtRaw = instantOf(body.startsAt);
      const name = str(body.name);
      const email = str(body.email);
      if (!name || name.trim().length === 0) fields.name = 'Enter a name.';
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Enter an email address like name@example.be.';

      // The booking limit is keyed on the request's email, judged as soon as it is known.
      const emailKey = email ? email.toLowerCase() : null;
      if (emailKey) {
        const window = ctx.services.config.timers.appointmentRateWindowSeconds;
        const cutoff = new Date(Date.now() - window * 1000);
        const { rows } = await ctx.services.pool.query(
          'SELECT created_at FROM booking_log WHERE email_key = $1 AND created_at > $2 ORDER BY created_at', [emailKey, cutoff]
        );
        if (rows.length >= 3) {
          const oldest = new Date(rows[0]!.created_at).getTime();
          const retryAfter = Math.ceil((oldest + window * 1000 - Date.now()) / 1000);
          throw new ApiError(429, 'rate_limited',
            'This email address has booked 3 slots in a short while. Try again later.',
            undefined, { 'Retry-After': String(Math.max(0, retryAfter)) });
        }
      }

      let startsAt: Date | null = null;
      if (startsAtRaw === 'invalid' || startsAtRaw === undefined) {
        fields.startsAt = 'Choose a slot.';
      } else {
        startsAt = cutToSecond(startsAtRaw);
        if (!isBookableSlot(ctx, startsAt)) {
          fields.startsAt = 'Choose a bookable slot.';
        }
      }
      if (Object.keys(fields).length > 0) throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', fields);

      const now = cutToSecond(new Date());
      const id = crypto.randomUUID();
      const cancelToken = crypto.randomBytes(24).toString('base64url');
      const cancelUrl = `${ctx.services.config.publicUrl}/appointments/cancel/${cancelToken}`;

      // The confirmation mail is part of the action: nothing is saved when Mailpit is down.
      let created: { startsAt: Date; endsAt: Date };
      try {
        created = await withSlotLock(ctx, startsAt!, async () => {
          const existing = await ctx.services.pool.query(
            "SELECT 1 FROM appointments WHERE starts_at = $1 AND status <> 'cancelled'", [startsAt!]
          );
          if (existing.rows.length > 0) {
            const next = await nextFreeSlot(ctx, startsAt!);
            throw new ApiError(409, 'slot_taken',
              next ? `That slot was just taken. The next free slot is ${formatDateTime(next)}.`
                   : 'That slot was just taken. There is no free slot in the next 32 weeks.');
          }
          const endsAt = new Date(startsAt!.getTime() + SLOT_MINUTES * 60 * 1000);
          await ctx.services.pool.query(
            `INSERT INTO appointments (id, starts_at, ends_at, name, email, status, cancel_token, created_at)
             VALUES ($1, $2, $3, $4, $5, 'booked', $6, $7)`,
            [id, startsAt!, endsAt, name!.trim(), email!.toLowerCase(), cancelToken, now]
          );
          return { startsAt: startsAt!, endsAt };
        });
      } catch (err) {
        if (err instanceof ApiError && err.code === 'slot_taken') throw err;
        throw err;
      }
      try {
        await bookingMail(
          { mailer: ctx.services.mailer, mailFrom: ctx.services.config.mailFrom },
          { to: email!, startsAt: created.startsAt, cancelUrl }
        );
      } catch {
        await ctx.services.pool.query('DELETE FROM appointments WHERE id = $1', [id]);
        throw new ApiError(503, 'mail_unavailable', 'We can\u2019t send your confirmation right now. Nothing was saved \u2014 try again in a moment.');
      }
      await ctx.services.pool.query('INSERT INTO booking_log (email_key, created_at) VALUES ($1, $2)', [emailKey!, now]);

      sendJson(ctx.res, 201, { appointment: { id, startsAt: toZ(created.startsAt), endsAt: toZ(created.endsAt) } });
    },
  },
  {
    method: 'GET', pattern: '/api/appointments', bodyLimit: 0, auth: 'desk',
    handle: async (ctx) => {
      const now = cutToSecond(new Date());
      const { rows } = await ctx.services.pool.query(
        "SELECT id, starts_at, ends_at, name, email FROM appointments WHERE status <> 'cancelled' AND ends_at > $1 ORDER BY starts_at",
        [now]
      );
      sendJson(ctx.res, 200, {
        appointments: rows.map((r) => ({
          id: r.id, startsAt: toZ(new Date(r.starts_at)), endsAt: toZ(new Date(r.ends_at)),
          name: r.name, email: r.email,
        })),
      });
    },
  },
  {
    method: 'GET', pattern: '/api/appointments/by-token/:token', bodyLimit: 0, auth: 'public',
    handle: async (ctx) => {
      const row = await byToken(ctx, ctx.params.token!);
      sendJson(ctx.res, 200, {
        appointment: { startsAt: toZ(new Date(row.starts_at)), endsAt: toZ(new Date(row.ends_at)), status: row.status },
      });
    },
  },
  {
    method: 'POST', pattern: '/api/appointments/by-token/:token/cancel', bodyLimit: 0, auth: 'public',
    handle: async (ctx) => {
      const row = await byToken(ctx, ctx.params.token!);
      if (row.status === 'cancelled') {
        throw new ApiError(409, 'already_cancelled', 'This appointment is already cancelled.');
      }
      await ctx.services.pool.query("UPDATE appointments SET status = 'cancelled' WHERE id = $1", [row.id]);
      sendJson(ctx.res, 200, {
        appointment: { startsAt: toZ(new Date(row.starts_at)), endsAt: toZ(new Date(row.ends_at)), status: 'cancelled' },
      });
    },
  },
];

/** One booking per slot: two bookings at the same moment produce one row (DP-40). */
async function withSlotLock<T>(ctx: RouteContext, startsAt: Date, fn: () => Promise<T>): Promise<T> {
  const client = await ctx.services.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`slot:${startsAt.toISOString()}`]);
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function byToken(ctx: RouteContext, token: string): Promise<{ id: string; starts_at: Date; ends_at: Date; status: string }> {
  const { rows } = await ctx.services.pool.query('SELECT id, starts_at, ends_at, status FROM appointments WHERE cancel_token = $1', [token]);
  if (rows.length === 0) throw new ApiError(404, 'not_found', 'Not found.');
  return rows[0]!;
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function mondayOf(date: string): string {
  const wd = weekdayOf(date);
  const delta = wd === 0 ? -6 : 1 - wd;
  return addDays(date, delta);
}

/** A slot's wall-clock time keeps its Brussels time across clock changes (DP-39). */
function localWallClock(date: string, hh: string, mm: string): Date {
  const asUtc = Date.parse(`${date}T${hh}:${mm}:00Z`);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Brussels', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(asUtc));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return new Date(asUtc - (asLocal - asUtc));
}

function isBookableSlot(ctx: RouteContext, startsAt: Date): boolean {
  const now = cutToSecond(new Date());
  const today = brusselsDateOf(now);
  const tomorrow = addDays(today, 1);
  const lastDay = addDays(tomorrow, WEEK_RANGE_DAYS - 1);
  const date = brusselsDateOf(startsAt);
  if (date < tomorrow || date > lastDay) return false;
  const wd = weekdayOf(date);
  if (wd < 2 || wd > 6) return false;
  const { hour, minute } = brusselsTimePartsOf(startsAt);
  const minutes = hour * 60 + minute;
  if (minutes < DAY_START_MIN || minutes > DAY_END_MIN) return false;
  if ((minutes - DAY_START_MIN) % SLOT_MINUTES !== 0) return false;
  void ctx;
  return true;
}

function brusselsTimePartsOf(instant: Date): { hour: number; minute: number } {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Brussels', hour12: false, hour: '2-digit', minute: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value) % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  return { hour, minute };
}

async function takenSlots(ctx: RouteContext, startsAt: string[]): Promise<Set<string>> {
  if (startsAt.length === 0) return new Set();
  const { rows } = await ctx.services.pool.query<{ starts_at: Date }>(
    `SELECT starts_at FROM appointments WHERE status <> 'cancelled' AND starts_at = ANY($1::timestamptz[])`,
    [startsAt]
  );
  return new Set(rows.map((r) => toZ(new Date(r.starts_at))));
}

/** The earliest free slot after the taken one, within the bookable range. */
async function nextFreeSlot(ctx: RouteContext, after: Date): Promise<Date | null> {
  const now = cutToSecond(new Date());
  const today = brusselsDateOf(now);
  const tomorrow = addDays(today, 1);
  const lastDay = addDays(tomorrow, WEEK_RANGE_DAYS - 1);
  const { rows: taken } = await ctx.services.pool.query<{ starts_at: Date }>(
    "SELECT starts_at FROM appointments WHERE status <> 'cancelled' AND starts_at > $1 ORDER BY starts_at",
    [after]
  );
  const takenSet = new Set(taken.map((t) => toZ(new Date(t.starts_at))));
  let date = brusselsDateOf(after);
  for (let i = 0; i < WEEK_RANGE_DAYS + 7; i++) {
    if (date > lastDay) return null;
    const wd = weekdayOf(date);
    if (wd >= 2 && wd <= 6 && date >= tomorrow) {
      for (let minutes = DAY_START_MIN; minutes <= DAY_END_MIN; minutes += SLOT_MINUTES) {
        const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
        const mm = String(minutes % 60).padStart(2, '0');
        const instant = cutToSecond(localWallClock(date, hh, mm));
        if (instant.getTime() <= after.getTime()) continue;
        if (!takenSet.has(toZ(instant))) return instant;
      }
    }
    date = addDays(date, 1);
  }
  return null;
}

function requireJson(ctx: RouteContext): void {
  const type = ctx.req.headers['content-type'] ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Send JSON with a content type of application/json.');
  }
}
