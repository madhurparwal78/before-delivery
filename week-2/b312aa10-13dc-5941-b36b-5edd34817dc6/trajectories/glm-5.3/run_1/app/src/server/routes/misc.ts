import { callerOf, forbidden } from '../api-core.js';
import { ApiError } from '../errors.js';
import { withContentionRetry } from '../db.js';
import { parseJsonBody, type Handler, type RouteContext } from '../pipeline.js';
import { addDays, formatInstant, isLocalDate, todayInZone } from '../time.js';
import { bookingObject } from '../serialize.js';
import { OCCUPYING, type BookingRow } from '../booking.js';
import { newId, codePoints, normaliseText } from '../util.js';
import { loadStation } from './bookings.js';
import { isQuarterTime, isEndTime, resolveOrError, blockStartInstant, blockEndInstant } from './bookings.js';
import type { PoolClient } from 'pg';

const nowDate = (): Date => new Date();

// ---------------------------------------------------------------------------
// POST /api/out-of-service
// ---------------------------------------------------------------------------
export const createOutOfService: Handler = async (req, res, ctx) => {
  const caller = callerOf(req);
  if (caller.person.role === 'member') throw forbidden();
  const body = parseJsonBody(req.rawBody) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (!['stationId', 'date', 'start', 'end', 'reason'].includes(key)) errors[key] = 'This field cannot be set.';
  }
  const stationId = typeof body.stationId === 'string' ? body.stationId : '';
  const station = stationId ? await withContentionRetry((client) => loadStation(client, caller.kitchen.id, stationId)).catch(() => null) : null;
  const date = typeof body.date === 'string' ? body.date : '';
  const start = typeof body.start === 'string' ? body.start : '';
  const end = typeof body.end === 'string' ? body.end : '';
  const reason = typeof body.reason === 'string' ? body.reason : '';
  if (!station) errors.stationId = 'This field is required.';
  if (!isLocalDate(date)) errors.date = 'Use a date in the form YYYY-MM-DD.';
  if (!isQuarterTime(start)) errors.start = 'Times must fall on the quarter hour.';
  if (!isEndTime(end)) errors.end = 'Times must fall on the quarter hour.';
  if (!errors.start && !errors.end) {
    const hours = (end === '24:00' ? 24 : Number(end.slice(0, 2)) + Number(end.slice(3)) / 60) - (Number(start.slice(0, 2)) + Number(start.slice(3)) / 60);
    if (hours <= 0) errors.end = 'End must be after start on the same day.';
  }
  if (codePoints(normaliseText(reason)) < 1 || codePoints(normaliseText(reason)) > 120) errors.reason = 'Give a reason in 1 to 120 characters.';
  if (Object.keys(errors).length > 0) throw new ApiError('validation_failed', { errors });
  const tz = caller.kitchen.time_zone;
  const startInst = resolveOrError(date, start, tz, 'start', {});
  const endInst = blockEndInstant(date, end, null, 'hourly', tz);
  if (!startInst || Object.is(endInst, null)) throw new ApiError('validation_failed', { errors: { start: 'Times must fall on the quarter hour.' } });
  if (endInst.getTime() <= nowDate().getTime()) {
    throw new ApiError('validation_failed', { errors: { end: 'This block has already ended.' } });
  }
  await withContentionRetry(async (client) => {
    const instant = nowDate();
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))`, [`station:${station!.id}`, 'window']);
    const id = newId('oos');
    await client.query(
      `INSERT INTO out_of_service_windows (id, kitchen_id, station_id, start_at, end_at, local_date, local_start, local_end, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, caller.kitchen.id, station!.id, startInst, endInst, date, start, end, normaliseText(reason)],
    );
    // Cancel overlapping holds; flag confirmed and checked-in bookings.
    const overlapping = (await client.query<BookingRow>(
      `SELECT * FROM bookings WHERE station_id=$1 AND status=ANY($2) AND start_at < $4 AND end_at > $3`,
      [station!.id, OCCUPYING, startInst, endInst],
    )).rows;
    const conflicts: string[] = [];
    for (const booking of overlapping) {
      if (booking.status === 'held') {
        await client.query(`UPDATE bookings SET status='cancelled_free', version=version+1 WHERE id=$1`, [booking.id]);
      } else {
        await client.query(`UPDATE bookings SET conflict=true, version=version+1 WHERE id=$1`, [booking.id]);
        conflicts.push(booking.id);
      }
    }
    res.status(201).json({
      window: {
        id,
        stationId: station!.id,
        start: formatInstant(startInst, tz),
        end: formatInstant(endInst, tz),
        localDate: date,
        localStart: start,
        localEnd: end,
        reason: normaliseText(reason),
      },
      conflicts,
    });
  });
};

// ---------------------------------------------------------------------------
// DELETE /api/out-of-service/{id}
// ---------------------------------------------------------------------------
export const deleteOutOfService: Handler = async (req, res) => {
  const caller = callerOf(req);
  if (caller.person.role === 'member') throw forbidden();
  const id = String(req.params.id);
  await withContentionRetry(async (client) => {
    const window = (await client.query<{ id: string; station_id: string; start_at: Date; end_at: Date }>(
      `SELECT * FROM out_of_service_windows WHERE id=$1`,
      [id],
    )).rows[0];
    if (!window) throw new ApiError('not_found');
    const station = await loadStation(client, caller.kitchen.id, window.station_id).catch(() => null);
    if (!station) throw new ApiError('not_found');
    await client.query(`DELETE FROM out_of_service_windows WHERE id=$1`, [id]);
    // Bookings no longer overlapping any window lose their conflict flag.
    const flagged = (await client.query<BookingRow>(`SELECT * FROM bookings WHERE station_id=$1 AND conflict=true`, [window.station_id])).rows;
    const conflicts: string[] = [];
    for (const booking of flagged) {
      const still = (await client.query<{ id: string }>(
        `SELECT id FROM out_of_service_windows WHERE station_id=$1 AND start_at < $3 AND end_at > $2`,
        [booking.station_id, booking.start_at, booking.end_at],
      )).rows.length > 0;
      if (still) {
        conflicts.push(booking.id);
      } else {
        await client.query(`UPDATE bookings SET conflict=false, version=version+1 WHERE id=$1`, [booking.id]);
      }
    }
    res.status(200).json({ conflicts });
  });
};

// ---------------------------------------------------------------------------
// GET /api/bookings?month=&memberId=
// ---------------------------------------------------------------------------
export const listBookings: Handler = async (req, res, ctx) => {
  const caller = callerOf(req);
  let month: string;
  if (typeof req.query.month === 'string') {
    if (!/^\d{4}-\d{2}$/.test(req.query.month)) throw new ApiError('validation_failed', { errors: { month: 'Use a month in the form YYYY-MM.' } });
    month = req.query.month;
  } else {
    month = todayInZone(nowDate(), caller.kitchen.time_zone).slice(0, 7);
  }
  let memberId: string | null = null;
  if (caller.person.role === 'member') {
    memberId = caller.person.member_id;
  } else if (typeof req.query.memberId === 'string' && req.query.memberId) {
    memberId = req.query.memberId;
    const member = await withContentionRetry((client) =>
      client.query<{ kitchen_id: string }>(`SELECT kitchen_id FROM members WHERE id=$1`, [memberId]),
    );
    if (member.rows.length === 0 || member.rows[0].kitchen_id !== caller.kitchen.id) throw new ApiError('not_found');
  }
  await withContentionRetry(async (client) => {
    const instant = nowDate();
    const params: unknown[] = [caller.kitchen.id, month];
    let filter = `b.kitchen_id=$1 AND to_char(b.local_date,'YYYY-MM')=$2 AND (b.status='held' OR b.confirmed_at IS NOT NULL)`;
    if (memberId) {
      params.push(memberId);
      filter += ` AND b.member_id=$3`;
    }
    const bookings = (await client.query<BookingRow>(`SELECT b.* FROM bookings b WHERE ${filter} ORDER BY b.start_at`, params)).rows;
    const out = [];
    for (const booking of bookings) {
      out.push(await bookingObject(client, booking, caller.person, caller.kitchen, instant, ctx.config.noShowGraceSeconds));
    }
    res.status(200).json({ month, bookings: out });
  });
};

// ---------------------------------------------------------------------------
// GET /api/bookings/{id}
// ---------------------------------------------------------------------------
export const getBookingById: Handler = async (req, res, ctx) => {
  const caller = callerOf(req);
  const id = String(req.params.id);
  await withContentionRetry(async (client) => {
    const booking = await client.query<BookingRow>(`SELECT * FROM bookings WHERE id=$1`, [id]);
    if (booking.rows.length === 0 || booking.rows[0].kitchen_id !== caller.kitchen.id) throw new ApiError('not_found');
    const row = booking.rows[0];
    if (caller.person.role === 'member' && row.member_id !== caller.person.member_id) throw new ApiError('not_found');
    const instant = nowDate();
    res.status(200).json({ booking: await bookingObject(client, row, caller.person, caller.kitchen, instant, ctx.config.noShowGraceSeconds) });
  });
};

// ---------------------------------------------------------------------------
// GET /api/service-status
// ---------------------------------------------------------------------------
export const serviceStatus: Handler = async (req, res, ctx) => {
  const counts = await withContentionRetry(async (client) => {
    const billing = Number((await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM kb_items WHERE recorded=false`)).rows[0].count);
    const storage = Number((await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM sanitation_reports WHERE status='queued'`)).rows[0].count);
    return { billing, storage };
  });
  res.status(200).json({
    billing: (await ctx.killbill.reachable()) ? 'up' : 'down',
    storage: (await ctx.storage.reachable()) ? 'up' : 'down',
    queued: { billing: counts.billing, storage: counts.storage },
  });
};

// ---------------------------------------------------------------------------
// Inspector view: GET /api/inspect/{token} and its downloads
// ---------------------------------------------------------------------------
interface ActiveLink {
  id: string;
  kitchen_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  status: 'active' | 'expired' | 'revoked';
}

async function resolveToken(token: string): Promise<ActiveLink | null> {
  return withContentionRetry(async (client) => {
    const row = (await client.query<{ id: string; link_id: string; active: boolean; kitchen_id: string; expires_at: Date; revoked_at: Date | null }>(
      `SELECT t.*, l.kitchen_id, l.expires_at, l.revoked_at FROM inspector_tokens t JOIN inspector_links l ON l.id=t.link_id WHERE t.token=$1`,
      [token],
    )).rows[0];
    if (!row) return null;
    const now = nowDate();
    if (row.revoked_at) return { id: row.link_id, kitchen_id: row.kitchen_id, expires_at: row.expires_at, revoked_at: row.revoked_at, status: 'revoked' };
    if (row.expires_at.getTime() <= now.getTime()) return { id: row.link_id, kitchen_id: row.kitchen_id, expires_at: row.expires_at, revoked_at: null, status: 'expired' };
    if (!row.active) return { id: row.link_id, kitchen_id: row.kitchen_id, expires_at: row.expires_at, revoked_at: null, status: 'revoked' };
    return { id: row.link_id, kitchen_id: row.kitchen_id, expires_at: row.expires_at, revoked_at: null, status: 'active' };
  });
}

function linkGone(status: 'expired' | 'revoked'): ApiError {
  return status === 'expired' ? new ApiError('link_expired') : new ApiError('link_revoked');
}

export const inspectView: Handler = async (req, res, ctx) => {
  const token = String(req.params.token);
  const link = await resolveToken(token);
  if (!link) throw new ApiError('not_found');
  if (link.status !== 'active') throw linkGone(link.status);
  await withContentionRetry(async (client) => {
    const kitchen = (await client.query<{ name: string; time_zone: string; id: string }>(`SELECT name, time_zone, id FROM kitchens WHERE id=$1`, [link.kitchen_id])).rows[0];
    const tz = kitchen.time_zone;
    const now = nowDate();
    const today = todayInZone(now, tz);
    const cutoff = addDays(today, -90);
    const entries = (await client.query<{ id: string; area: string; task: string; sanitizer_ppm: number | null; initials: string; notes: string; logged_at: Date; logged_by: string }>(
      `SELECT * FROM sanitation_entries WHERE kitchen_id=$1 AND (logged_at AT TIME ZONE $2)::date > $3 ORDER BY logged_at DESC`,
      [kitchen.id, tz, `${cutoff}`],
    )).rows;
    const reports = (await client.query<{ month: string; status: string }>(
      `SELECT month, status FROM sanitation_reports WHERE kitchen_id=$1 AND status='stored' ORDER BY month DESC`,
      [kitchen.id],
    )).rows;
    const members = (await client.query<{ id: string }>(`SELECT id FROM members WHERE kitchen_id=$1`, [kitchen.id])).rows;
    const certificates = [];
    for (const member of members) {
      for (const type of ['insurance_certificate', 'food_handler_card'] as const) {
        const { currentDocument } = await import('../documents.js');
        const doc = await currentDocument(client, member.id, type, today);
        if (!doc) continue;
        const business = (await client.query<{ business_name: string }>(`SELECT business_name FROM members WHERE id=$1`, [member.id])).rows[0].business_name;
        certificates.push({
          documentId: doc.row.id,
          businessName: business,
          type,
          expiryDate: doc.row.expiry_date,
          status: doc.row.expiry_date < today ? 'expired' : doc.row.expiry_date <= addDays(today, 14) ? 'expiring' : 'approved',
        });
      }
    }
    await client.query(`INSERT INTO inspector_access (id, link_id, at, action, target) VALUES ($1,$2,now(),'view',NULL)`, [newId('acc'), link.id]);
    res.status(200).json({
      kitchen: { name: kitchen.name, timeZone: tz },
      expiresAt: formatInstant(link.expires_at, tz),
      sanitationEntries: entries.map((row) => ({
        id: row.id,
        area: row.area,
        task: row.task,
        sanitizerPpm: row.sanitizer_ppm,
        initials: row.initials,
        notes: row.notes,
        loggedAt: formatInstant(row.logged_at, tz),
        localDate: todayOf(row.logged_at, tz),
        localTime: timeOf(row.logged_at, tz),
        loggedBy: row.logged_by,
      })),
      sanitationReports: reports.map((r) => ({ month: r.month })),
      certificates,
    });
  });
};

function todayOf(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

function timeOf(instant: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}

export const inspectDocumentFile: Handler = async (req, res, ctx) => {
  const token = String(req.params.token);
  const documentId = String(req.params.documentId);
  const link = await resolveToken(token);
  if (!link) throw new ApiError('not_found');
  if (link.status !== 'active') throw linkGone(link.status);
  const result = await withContentionRetry(async (client) => {
    const doc = (await client.query<{ id: string; member_id: string; kitchen_id: string; file_name: string; content_type: string; type: string }>(
      `SELECT id, member_id, kitchen_id, file_name, content_type, type FROM documents WHERE id=$1`,
      [documentId],
    )).rows[0];
    if (!doc || doc.kitchen_id !== link.kitchen_id) return null;
    const { currentDocument } = await import('../documents.js');
    const today = todayInZone(nowDate(), (await client.query<{ time_zone: string }>(`SELECT time_zone FROM kitchens WHERE id=$1`, [link.kitchen_id])).rows[0].time_zone);
    const current = await currentDocument(client, doc.member_id, doc.type as 'insurance_certificate' | 'food_handler_card', today);
    return current?.row.id === doc.id ? doc : null;
  });
  if (!result) throw new ApiError('not_found');
  let bytes: Buffer;
  try {
    bytes = (await ctx.storage.get(`kitchens/${result.kitchen_id}/members/${result.member_id}/documents/${result.id}`))!;
  } catch {
    throw new ApiError('storage_unavailable', {}, (n) => (n === 'storageKind' ? 'download' : ''));
  }
  if (!bytes) throw new ApiError('not_found');
  await withContentionRetry(async (client) => {
    await client.query(`INSERT INTO inspector_access (id, link_id, at, action, target) VALUES ($1,$2,now(),'document',$3)`, [newId('acc'), link.id, result.id]);
  });
  const { sendFileBytes } = await import('./documents.js');
  sendFileBytes(res, bytes, result.content_type, result.file_name);
};

export const inspectReportFile: Handler = async (req, res, ctx) => {
  const token = String(req.params.token);
  const month = String(req.params.month);
  const link = await resolveToken(token);
  if (!link) throw new ApiError('not_found');
  if (link.status !== 'active') throw linkGone(link.status);
  const stored = await withContentionRetry(async (client) => {
    const row = (await client.query<{ status: string; kitchen_id: string }>(`SELECT status, kitchen_id FROM sanitation_reports WHERE kitchen_id=$1 AND month=$2`, [link.kitchen_id, month])).rows[0];
    return row?.status === 'stored' ? row : null;
  });
  if (!stored) throw new ApiError('not_found');
  let bytes: Buffer;
  try {
    bytes = (await ctx.storage.get(`kitchens/${link.kitchen_id}/sanitation/${month}.pdf`))!;
  } catch {
    throw new ApiError('storage_unavailable', {}, (n) => (n === 'storageKind' ? 'download' : ''));
  }
  if (!bytes) throw new ApiError('not_found');
  await withContentionRetry(async (client) => {
    await client.query(`INSERT INTO inspector_access (id, link_id, at, action, target) VALUES ($1,$2,now(),'report',$3)`, [newId('acc'), link.id, month]);
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="sanitation-${month}.pdf"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).end(bytes);
};

export { resolveToken };
