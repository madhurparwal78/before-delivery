import type { Request, Response } from 'express';
import { pool, ensureSchema, isDbError } from './db.js';
import { appNow, setTestClock, isoZ } from './app-clock.js';
import { ApiError, type FieldErrors } from '../shared/errors.js';
import { readBody, isCrossOrigin, isDbFailure, sendApiError, h } from './boundary.js';
import {
  RITUAL_CATALOGUE, FIELD_MESSAGES, normaliseEmail, validBedtime, validNote, validRituals,
  ritualTitle, totalMinutes, startsAtLocal, countCharacters,
} from '../shared/plan.js';
import { isZone } from '../shared/time.js';
import { issueLink, queueConfirmationEmail, queueSignInEmail, shareToken, hourId, poolExec } from './emails.js';
import { tryDeliverOne } from './outbox.js';
import { runDueReminders, nextReminderFor } from './scheduler.js';
import { COOKIE_NAME, createSession, sessionEmail, endSession, cookieHeader, SESSION_MAX_AGE } from './sessions.js';
import { config } from './config.js';

const IDEMPOTENCY_RE = /^[\x20-\x7E]{8,64}$/;
const IDEMPOTENCY_MS = 24 * 60 * 60 * 1000;
const LINK_TTL_MS = 15 * 60 * 1000;

interface HourRow {
  id: string;
  email: string;
  status: string;
  bedtime: string;
  time_zone: string;
  note: string;
  reminders: string;
  version: number;
  confirmed_at: Date | null;
  reminders_start: Date | null;
}

interface ShareRow {
  token: string;
  created_at: Date;
}

async function touchDb(): Promise<void> {
  await ensureSchema();
  await pool.query('SELECT 1');
}

async function getRituals(hourId: string): Promise<{ id: string; minutes: number }[]> {
  const r = await pool.query<{ id: string; minutes: number; position: number }>(
    'SELECT id, minutes, position FROM rituals WHERE hour_id = $1 ORDER BY position',
    [hourId],
  );
  return r.rows.map((x) => ({ id: x.id, minutes: x.minutes }));
}

async function planShape(row: HourRow): Promise<Record<string, unknown>> {
  const rituals = await getRituals(row.id);
  const share = await pool.query<ShareRow>('SELECT token, created_at FROM shares WHERE hour_id = $1', [row.id]);
  const next = await nextReminderFor(row.id, row.time_zone, row.bedtime, row.reminders, row.reminders_start);
  return {
    id: row.id,
    email: row.email,
    bedtime: row.bedtime,
    time_zone: row.time_zone,
    rituals: rituals.map((r) => ({ id: r.id, title: ritualTitle(r.id), minutes: r.minutes })),
    total_minutes: totalMinutes(rituals),
    note: row.note,
    reminders: row.reminders,
    version: row.version,
    starts_at_local: startsAtLocal(row.bedtime),
    next_reminder_at: next === null ? null : isoZ(next),
    share_url: share.rows[0] ? `/p/${share.rows[0].token}` : null,
  };
}

async function confirmedHour(email: string): Promise<HourRow | null> {
  const r = await pool.query<HourRow>(
    `SELECT id, email, status, bedtime, time_zone, note, reminders, version, confirmed_at, reminders_start
     FROM hours WHERE email = $1 AND status = 'confirmed'`,
    [email],
  );
  return r.rows[0] ?? null;
}

async function draftHour(email: string): Promise<HourRow | null> {
  const r = await pool.query<HourRow>(
    `SELECT id, email, status, bedtime, time_zone, note, reminders, version, confirmed_at, reminders_start
     FROM hours WHERE email = $1 AND status = 'draft'`,
    [email],
  );
  return r.rows[0] ?? null;
}

// ---------- validation ----------

function checkPlanFields(body: unknown, mode: 'save' | 'patch'): FieldErrors {
  const fields: FieldErrors = {};
  const isSave = mode === 'save';
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    const required = isSave ? ['email', 'bedtime', 'time_zone', 'rituals'] : [];
    for (const f of required) fields[f] = FIELD_MESSAGES[f as keyof typeof FIELD_MESSAGES];
    return fields;
  }
  const obj = body as Record<string, unknown>;
  if (isSave) {
    for (const f of ['email', 'bedtime', 'time_zone', 'rituals'] as const) {
      if (!(f in obj)) fields[f] = FIELD_MESSAGES[f];
    }
  }
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    switch (key) {
      case 'email':
        if (mode === 'patch') {
          fields[key] = FIELD_MESSAGES.extra;
        } else if (!normaliseEmail(v)) {
          fields[key] = FIELD_MESSAGES.email;
        }
        break;
      case 'bedtime':
        if (!validBedtime(v)) fields[key] = FIELD_MESSAGES.bedtime;
        break;
      case 'time_zone':
        if (typeof v !== 'string' || !isZone(v)) fields[key] = FIELD_MESSAGES.time_zone;
        break;
      case 'rituals':
        if (!validRituals(v)) fields[key] = FIELD_MESSAGES.rituals;
        break;
      case 'note':
        if (!validNote(v)) fields[key] = FIELD_MESSAGES.note;
        break;
      case 'reminders':
        if (mode === 'save') fields[key] = FIELD_MESSAGES.extra;
        else if (v !== 'on' && v !== 'paused') fields[key] = FIELD_MESSAGES.reminders;
        break;
      default:
        fields[key] = FIELD_MESSAGES.extra;
    }
  }
  return fields;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

// ---------- rate limits ----------

async function rateCount(email: string, bucket: 'plans' | 'session_request'): Promise<number> {
  const now = await appNow();
  const since = new Date(now - 60 * 60 * 1000);
  const r = await pool.query<{ at: Date }>(
    'SELECT at FROM rate_limits WHERE email = $1 AND bucket = $2 AND at > $3 ORDER BY at',
    [email, bucket, since],
  );
  return r.rows.length;
}

async function rateRetryAfter(email: string, bucket: 'plans' | 'session_request'): Promise<number> {
  const now = await appNow();
  const since = new Date(now - 60 * 60 * 1000);
  const r = await pool.query<{ at: Date }>(
    'SELECT at FROM rate_limits WHERE email = $1 AND bucket = $2 AND at > $3 ORDER BY at LIMIT 1',
    [email, bucket, since],
  );
  const oldest = r.rows[0]?.at;
  if (!oldest) return 1;
  const ready = new Date(oldest).getTime() + 60 * 60 * 1000;
  const seconds = Math.ceil((ready - now) / 1000);
  return Math.max(1, seconds);
}

async function countSave(email: string): Promise<void> {
  const now = await appNow();
  await pool.query('INSERT INTO rate_limits (email, bucket, at) VALUES ($1, $2, $3)', [email, 'plans', new Date(now)]);
}

// ---------- routes ----------

export function registerApi(router: import('express').Router): void {
  router.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/tonight', h(async (req, res) => {
    await touchDb();
    const r = await pool.query('SELECT count(*)::int AS n FROM hours WHERE status = $1 AND reminders = $2', ['confirmed', 'on']);
    res.json({ keeping: r.rows[0]?.n ?? 0 });
  }));

  router.post('/plans', h(async (req, res) => {
    if (isCrossOrigin(req)) throw new ApiError('cross_origin');
    const body = await readBody(req);
    await touchDb();
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !IDEMPOTENCY_RE.test(key)) {
      throw new ApiError('idempotency_key_required');
    }
    const fields = checkPlanFields(body, 'save');
    if (Object.keys(fields).length > 0) throw new ApiError('invalid', { fields });

    const email = normaliseEmail((body as Record<string, unknown>).email)!;
    const canonical = canonicalJson(body);

    // claim the idempotency key; the claimant processes the save
    for (let attempt = 0; attempt < 3; attempt++) {
      const claim = await pool.query(
        `INSERT INTO idempotency (key, email, body, status, response, created_at)
         VALUES ($1,$2,$3,NULL,NULL,now())
         ON CONFLICT (key) DO NOTHING RETURNING key`,
        [key, email, canonical],
      );
      if ((claim.rowCount ?? 0) === 1) {
        const count = await rateCount(email, 'plans');
        if (count >= 3) {
          await pool.query('DELETE FROM idempotency WHERE key = $1', [key]);
          throw new ApiError('rate_limited', { retryAfter: await rateRetryAfter(email, 'plans') });
        }
        const planBody = body as { bedtime: string; time_zone: string; rituals: { id: string; minutes: number }[]; note?: unknown };
        const sent = await saveDraftAndSendConfirmation(email, planBody, originBase(req));
        const responseBody = JSON.stringify({ status: sent ? 'confirmation_sent' : 'confirmation_queued' });
        await pool.query('UPDATE idempotency SET status = 202, response = $1 WHERE key = $2', [responseBody, key]);
        res.status(202).json({ status: sent ? 'confirmation_sent' : 'confirmation_queued' });
        return;
      }
      const existing = await pool.query<{ body: string; status: number | null; response: string | null; created_at: Date }>(
        'SELECT body, status, response, created_at FROM idempotency WHERE key = $1',
        [key],
      );
      const row = existing.rows[0];
      if (row) {
        // the key is remembered for 24 hours on the app clock
        const now = await appNow();
        if (now - new Date(row.created_at).getTime() >= IDEMPOTENCY_MS) {
          await pool.query('DELETE FROM idempotency WHERE key = $1', [key]);
          continue;
        }
      }
      if (!row) continue; // the claimant failed; try to claim again
      if (row.body !== canonical) throw new ApiError('idempotency_conflict');
      if (row.status !== null && row.response !== null) {
        res.status(row.status).json(JSON.parse(row.response));
        return;
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    throw new ApiError('idempotency_conflict');
  }));

  router.post('/session/request', h(async (req, res) => {
    if (isCrossOrigin(req)) throw new ApiError('cross_origin');
    const body = await readBody(req);
    await touchDb();
    const obj = (typeof body === 'object' && body !== null && !Array.isArray(body)) ? body as Record<string, unknown> : {};
    if (!('email' in obj) || !normaliseEmail(obj.email)) {
      throw new ApiError('invalid', { fields: { email: FIELD_MESSAGES.email } });
    }
    const email = normaliseEmail(obj.email)!;
    const count = await rateCount(email, 'session_request');
    if (count >= 5) {
      throw new ApiError('rate_limited', { retryAfter: await rateRetryAfter(email, 'session_request') });
    }
    const hasHour = (await draftHour(email)) !== null || (await confirmedHour(email)) !== null;
    if (hasHour) {
      const token = await issueLink(poolExec, email, 'signin');
      const id = await queueSignInEmail(poolExec, email, token, originBase(req));
      void tryDeliverOne(id).catch(() => undefined);
    }
    const now = await appNow();
    await pool.query('INSERT INTO rate_limits (email, bucket, at) VALUES ($1,$2,$3)', [email, 'session_request', new Date(now)]);
    res.status(202).json({ status: 'link_sent' });
  }));

  router.post('/session/verify', h(async (req, res) => {
    if (isCrossOrigin(req)) throw new ApiError('cross_origin');
    const body = await readBody(req);
    await touchDb();
    const obj = (typeof body === 'object' && body !== null && !Array.isArray(body)) ? body as Record<string, unknown> : {};
    if (!('token' in obj) || typeof obj.token !== 'string' || obj.token.length === 0) {
      throw new ApiError('invalid', { fields: { token: FIELD_MESSAGES.token } });
    }
    const token = obj.token;
    const now = await appNow();
    const link = await pool.query<{ email: string; purpose: string; state: string; expires_at: Date | null }>(
      'SELECT email, purpose, state, expires_at FROM links WHERE token = $1',
      [token],
    );
    const row = link.rows[0];
    if (!row) throw new ApiError('link_unknown');
    if (row.state === 'used') throw new ApiError('link_used');
    if (row.expires_at && now >= new Date(row.expires_at).getTime()) throw new ApiError('link_expired');
    const used = await pool.query(
      `UPDATE links SET state = 'used' WHERE token = $1 AND state = 'issued' RETURNING token`,
      [token],
    );
    if ((used.rowCount ?? 0) === 0) throw new ApiError('link_used');

    let confirmed = (await confirmedHour(row.email)) !== null;
    if (row.purpose === 'confirm') {
      confirmed = await confirmDraft(row.email, now);
    }
    const session = await createSession(row.email);
    res.setHeader('Set-Cookie', cookieHeader(session, SESSION_MAX_AGE));
    res.status(200).json({ signed_in: true, email: row.email, confirmed });
  }));

  router.post('/session/end', h(async (req, res) => {
    if (isCrossOrigin(req)) throw new ApiError('cross_origin');
    await endSession(req.cookies?.[COOKIE_NAME]);
    res.setHeader('Set-Cookie', cookieHeader('', 0));
    res.status(204).end();
  }));

  router.get('/me/plan', h(async (req, res) => {
    await touchDb();
    const email = await sessionEmail(req.cookies?.[COOKIE_NAME]);
    if (!email) throw new ApiError('signed_out');
    const hour = await confirmedHour(email);
    if (!hour) throw new ApiError('no_plan');
    res.json({ plan: await planShape(hour) });
  }));

  router.patch('/me/plan', h(async (req, res) => {
    if (isCrossOrigin(req)) throw new ApiError('cross_origin');
    const body = await readBody(req);
    await touchDb();
    const email = await sessionEmail(req.cookies?.[COOKIE_NAME]);
    if (!email) throw new ApiError('signed_out');
    const hour = await confirmedHour(email);
    if (!hour) throw new ApiError('no_plan');
    const ifMatch = req.headers['if-match'];
    if (typeof ifMatch !== 'string' || ifMatch.length === 0) throw new ApiError('version_required');
    const currentVersion = hour.version;
    const supplied = Number(ifMatch.replace(/^"|"$/g, ''));
    if (supplied !== currentVersion || !Number.isFinite(supplied)) {
      throw new ApiError('version_conflict', { current: await planShape(hour) });
    }
    if (body === undefined) throw new ApiError('invalid');
    const obj = (typeof body === 'object' && body !== null && !Array.isArray(body)) ? body as Record<string, unknown> : null;
    if (obj === null) throw new ApiError('invalid');
    if (Object.keys(obj).length === 0) throw new ApiError('invalid');
    const fields = checkPlanFields(obj, 'patch');
    if (Object.keys(fields).length > 0) throw new ApiError('invalid', { fields });

    const now = await appNow();
    const next: Record<string, unknown> = {};
    if ('bedtime' in obj) next.bedtime = obj.bedtime;
    if ('time_zone' in obj) next.time_zone = obj.time_zone;
    if ('note' in obj) next.note = obj.note;
    if ('reminders' in obj) next.reminders = obj.reminders;
    const bedtime = (next.bedtime as string | undefined) ?? hour.bedtime;
    const zone = (next.time_zone as string | undefined) ?? hour.time_zone;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query<HourRow>(
        `UPDATE hours SET bedtime = $1, time_zone = $2,
           note = $3, reminders = $4,
           reminders_start = CASE WHEN $5 THEN $6 ELSE reminders_start END,
           version = version + 1, updated_at = $6
         WHERE id = $7 AND version = $8
         RETURNING id, email, status, bedtime, time_zone, note, reminders, version, confirmed_at, reminders_start`,
        [bedtime, zone, (next.note as string | undefined) ?? hour.note,
          (next.reminders as string | undefined) ?? hour.reminders,
          'bedtime' in obj || 'time_zone' in obj || obj.reminders === 'on',
          new Date(now), hour.id, currentVersion],
      );
      if ((updated.rowCount ?? 0) === 0) {
        const fresh = await confirmedHour(email);
        throw new ApiError('version_conflict', { current: await planShape(fresh ?? hour) });
      }
      if ('rituals' in obj) {
        const rituals = validRituals(obj.rituals)!;
        await client.query('DELETE FROM rituals WHERE hour_id = $1', [hour.id]);
        let pos = 0;
        for (const r of rituals) {
          await client.query('INSERT INTO rituals (hour_id, id, minutes, position) VALUES ($1,$2,$3,$4)', [hour.id, r.id, r.minutes, pos++]);
        }
      }
      await client.query('COMMIT');
      res.json({ plan: await planShape(updated.rows[0]!) });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }));

  router.post('/me/share', h(async (req, res) => {
    if (isCrossOrigin(req)) throw new ApiError('cross_origin');
    await readBody(req);
    await touchDb();
    const email = await sessionEmail(req.cookies?.[COOKIE_NAME]);
    if (!email) throw new ApiError('signed_out');
    const hour = await confirmedHour(email);
    if (!hour) throw new ApiError('no_plan');
    const token = shareToken();
    const now = await appNow();
    await pool.query('DELETE FROM shares WHERE hour_id = $1', [hour.id]);
    await pool.query('INSERT INTO shares (hour_id, token, created_at) VALUES ($1,$2,$3)', [hour.id, token, new Date(now)]);
    res.status(201).json({ share: { url: `/p/${token}`, created_at: isoZ(now) } });
  }));

  router.delete('/me/share', h(async (req, res) => {
    if (isCrossOrigin(req)) throw new ApiError('cross_origin');
    await readBody(req);
    await touchDb();
    const email = await sessionEmail(req.cookies?.[COOKIE_NAME]);
    if (!email) throw new ApiError('signed_out');
    const hour = await confirmedHour(email);
    if (!hour) throw new ApiError('no_plan');
    await pool.query('DELETE FROM shares WHERE hour_id = $1', [hour.id]);
    res.status(204).end();
  }));

  router.get('/share/:token', h(async (req, res) => {
    await touchDb();
    const r = await pool.query<{ bedtime: string; time_zone: string }>(
      `SELECT h.bedtime, h.time_zone FROM shares s JOIN hours h ON h.id = s.hour_id
       WHERE s.token = $1 AND h.status = 'confirmed'`,
      [req.params.token],
    );
    const row = r.rows[0];
    if (!row) throw new ApiError('not_found');
    const rituals = await pool.query<{ id: string; minutes: number }>(
      `SELECT r.id, r.minutes FROM shares s JOIN rituals r ON r.hour_id = s.hour_id
       WHERE s.token = $1 ORDER BY r.position`,
      [req.params.token],
    );
    const list = rituals.rows.map((x) => ({ id: x.id, title: ritualTitle(x.id), minutes: x.minutes }));
    res.json({ plan: { bedtime: row.bedtime, time_zone: row.time_zone, rituals: list, total_minutes: totalMinutes(list) } });
  }));

  router.delete('/me', h(async (req, res) => {
    if (isCrossOrigin(req)) throw new ApiError('cross_origin');
    await readBody(req);
    await touchDb();
    const email = await sessionEmail(req.cookies?.[COOKIE_NAME]);
    if (!email) throw new ApiError('signed_out');
    await pool.query('DELETE FROM links WHERE email = $1', [email]);
    await pool.query('DELETE FROM sessions WHERE email = $1', [email]);
    await pool.query('DELETE FROM outbox WHERE email = $1', [email]);
    await pool.query(
      'DELETE FROM reminder_records WHERE hour_id IN (SELECT id FROM hours WHERE email = $1)',
      [email],
    );
    await pool.query('DELETE FROM hours WHERE email = $1', [email]);
    res.setHeader('Set-Cookie', cookieHeader('', 0));
    res.status(204).end();
  }));

  if (config.testClock) {
    router.put('/test/clock', h(async (req, res) => {
      if (isCrossOrigin(req)) throw new ApiError('cross_origin');
      const body = await readBody(req);
      await touchDb();
      const obj = (typeof body === 'object' && body !== null && !Array.isArray(body)) ? body as Record<string, unknown> : {};
      if (typeof obj.now !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(obj.now) || Number.isNaN(Date.parse(obj.now))) {
        throw new ApiError('invalid', { fields: { now: 'Send an ISO 8601 date and time with a time zone.' } });
      }
      const at = new Date(obj.now).getTime();
      await setTestClock(at);
      await runDueReminders();
      res.json({ now: isoZ(at) });
    }));

    router.delete('/test/clock', h(async (req, res) => {
      if (isCrossOrigin(req)) throw new ApiError('cross_origin');
      await touchDb();
      await setTestClock(null);
      await runDueReminders();
      res.status(204).end();
    }));
  }
}

// ---------- helpers ----------

function originBase(req: Request): string {
  if (config.publicOrigin) return config.publicOrigin.replace(/\/$/, '');
  const host = req.headers.host ?? `localhost:${config.port}`;
  const proto = req.headers['x-forwarded-proto'] ?? 'http';
  return `${proto}://${host}`;
}

async function saveDraftAndSendConfirmation(
  email: string,
  plan: { bedtime: string; time_zone: string; rituals: { id: string; minutes: number }[]; note?: unknown },
  origin: string,
): Promise<boolean> {
  const now = await appNow();
  const client = await pool.connect();
  const id = hourId();
  let outboxEmailId: string;
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM hours WHERE email = $1 AND status = $2', [email, 'draft']);
    await client.query(
      `INSERT INTO hours (id, email, status, bedtime, time_zone, note, reminders, version, created_at, updated_at)
       VALUES ($1,$2,'draft',$3,$4,$5,'on',0,$6,$6)`,
      [id, email, plan.bedtime, plan.time_zone, typeof plan.note === 'string' ? plan.note : '', new Date(now)],
    );
    let pos = 0;
    for (const r of plan.rituals) {
      await client.query('INSERT INTO rituals (hour_id, id, minutes, position) VALUES ($1,$2,$3,$4)', [id, r.id, r.minutes, pos++]);
    }
    const token = await issueLink(client, email, 'confirm');
    outboxEmailId = await queueConfirmationEmail(
      client,
      email,
      token,
      { bedtime: plan.bedtime, time_zone: plan.time_zone, rituals: plan.rituals },
      origin,
    );
    await client.query('INSERT INTO rate_limits (email, bucket, at) VALUES ($1,$2,$3)', [email, 'plans', new Date(now)]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    throw err;
  }
  client.release();
  return tryDeliverOne(outboxEmailId);
}

async function confirmDraft(email: string, now: number): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const draft = await client.query<HourRow>(
      `SELECT id, email, status, bedtime, time_zone, note, reminders, version, confirmed_at, reminders_start
       FROM hours WHERE email = $1 AND status = 'draft' FOR UPDATE`,
      [email],
    );
    const draftRow = draft.rows[0];
    const confirmed = await confirmedHour(email);
    if (confirmed && draftRow) {
      await client.query(
        `UPDATE hours SET bedtime = $1, time_zone = $2, note = $3, reminders = 'on',
           version = version + 1, confirmed_at = $4, reminders_start = $4, updated_at = $4
         WHERE id = $5`,
        [draftRow.bedtime, draftRow.time_zone, draftRow.note, new Date(now), confirmed.id],
      );
      await client.query('DELETE FROM rituals WHERE hour_id = $1', [confirmed.id]);
      const rituals = await client.query<{ id: string; minutes: number }>(
        'SELECT id, minutes FROM rituals WHERE hour_id = $1 ORDER BY position',
        [draftRow.id],
      );
      let pos = 0;
      for (const r of rituals.rows) {
        await client.query('INSERT INTO rituals (hour_id, id, minutes, position) VALUES ($1,$2,$3,$4)', [confirmed.id, r.id, r.minutes, pos++]);
      }
      await client.query('DELETE FROM hours WHERE id = $1', [draftRow.id]);
    } else if (!confirmed && draftRow) {
      await client.query(
        `UPDATE hours SET status = 'confirmed', reminders = 'on', version = 1,
           confirmed_at = $1, reminders_start = $1, updated_at = $1 WHERE id = $2`,
        [new Date(now), draftRow.id],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return (await confirmedHour(email)) !== null;
}
