import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { pool, applyMigrations } from './db.js';
import { ApiError, err, linkNotFound, route } from './errors.js';
import { hashPassword, verifyPassword, newSessionToken, tokenFrom, setSessionCookie, clearSessionCookie } from './auth.js';
import { hotelNow, requireRole, requireSignIn } from './guards.js';
import * as stays from './stays.js';
import * as stayActions from './stayActions.js';
import * as folios from './folios.js';
import * as invoices from './invoices.js';
import * as closeMod from './close.js';
import * as reportsMod from './reports.js';
import * as rooms from './rooms.js';
import * as guests from './guests.js';
import * as checkin from './checkin.js';
import * as grading from './grading.js';
import { addClient, removeClient } from './live.js';
import { seedIfEmpty } from './seed.js';
import { healthCheck } from './db.js';
import { smtpProbe } from './mail.js';
import { gotenbergProbe } from './pdf.js';
import { ensureBucket } from './storage.js';
import { isValidDate, compareDates } from './dates.js';
import { freeRoomsText } from './rooms.js';

const publicDir = path.join(process.cwd(), 'dist', 'public');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

// ---- boundary: same-origin only ----
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
    const allowed = config.appPublicUrl ?? `${req.protocol}://${req.get('host')}`;
    if (origin !== allowed) {
      res.status(404).json({ error: 'Not found.' });
      return;
    }
  }
  next();
});

// session cookie to req.sessionToken
app.use((req: Request, _res: Response, next: NextFunction) => {
  (req as Request & { sessionToken?: string }).sessionToken = tokenFrom(req) ?? undefined;
  next();
});

// JSON parsing with content-type and size rules
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'POST' && req.method !== 'PATCH' && req.method !== 'PUT' && req.method !== 'DELETE') {
    next();
    return;
  }
  const contentType = req.headers['content-type'] ?? '';
  const hasBody = (req.headers['content-length'] ?? '0') !== '0';
  const isPhotoRoute = req.path.endsWith('/photo');
  if (isPhotoRoute) {
    next();
    return;
  }
  if (hasBody && contentType && !contentType.includes('application/json')) {
    res.status(415).json({ error: 'Send JSON.' });
    return;
  }
  if (!contentType && !hasBody) {
    express.json({ limit: config.jsonLimitBytes })(req, res, () => next());
    return;
  }
  const declared = Number(req.headers['content-length'] ?? '0');
  if (declared > config.jsonLimitBytes) {
    res.status(413).json({ error: 'That request is too large.' });
    return;
  }
  express.json({ limit: config.jsonLimitBytes, type: 'application/json' })(req, res, (e) => {
    if (e) {
      if (e.type === 'entity.too.large') {
        res.status(413).json({ error: 'That request is too large.' });
        return;
      }
      if (e.type === 'entity.parse.failed' || e instanceof SyntaxError) {
        res.status(415).json({ error: 'Send JSON.' });
        return;
      }
      next(e);
      return;
    }
    next();
  });
});

// photo upload parsing with size limit
app.use('/api/checkin/:token/photo', (req: Request, res: Response, next: NextFunction) => {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.startsWith('multipart/form-data')) {
    res.status(415).json({ error: 'Please upload a JPEG or PNG photo.' });
    return;
  }
  const declared = Number(req.headers['content-length'] ?? '0');
  const overhead = 2048;
  if (declared > config.idPhotoMaxBytes + overhead) {
    res.status(413).json({ error: 'That photo is too large.' });
    return;
  }
  handleMultipart(req, res, next);
});

// ---- sessions ----
app.post('/api/session', route(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password) {
      res.status(401).json({ error: 'That email or password is not right.' });
      return;
    }
    const found = await pool.query(
      'SELECT * FROM users WHERE lower(email) = $1', [email]);
    const user = found.rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: 'That email or password is not right.' });
      return;
    }
    const token = newSessionToken();
    await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1,$2)', [token, user.id]);
    setSessionCookie(res, token);
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, hotelId: user.hotel_id } });
  } catch (e) { next(e); }
}));

app.get('/api/session', requireSignIn(), (req: Request, res: Response) => {
  const user = req.user!;
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, hotelId: user.hotelId } });
});

app.delete('/api/session', requireSignIn(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await pool.query('DELETE FROM sessions WHERE token = $1', [req.sessionToken]);
    clearSessionCookie(res);
    res.status(204).end();
  } catch (e) { next(e); }
});

// ---- desk ----
app.get('/api/desk', requireSignIn(), requireRole('owner', 'front_desk'), route(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const hotel = await hotelNow(user.hotelId);
    const freeText = await freeRoomsText(user.hotelId);
    const lastCloseRow = await pool.query(
      'SELECT * FROM closed_nights WHERE hotel_id = $1 ORDER BY date DESC LIMIT 1', [user.hotelId]);
    res.json({
      hotel: { id: user.hotelId, name: hotel.name, timeZone: hotel.timeZone, businessDate: hotel.businessDate },
      freeRoomsText: freeText,
      lastClose: lastCloseRow.rows[0] ? {
        businessDate: lastCloseRow.rows[0].date,
        roomsCharged: 0, noShows: 0,
        figures: null, rows: []
      } : null
    });
  } catch (e) { next(e); }
}));

// ---- timeline ----
app.get('/api/timeline', requireSignIn(), requireRole('owner', 'front_desk'), route(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    if (typeof from !== 'string' || typeof to !== 'string' || !isValidDate(from) || !isValidDate(to) || compareDates(from, to) > 0) {
      throw err.validation('from', 'Enter a valid date range.');
    }
    if (Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) > 62) {
      throw err.validation('from', 'Enter a valid date range.');
    }
    const hotel = await hotelNow(user.hotelId);
    const dates: string[] = [];
    let date = from;
    while (date <= to) { dates.push(date); date = addDaysLocal(date); }
    const roomsRes = await pool.query(
      'SELECT id, number, type, status FROM rooms WHERE hotel_id = $1 ORDER BY number', [user.hotelId]);
    const blocksRes = await pool.query(
      `(SELECT sn.stay_id, sn.room_id, sn.date, s.status, s.checked_in_online, g.name AS guest_name, s.version
        FROM stay_nights sn
        JOIN stays s ON s.id = sn.stay_id
        JOIN guests g ON g.id = s.guest_id
        WHERE sn.hotel_id = $1 AND sn.date >= $2 AND sn.date <= $3 AND s.status IN ('booked','in_house')
        ORDER BY sn.stay_id, sn.date)
       UNION ALL
       (SELECT sg.stay_id, sg.room_id, sg.first_night, s.status, s.checked_in_online, g.name AS guest_name, s.version
        FROM stay_segments sg
        JOIN stays s ON s.id = sg.stay_id
        JOIN guests g ON g.id = s.guest_id
        JOIN rooms r ON r.id = sg.room_id
        WHERE sg.stay_id IN (SELECT id FROM stays WHERE hotel_id = $1 AND status IN ('cancelled','no_show'))
          AND sg.first_night >= $2 AND sg.first_night <= $3
        ORDER BY sg.stay_id, sg.first_night)`, [user.hotelId, from, to]);
    const blocks: Array<Record<string, unknown>> = [];
    const byStay = new Map<string, { stayId: string; roomId: string; firstNight: string; nights: number; status: string; guestName: string; checkedInOnline: boolean; version: number }>();
    for (const row of blocksRes.rows) {
      const existing = byStay.get(`${row.stay_id}:${row.room_id}`);
      if (existing && addDaysLocal(existing.firstNight, existing.nights) === row.date) {
        existing.nights++;
      } else {
        const block = {
          stayId: row.stay_id, roomId: row.room_id, firstNight: row.date, nights: 1,
          status: row.status, guestName: row.guest_name,
          checkedInOnline: row.checked_in_online, version: row.version
        };
        byStay.set(`${row.stay_id}:${row.room_id}`, block);
        blocks.push(block);
      }
    }
    // Stamps for closed nights: posted totals and ticks
    const stampsRes = await pool.query(
      `SELECT sn.room_id, sn.date, CASE WHEN s.status IN ('booked','in_house') THEN
         (sn.room_cents + sn.tax_cents + sn.city_tax_cents) ELSE NULL END AS stamp
       FROM stay_nights sn JOIN stays s ON s.id = sn.stay_id
       WHERE sn.hotel_id = $1 AND sn.date >= $2 AND sn.date <= $3 AND sn.posted = TRUE`, [user.hotelId, from, to]);
    const stamps = stampsRes.rows.map(r => ({ roomId: r.room_id, date: r.date, stamp: r.stamp }));
    res.json({
      businessDate: hotel.businessDate,
      dates,
      rooms: roomsRes.rows,
      blocks,
      stamps
    });
  } catch (e) { next(e); }
}));

function addDaysLocal(date: string, extra = 1): string {
  const dt = new Date(date + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + extra);
  return dt.toISOString().slice(0, 10);
}

// ---- housekeeping ----
app.get('/api/housekeeping/board', requireSignIn(), route(rooms.board));
app.post('/api/rooms/:id/status', requireSignIn(), route(rooms.setRoomStatus));

// ---- stays ----
app.post('/api/stays/quote', requireSignIn(), requireRole('owner', 'front_desk'), route(stays.quote));
app.post('/api/stays', requireSignIn(), requireRole('owner', 'front_desk'), route(stays.create));
app.get('/api/stays/:id', requireSignIn(), requireRole('owner', 'front_desk'), route(stayActions.getStay));
app.patch('/api/stays/:id', requireSignIn(), requireRole('owner', 'front_desk'), route(stayActions.patchStay));
app.post('/api/stays/:id/move', requireSignIn(), requireRole('owner', 'front_desk'), route(stayActions.moveStay));
app.post('/api/stays/:id/check-in', requireSignIn(), requireRole('owner', 'front_desk'), route(stayActions.checkIn));
app.post('/api/stays/:id/check-out', requireSignIn(), requireRole('owner', 'front_desk'), route(stayActions.checkOut));
app.post('/api/stays/:id/cancel', requireSignIn(), requireRole('owner', 'front_desk'), route(stayActions.cancelStay));
app.post('/api/stays/:id/checkin-link', requireSignIn(), requireRole('owner', 'front_desk'), route(stayActions.resendLink));
app.get('/api/stays/:id/id-photo', requireSignIn(), requireRole('owner', 'front_desk'), route(checkin.photoBytes));

// ---- folios and entries ----
app.post('/api/stays/:id/folios', requireSignIn(), requireRole('owner', 'front_desk'), route(folios.createFolio));
app.patch('/api/folios/:id', requireSignIn(), requireRole('owner', 'front_desk'), route(folios.patchFolio));
app.post('/api/folios/:id/charges', requireSignIn(), requireRole('owner', 'front_desk'), route(folios.addCharge));
app.post('/api/folios/:id/payments', requireSignIn(), requireRole('owner', 'front_desk'), route(folios.addPayment));
app.post('/api/folios/:id/close', requireSignIn(), requireRole('owner', 'front_desk'), route(invoices.closeFolio));
app.post('/api/entries/:id/reverse', requireSignIn(), requireRole('owner', 'front_desk'), route(folios.reverseEntry));
app.post('/api/entries/:id/split', requireSignIn(), requireRole('owner', 'front_desk'), route(folios.splitEntry));
app.post('/api/entries/:id/move', requireSignIn(), requireRole('owner', 'front_desk'), route(folios.moveEntry));
app.post('/api/invoices/:id/email', requireSignIn(), requireRole('owner', 'front_desk'), route(invoices.emailInvoice));
app.get('/api/invoices/:id/pdf', requireSignIn(), requireRole('owner', 'front_desk'), route(invoices.downloadInvoice));

// ---- close and reports ----
app.post('/api/close', requireSignIn(), requireRole('owner'), route(closeMod.runClose));
app.get('/api/reports', requireSignIn(), requireRole('owner'), route(reportsMod.reports));

// ---- rates ----
app.get('/api/rate-plans', requireSignIn(), requireRole('owner', 'front_desk'), route(async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, weeknight_cents, weekend_cents FROM rate_plans WHERE hotel_id = $1 ORDER BY name', [req.user!.hotelId]);
    res.json({ ratePlans: rows.map(r => ({ id: r.id, name: r.name, weeknightCents: r.weeknight_cents, weekendCents: r.weekend_cents })) });
  } catch (e) { next(e); }
}));

app.patch('/api/rate-plans/:id', requireSignIn(), requireRole('owner'), route(async (req, res, next) => {
  try {
    const weeknight = req.body.weeknightCents;
    const weekend = req.body.weekendCents;
    const errors: Record<string, string> = {};
    if (typeof weeknight !== 'number' || !Number.isInteger(weeknight) || weeknight < 0) errors.weeknightCents = 'Enter an amount above zero.';
    if (typeof weekend !== 'number' || !Number.isInteger(weekend) || weekend < 0) errors.weekendCents = 'Enter an amount above zero.';
    if (Object.keys(errors).length) throw err.validations(errors);
    const upd = await pool.query(
      'UPDATE rate_plans SET weeknight_cents = $1, weekend_cents = $2 WHERE id = $3 AND hotel_id = $4 RETURNING *',
      [weeknight, weekend, req.params.id, req.user!.hotelId]);
    if (!upd.rows[0]) throw err.notFound();
    res.json({ id: upd.rows[0].id, name: upd.rows[0].name, weeknightCents: upd.rows[0].weeknight_cents, weekendCents: upd.rows[0].weekend_cents });
  } catch (e) { next(e); }
}));

app.get('/api/tax-rates', requireSignIn(), requireRole('owner', 'front_desk'), route(async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, percent::text AS percent, start_date::text AS start_date FROM tax_rates WHERE hotel_id = $1 ORDER BY start_date NULLS FIRST', [req.user!.hotelId]);
    res.json({ taxRates: rows.map(r => ({ id: r.id, percent: r.percent, startDate: r.start_date })) });
  } catch (e) { next(e); }
}));

app.post('/api/tax-rates', requireSignIn(), requireRole('owner'), route(async (req, res, next) => {
  try {
    const percent = req.body.percent;
    const startDate = req.body.startDate;
    const errors: Record<string, string> = {};
    if (typeof percent !== 'string' || !/^\d{1,2}(\.\d{1,2})?$/.test(percent) || Number(percent) < 0 || Number(percent) > 30) {
      errors.percent = 'Enter a rate from 0 to 30 with at most two decimals.';
    }
    const hotel = await hotelNow(req.user!.hotelId);
    if (typeof startDate !== 'string' || !isValidDate(startDate) || compareDates(startDate, hotel.businessDate) <= 0) {
      errors.startDate = 'The start date must be after the business date.';
    }
    if (Object.keys(errors).length) throw err.validations(errors);
    const existing = await pool.query(
      'SELECT id FROM tax_rates WHERE hotel_id = $1 AND start_date = $2', [req.user!.hotelId, startDate]);
    if (existing.rows[0]) {
      const upd = await pool.query(
        'UPDATE tax_rates SET percent = $1 WHERE id = $2 RETURNING *', [percent, existing.rows[0].id]);
      res.status(201).json({ id: upd.rows[0].id, percent: upd.rows[0].percent, startDate: upd.rows[0].start_date });
      return;
    }
    const newId = 't' + crypto.randomBytes(8).toString('hex');
    await pool.query(
      'INSERT INTO tax_rates (id, hotel_id, percent, start_date) VALUES ($1,$2,$3,$4)',
      [newId, req.user!.hotelId, percent, startDate]);
    res.status(201).json({ id: newId, percent, startDate });
  } catch (e) { next(e); }
}));

// ---- guests ----
app.get('/api/guests', requireSignIn(), requireRole('owner', 'front_desk'), route(guests.searchGuests));
app.get('/api/guests/:id', requireSignIn(), requireRole('owner', 'front_desk'), route(guests.getGuest));
app.post('/api/guests/merge', requireSignIn(), requireRole('owner', 'front_desk'), route(guests.mergeGuests));

// ---- live ----
app.get('/api/live', requireSignIn(), (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 1000\n\n');
  const client = addClient(req.user!.hotelId, req.user!.role, res);
  req.on('close', () => removeClient(client));
});

// ---- check-in links ----
app.get('/api/checkin/:token', route(checkin.checkinInfo));
app.post('/api/checkin/:token/photo', route(checkin.uploadPhoto));
app.post('/api/checkin/:token/complete', (req: Request, res: Response, next: NextFunction) => {
  // JSON parsing for complete
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.includes('application/json')) {
    res.status(415).json({ error: 'Send JSON.' });
    return;
  }
  express.json({ limit: config.jsonLimitBytes })(req, res, () => {
    checkin.completeCheckin(req, res).catch(next);
  });
});

// ---- grading ----
app.post('/api/grading/setup', route(grading.setup));
app.post('/api/grading/clock', route(grading.clock));

// ---- health ----
app.get('/api/health', route(async (_req: Request, res: Response) => {
  const [pgOk, gotOk, s3Ok, smtpOk] = await Promise.all([
    healthCheck(), gotenbergProbe(), ensureBucket(), smtpProbe()
  ]);
  res.json({ status: pgOk && gotOk && s3Ok && smtpOk ? 'ok' : 'unavailable' });
}));

// ---- static pages ----
const blockedPrefixes = ['/src', '/scripts', '/node_modules', '/.env', '/dist', '/tsconfig'];
const blockedFiles = ['run.json', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.client.json', '.env'];
app.use((req: Request, res: Response, next: NextFunction) => {
  const pathname = decodeURIComponent(new URL(req.originalUrl, 'http://x').pathname);
  const base = pathname.split('/').pop() ?? '';
  if (blockedPrefixes.some(p => pathname.startsWith(p)) || blockedFiles.some(f => base === f) || pathname.endsWith('.ts')) {
    res.status(404).send('Not found.');
    return;
  }
  next();
});

app.use(express.static(publicDir, { index: 'index.html', fallthrough: true }));
app.use((req: Request, res: Response) => {
  const pathname = new URL(req.originalUrl, 'http://x').pathname;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(404).json({ error: 'Not found.' });
    return;
  }
  if (pathname.startsWith('/api/')) {
    res.status(404).json({ error: 'Not found.' });
    return;
  }
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  res.type('html').send(html);
});

// ---- errors ----
app.use((e: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (e instanceof ApiError) {
    res.status(e.status).json(e.body);
    return;
  }
  const anyE = e as { status?: number; body?: unknown };
  if (anyE && typeof anyE.status === 'number' && anyE.body) {
    res.status(anyE.status).json(anyE.body);
    return;
  }
  console.error(e);
  res.status(500).json({ error: 'Not found.' });
});

// ---- sessions table ----
async function ensureSessionsTable(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}

function handleMultipart(req: Request, res: Response, next: NextFunction): void {
  // Minimal multipart parser: find the file part named photo
  const chunks: Buffer[] = [];
  let total = 0;
  const limit = config.idPhotoMaxBytes + 2048;
  let aborted = false;
  req.on('data', (chunk: Buffer) => {
    if (aborted) return;
    total += chunk.length;
    if (total > limit) {
      aborted = true;
      res.status(413).json({ error: 'That photo is too large.' });
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted) return;
    const body = Buffer.concat(chunks);
    const file = parseMultipartPhoto(body, req.headers['content-type'] ?? '');
    if (!file) {
      res.status(415).json({ error: 'Please upload a JPEG or PNG photo.' });
      return;
    }
    (req as Request & { file?: { buffer: Buffer; size: number } }).file = file;
    next();
  });
  req.on('error', () => {
    if (!aborted && !res.headersSent) res.status(400).json({ error: 'Please upload a JPEG or PNG photo.' });
  });
}

function parseMultipartPhoto(body: Buffer, contentType: string): { buffer: Buffer; size: number } | null {
  const match = contentType.match(/boundary="?([^";]+)"?/);
  if (!match) return null;
  const boundary = Buffer.from(`--${match[1]}`);
  let index = body.indexOf(boundary);
  while (index !== -1) {
    const partStart = index + boundary.length + 2; // skip \r\n
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), partStart);
    if (headerEnd === -1) return null;
    const headers = body.subarray(partStart, headerEnd).toString('utf8');
    const next = body.indexOf(boundary, headerEnd);
    if (next === -1) return null;
    if (/name="photo"/.test(headers)) {
      const content = body.subarray(headerEnd + 4, next - 2);
      return { buffer: content, size: content.length };
    }
    index = next;
  }
  return null;
}

async function main(): Promise<void> {
  await applyMigrations();
  await ensureSessionsTable();
  await seedIfEmpty();
  const port = Number(process.env.PORT ?? config.appPublicPort);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Nightroll listening on 0.0.0.0:${port}`);
  });
}

main().catch(e => {
  console.error('Failed to start', e);
  process.exit(1);
});
