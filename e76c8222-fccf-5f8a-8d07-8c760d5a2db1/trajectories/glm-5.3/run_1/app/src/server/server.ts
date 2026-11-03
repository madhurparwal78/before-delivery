import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { config, PASSCODE } from './config.js';
import { pool, withTransaction } from './db.js';
import { migrateAndSeed, passcodeHash, newId, newToken } from './seed.js';
import { ApiError, apiError } from './api-error.js';
import {
  boardData, loadRequestRow, loadSeatRows, loadSeatById, loadPrepFiles, requestFullView,
  renderRequest, getRates, readAudit, loadQuote, evaluateGatesForSeat, myAssignments,
  writeAudit, expireOverdueOffersForSeat,
} from './store.js';
import {
  answerOffer, cancelRequest, pinSeat, submitTimesheet, approveTimesheet,
  savePreferences, sendExpiryWarnings, ensureOrgAccount, validIdempotencyKey,
} from './dispatch.js';
import {
  createRequest, patchRequest, submitRequest, attachPrepFile, addCredential,
  type RequestInput,
} from './requests.js';
import * as kb from './services/killbill.js';
import { probeMail } from './services/mail.js';
import { probeStorage } from './services/s3.js';
import { getObject } from './services/s3.js';
import { runOutboxTick } from './services/outbox.js';
import { buildTimesheetPdf } from './services/pdf.js';
import { centsToMoney, moneyToCents } from './money.js';
import { agencyWallClockToInstant, dateKeyInAgencyTz, isoWithOffset, MS_PER_MINUTE } from './time.js';
import type { RequestView, SessionUser } from './types.js';

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v);
const str = (v: unknown): string => String(v);

const JSON_LIMIT = 64 * 1024;
const UPLOAD_LIMIT = 10 * 1024 * 1024;

const server = http.createServer(handle);
let dbReady = false;
let publicUrl = config.publicUrl;

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    await route(req, res);
  } catch (err) {
    if (err instanceof ApiError) {
      sendError(res, err);
    } else {
      console.error('Unhandled error', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: 'internal', message: 'Something went wrong.' } }));
    }
  }
}

function sendError(res: http.ServerResponse, err: ApiError): void {
  res.writeHead(err.status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(err.body());
}

async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    // Same-origin rule for mutating API requests.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin && origin !== publicUrl && origin !== `http://${req.headers.host}`) {
        throw apiError('cross_origin');
      }
    }
    await apiRoute(req, res, pathname, url);
    return;
  }

  if (pathname === '/healthz' || pathname === '/health') {
    res.writeHead(dbReady ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: dbReady ? 'ok' : 'starting' }));
    return;
  }

  if (pathname.startsWith('/api') || pathname === '/run.json' || pathname === '/package.json' || pathname.startsWith('/src/') || pathname === '/esbuild.mjs' || pathname === '/tsconfig.json' || pathname === '/tsconfig.build.json' || pathname.startsWith('/.') || pathname === '/THIRD_PARTY_NOTICES.md' || pathname === '/AGENTS.md') {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code: 'not_found', message: 'Nothing was found here.' } }));
    return;
  }

  serveClient(pathname, res);
}

function serveClient(pathname: string, res: http.ServerResponse): void {
  const dist = path.resolve('dist');
  let filePath = pathname === '/' ? '/index.html' : pathname;
  const candidate = path.join(dist, filePath);
  if (!candidate.startsWith(dist)) {
    res.writeHead(404).end();
    return;
  }
  if (filePath === '/index.html' || !fs.existsSync(candidate)) {
    const index = path.join(dist, 'index.html');
    if (fs.existsSync(index)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(index).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>Seatweaver</title><p>Client build missing. Run npm run build.</p>');
    return;
  }
  const types: Record<string, string> = {
    '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8',
    '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  };
  const ext = path.extname(candidate).toLowerCase();
  res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream' });
  fs.createReadStream(candidate).pipe(res);
}

// ---------- request body helpers ----------

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const raw = await readBody(req, JSON_LIMIT);
  if (raw === null) throw apiError('payload_too_large');
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw apiError('bad_json');
  }
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) { resolve(null); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        aborted = true;
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!aborted) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

interface MultipartPart {
  name: string;
  filename: string | null;
  contentType: string;
  bytes: Buffer;
}

async function readMultipart(req: http.IncomingMessage): Promise<Map<string, MultipartPart>> {
  const raw = await readBody(req, UPLOAD_LIMIT);
  if (raw === null) throw apiError('payload_too_large');
  const contentType = String(req.headers['content-type'] ?? '');
  const match = /boundary=(.+)$/.exec(contentType);
  if (!match) throw apiError('bad_json');
  const boundary = `--${match[1]}`;
  const parts = new Map<string, MultipartPart>();
  const text = raw;
  let idx = text.indexOf(boundary);
  while (idx !== -1) {
    const start = idx + boundary.length;
    const next = text.indexOf(boundary, start);
    if (next === -1) break;
    const section = text.subarray(start, next);
    const headerEnd = section.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerText = section.subarray(0, headerEnd).toString('utf8');
      const body = section.subarray(headerEnd + 4, section.length - 2);
      const nameMatch = /name="([^"]*)"/.exec(headerText);
      const fileMatch = /filename="([^"]*)"/.exec(headerText);
      const typeMatch = /Content-Type:\s*(.+)$/im.exec(headerText);
      if (nameMatch) {
        parts.set(nameMatch[1]!, {
          name: nameMatch[1]!,
          filename: fileMatch ? fileMatch[1]! : null,
          contentType: typeMatch ? typeMatch[1]!.trim() : '',
          bytes: Buffer.from(body),
        });
      }
    }
    idx = next;
  }
  return parts;
}

// ---------- sessions ----------

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

async function currentUser(req: http.IncomingMessage): Promise<SessionUser | null> {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies.get('sw_session');
  if (!sid) return null;
  const res = await pool.query<Row>(
    `SELECT u.id, u.name, u.email, u.role, u.org_id FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [sid],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { id: str(row.id), name: str(row.name), email: str(row.email), role: str(row.role) as SessionUser['role'], org_id: row.org_id === null ? null : str(row.org_id) };
}

function parseCookies(header: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) return map;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k) map.set(k, rest.join('='));
  }
  return map;
}

async function requireUser(req: http.IncomingMessage): Promise<SessionUser> {
  const user = await currentUser(req);
  if (!user) throw apiError('unauthenticated');
  return user;
}

async function requireRole(req: http.IncomingMessage, roles: SessionUser['role'][]): Promise<SessionUser> {
  const user = await requireUser(req);
  if (!roles.includes(user.role)) throw apiError('forbidden');
  return user;
}

// ---------- API routes ----------

async function apiRoute(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  const seg = pathname.split('/').filter(Boolean).slice(1);

  if (pathname === '/api/health') {
    res.writeHead(dbReady ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: dbReady ? 'ok' : 'starting' }));
    return;
  }

  if (pathname === '/api/system/status') {
    const [killbill, mail, storage] = await Promise.all([kb.probeKillBill(), probeMail(), probeStorage()]);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ postgres: dbReady ? 'up' : 'down', killbill: killbill ? 'up' : 'down', mail: mail ? 'up' : 'down', storage: storage ? 'up' : 'down' }));
    return;
  }

  if (pathname === '/api/session' && method === 'POST') {
    const body = (await readJson(req)) as { email?: unknown; passcode?: unknown };
    const fields: Record<string, string> = {};
    if (typeof body.email !== 'string' || !body.email) fields.email = 'Enter your email.';
    if (typeof body.passcode !== 'string' || !body.passcode) fields.passcode = 'Enter the passcode.';
    if (Object.keys(fields).length > 0) throw apiError('validation', { fields });
    const found = await pool.query<Row>('SELECT * FROM users WHERE email = $1', [String(body.email)]);
    const user = found.rows[0];
    if (!user || str(user.passcode_hash) !== passcodeHash(String(body.passcode))) {
      throw apiError('invalid_credentials');
    }
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1,$2,now() + interval \'14 days\')', [token, str(user.id)]);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': `sw_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600`,
    });
    res.end(JSON.stringify({ user: userView(user) }));
    return;
  }

  if (pathname === '/api/session' && method === 'DELETE') {
    const user = await requireUser(req);
    const cookies = parseCookies(req.headers.cookie);
    await pool.query('DELETE FROM sessions WHERE token = $1', [cookies.get('sw_session')]);
    res.writeHead(204, {
      'Set-Cookie': 'sw_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
    });
    void user;
    res.end();
    return;
  }

  if (pathname === '/api/me' && method === 'GET') {
    const user = await requireUser(req);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ user }));
    return;
  }

  if (pathname === '/api/board' && method === 'GET') {
    await requireRole(req, ['coordinator']);
    const data = await boardData();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
    return;
  }

  if (pathname === '/api/requests' && method === 'GET') {
    const user = await requireRole(req, ['requester', 'coordinator', 'billing']);
    const status = url.searchParams.get('status');
    let rows: Row[];
    if (user.role === 'requester') {
      rows = (await pool.query<Row>(
        `SELECT id FROM requests WHERE org_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY start_at DESC`,
        [user.org_id, status],
      )).rows;
    } else {
      rows = (await pool.query<Row>(
        `SELECT id FROM requests WHERE ($1::text IS NULL OR status = $1) ORDER BY start_at DESC`,
        [status],
      )).rows;
    }
    const requests: RequestView[] = [];
    for (const row of rows) requests.push(await requestFullView(pool, str(row.id)));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ requests }));
    return;
  }

  if (pathname === '/api/requests' && method === 'POST') {
    const user = await requireRole(req, ['requester', 'coordinator']);
    const body = (await readJson(req)) as RequestInput & { org_id?: string; logged_after?: boolean };
    const request = await createRequest(user, body);
    res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ request }));
    return;
  }

  if (seg[0] === 'requests' && seg.length === 2 && method === 'GET') {
    const user = await requireRole(req, ['requester', 'coordinator', 'billing']);
    const r = await loadRequestRow(pool, seg[1]!);
    if (user.role === 'requester' && r.org_id !== user.org_id) throw apiError('not_found');
    const view = await requestFullView(pool, seg[1]!);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ request: view }));
    return;
  }

  if (seg[0] === 'requests' && seg.length === 2 && method === 'PATCH') {
    const user = await requireRole(req, ['requester']);
    const body = (await readJson(req)) as RequestInput;
    const view = await patchRequest(user, seg[1]!, body);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ request: view }));
    return;
  }

  if (seg[0] === 'requests' && seg.length === 3 && seg[2] === 'submit' && method === 'POST') {
    const user = await requireRole(req, ['requester']);
    await readJson(req);
    const view = await submitRequest(user, seg[1]!);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ request: view }));
    return;
  }

  if (seg[0] === 'requests' && seg.length === 3 && seg[2] === 'prep' && method === 'POST') {
    const user = await requireRole(req, ['requester']);
    const parts = await readMultipart(req);
    const file = parts.get('file');
    if (!file) throw apiError('validation', { fields: { file: 'Choose a file.' } });
    const saved = await attachPrepFile(user, seg[1]!, file.filename ?? 'prep', file.bytes, file.contentType);
    res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ file: saved }));
    return;
  }

  if (seg[0] === 'requests' && seg.length === 3 && seg[2] === 'cancellation-quote' && method === 'GET') {
    const user = await requireRole(req, ['requester', 'coordinator']);
    const r = await loadRequestRow(pool, seg[1]!);
    if (user.role === 'requester' && r.org_id !== user.org_id) throw apiError('not_found');
    if (['completed', 'invoiced'].includes(r.status) || r.status.startsWith('cancelled')) {
      throw apiError('invalid_transition', { from: r.status }, { from: r.status });
    }
    if (r.status !== 'draft' && Date.now() > r.start_ms) throw apiError('already_started');
    const seats = await loadSeatRows(pool, r.id);
    const quote = await loadQuote(pool, r, seats);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ quote }));
    return;
  }

  if (seg[0] === 'requests' && seg.length === 3 && seg[2] === 'cancel' && method === 'POST') {
    const user = await requireRole(req, ['requester', 'coordinator']);
    const key = req.headers['idempotency-key'];
    if (!validIdempotencyKey(typeof key === 'string' ? key : undefined)) throw apiError('idempotency_key_required');
    const body = (await readJson(req)) as { expected_fee?: unknown; reason?: unknown };
    if (typeof body.expected_fee !== 'string' || moneyToCents(body.expected_fee) === null) {
      throw apiError('validation', { fields: { expected_fee: 'The charge is not known. Refresh and try again.' } });
    }
    const r = await loadRequestRow(pool, seg[1]!);
    if (user.role === 'requester' && r.org_id !== user.org_id) throw apiError('not_found');
    const result = await cancelRequest(user, seg[1]!, body.expected_fee, typeof body.reason === 'string' ? body.reason : '', key as string);
    res.writeHead(result.status, {
      'Content-Type': 'application/json; charset=utf-8',
      ...(result.idempotentReplay ? { 'Idempotent-Replayed': 'true' } : {}),
    });
    res.end(result.body);
    return;
  }

  if (seg[0] === 'seats' && seg.length === 3 && seg[2] === 'dry-run' && method === 'POST') {
    await requireRole(req, ['coordinator']);
    const body = (await readJson(req)) as { interpreter_id?: unknown };
    await withTransaction(async (client) => { await expireOverdueOffersForSeat(client, seg[1]!); });
    const seat = await loadSeatById(pool, seg[1]!);
    const r = await loadRequestRow(pool, seat.request_id);
    const interp = await pool.query<Row>('SELECT id FROM interpreters WHERE id = $1', [String(body.interpreter_id ?? '')]);
    if (interp.rows.length === 0) throw apiError('not_found');
    if (seat.status !== 'open') {
      throw apiError('seat_taken', { holder: { id: seat.held_by_id!, name: seat.held_by_name! } });
    }
    if (r.status !== 'submitted' && r.status !== 'partially_staffed') {
      throw apiError('invalid_transition', { from: r.status }, { from: r.status });
    }
    const gates = await evaluateGatesForSeat(pool, seat, str(body.interpreter_id));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      seat_id: seg[1], interpreter_id: str(body.interpreter_id), gates, all_pass: gates.every((g) => g.pass),
    }));
    return;
  }

  if (seg[0] === 'seats' && seg.length === 3 && seg[2] === 'offers' && method === 'POST') {
    const user = await requireRole(req, ['coordinator']);
    const body = (await readJson(req)) as { interpreter_id?: unknown };
    const result = await pinSeat(user, seg[1]!, String(body.interpreter_id ?? ''));
    const seatView = result.request.seats.find((s) => s.id === seg[1])!;
    res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ offer: seatView.offer, seat: seatView, request: result.request }));
    return;
  }

  if (seg[0] === 'seats' && seg.length === 3 && seg[2] === 'timesheet' && method === 'POST') {
    const user = await requireRole(req, ['interpreter']);
    const key = req.headers['idempotency-key'];
    if (!validIdempotencyKey(typeof key === 'string' ? key : undefined)) throw apiError('idempotency_key_required');
    const body = (await readJson(req)) as { actual_start?: unknown; actual_end?: unknown; signature_name?: unknown };
    if (typeof body.actual_start !== 'string' || typeof body.actual_end !== 'string' || typeof body.signature_name !== 'string') {
      throw apiError('validation', { fields: {
        actual_start: 'Enter a valid date and time.', actual_end: 'Enter a valid date and time.', signature_name: 'Enter your signature name.',
      } });
    }
    const result = await submitTimesheet(user, seg[1]!, body.actual_start, body.actual_end, body.signature_name, key as string);
    res.writeHead(result.status, {
      'Content-Type': 'application/json; charset=utf-8',
      ...(result.idempotentReplay ? { 'Idempotent-Replayed': 'true' } : {}),
    });
    res.end(result.body);
    return;
  }

  if (seg[0] === 'offers' && seg.length === 2 && method === 'GET') {
    const offer = await pool.query<Row>(
      `SELECT o.id, o.status, o.expires_at, o.interpreter_id, i.name AS interpreter_name,
              s.position, s.request_id, (SELECT count(*) FROM seats x WHERE x.request_id = s.request_id) AS total
       FROM offers o JOIN seats s ON s.id = o.seat_id JOIN interpreters i ON i.id = o.interpreter_id
       WHERE o.token = $1`,
      [seg[1]],
    );
    const row = offer.rows[0];
    if (!row) throw apiError('not_found');
    const r = await loadRequestRow(pool, str(row.request_id));
    const expiredNow = str(row.status) === 'active' && new Date(row.expires_at as string).getTime() <= Date.now();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      offer: { status: expiredNow ? 'expired' : str(row.status), expires_at: isoWithOffset(new Date(row.expires_at as string)) },
      request: { ref: r.ref, title: r.title, setting: r.setting, location: r.location, start: isoWithOffset(new Date(r.start_ms)), end: isoWithOffset(new Date(r.end_ms)), org_name: r.org_name },
      seat: { position: num(row.position), total: num(row.total) },
      interpreter: { name: str(row.interpreter_name) },
    }));
    return;
  }

  if (seg[0] === 'offers' && seg.length === 3 && (seg[2] === 'accept' || seg[2] === 'decline') && method === 'POST') {
    await readJson(req);
    const result = await answerOffer(seg[1]!, seg[2] === 'accept' ? 'accept' : 'decline');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      offer: { status: result.offerStatus }, request: { ref: result.requestRef, status: result.requestStatus },
    }));
    return;
  }

  if (pathname === '/api/interpreters/me/assignments' && method === 'GET') {
    const user = await requireRole(req, ['interpreter']);
    const interp = await pool.query<Row>('SELECT id FROM interpreters WHERE user_id = $1', [user.id]);
    const data = await myAssignments(str(interp.rows[0]!.id));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
    return;
  }

  if (pathname === '/api/interpreters/me/credentials' && method === 'GET') {
    const user = await requireRole(req, ['interpreter']);
    const creds = await pool.query<Row>(
      `SELECT id, type, number, expires_on FROM credentials WHERE interpreter_id = (SELECT id FROM interpreters WHERE user_id = $1)`,
      [user.id],
    );
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ credentials: creds.rows.map((row) => {
      const expiresMs = new Date(`${str(row.expires_on)}T00:00:00Z`).getTime();
      const today = new Date(`${dateKeyInAgencyTz(new Date())}T00:00:00Z`).getTime();
      const status = expiresMs < today ? 'expired' : expiresMs <= today + 30 * 86_400_000 ? 'expiring' : 'valid';
      return { id: str(row.id), type: str(row.type), number: str(row.number), expires_on: str(row.expires_on), status };
    }) }));
    return;
  }

  if (pathname === '/api/interpreters/me/credentials' && method === 'POST') {
    const user = await requireRole(req, ['interpreter']);
    const parts = await readMultipart(req);
    const type = parts.get('type')?.bytes.toString('utf8') ?? '';
    const number = parts.get('number')?.bytes.toString('utf8') ?? '';
    const expiresOn = parts.get('expires_on')?.bytes.toString('utf8') ?? '';
    const scan = parts.get('scan');
    if (!scan) throw apiError('validation', { fields: { scan: 'Choose a scan.' } });
    const interp = await pool.query<Row>('SELECT id FROM interpreters WHERE user_id = $1', [user.id]);
    const credential = await addCredential(user, str(interp.rows[0]!.id), type, number, expiresOn, scan.filename ?? 'scan.pdf', scan.bytes, scan.contentType);
    // The expiry-warning check runs within a minute of a credential being saved.
    void withTransaction(async (client) => { await sendExpiryWarnings(client); }).catch(() => {});
    res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ credential }));
    return;
  }

  if (pathname === '/api/timesheets' && method === 'GET') {
    await requireRole(req, ['billing']);
    const status = url.searchParams.get('status');
    const rows = (await pool.query<Row>(
      `SELECT t.id, r.ref, t.request_id, r.org_id, t.interpreter_id, i.name AS interpreter_name,
              t.actual_start, t.actual_end, t.billed_hours, t.status
       FROM timesheets t JOIN requests r ON r.id = t.request_id JOIN interpreters i ON i.id = t.interpreter_id
       WHERE ($1::text IS NULL OR t.status = $1) ORDER BY t.created_at`,
      [status],
    )).rows;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ timesheets: rows.map((row) => ({
      id: str(row.id), ref: str(row.ref), request_id: str(row.request_id), org_id: str(row.org_id),
      interpreter: { id: str(row.interpreter_id), name: str(row.interpreter_name) },
      actual_start: isoWithOffset(new Date(row.actual_start as string)),
      actual_end: isoWithOffset(new Date(row.actual_end as string)),
      billed_hours: str(row.billed_hours), status: str(row.status),
    })) }));
    return;
  }

  if (seg[0] === 'timesheets' && seg.length === 3 && seg[2] === 'approve' && method === 'POST') {
    const user = await requireRole(req, ['billing']);
    const key = req.headers['idempotency-key'];
    if (!validIdempotencyKey(typeof key === 'string' ? key : undefined)) throw apiError('idempotency_key_required');
    await readJson(req);
    const result = await approveTimesheet(user, seg[1]!, key as string);
    res.writeHead(result.status, {
      'Content-Type': 'application/json; charset=utf-8',
      ...(result.idempotentReplay ? { 'Idempotent-Replayed': 'true' } : {}),
    });
    res.end(result.body);
    return;
  }

  if (seg[0] === 'timesheets' && seg.length === 3 && seg[2] === 'pdf' && method === 'GET') {
    const user = await requireUser(req);
    const ts = (await pool.query<Row>(
      `SELECT t.pdf_key, r.org_id, t.interpreter_id FROM timesheets t JOIN requests r ON r.id = t.request_id WHERE t.id = $1`,
      [seg[1]],
    )).rows[0];
    if (!ts || !ts.pdf_key) throw apiError('not_found');
    if (user.role === 'requester' && str(ts.org_id) !== user.org_id) throw apiError('not_found');
    if (user.role === 'interpreter') {
      const own = await pool.query<Row>('SELECT id FROM interpreters WHERE id = $1 AND user_id = $2', [str(ts.interpreter_id), user.id]);
      if (own.rows.length === 0) throw apiError('not_found');
    }
    const bytes = await getObject(str(ts.pdf_key));
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="timesheet-${seg[1]}.pdf"` });
    res.end(bytes);
    return;
  }

  if (pathname === '/api/rates' && method === 'GET') {
    await requireRole(req, ['billing', 'coordinator']);
    const rates = await getRates(pool);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ rates: {
      medical: centsToMoney(rates.medical), legal: centsToMoney(rates.legal),
      education: centsToMoney(rates.education), community: centsToMoney(rates.community),
    } }));
    return;
  }

  if (pathname === '/api/rates' && method === 'PUT') {
    const user = await requireRole(req, ['billing']);
    const body = (await readJson(req)) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    const settings = ['medical', 'legal', 'education', 'community'] as const;
    const updates: Record<string, number> = {};
    for (const setting of settings) {
      if (body[setting] !== undefined) {
        const cents = typeof body[setting] === 'string' ? moneyToCents(body[setting]) : null;
        if (cents === null || cents <= 0 || cents > 100_000) {
          fields[setting] = 'Rate must be a dollar amount above 0 and at most 1000.00.';
        } else {
          updates[setting] = cents;
        }
      }
    }
    if (Object.keys(fields).length > 0) throw apiError('validation', { fields });
    await withTransaction(async (client) => {
      for (const [setting, cents] of Object.entries(updates)) {
        await client.query('UPDATE rates SET hourly_rate_cents = $1 WHERE setting = $2', [cents, setting]);
      }
      await writeAudit(client, {
        actorUserId: user.id, action: 'rates.updated', entity: 'rates', entityId: 'rates',
        from: null, to: null, detail: updates,
      });
    });
    const rates = await getRates(pool);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ rates: {
      medical: centsToMoney(rates.medical), legal: centsToMoney(rates.legal),
      education: centsToMoney(rates.education), community: centsToMoney(rates.community),
    } }));
    return;
  }

  if (seg[0] === 'orgs' && seg.length === 3 && seg[2] === 'invoices' && method === 'GET') {
    const user = await requireRole(req, ['requester', 'billing']);
    const org = (await pool.query<Row>('SELECT id, name, killbill_account_id FROM orgs WHERE id = $1', [seg[1]])).rows[0];
    if (!org) throw apiError('not_found');
    if (user.role === 'requester' && str(org.id) !== user.org_id) throw apiError('not_found');
    let invoices;
    let total;
    let killbillAccountId: string;
    try {
      killbillAccountId = await withTransaction((client) => ensureOrgAccount(client, str(org.id)));
      invoices = await kb.listInvoices(killbillAccountId);
      total = kb.sumInvoiceAmounts(invoices);
    } catch (err) {
      if (err instanceof kb.KillBillError && err.kind === 'unavailable') throw apiError('billing_unavailable');
      throw err;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ org_id: str(org.id), killbill_account_id: killbillAccountId, invoices, total }));
    return;
  }

  if (seg[0] === 'consumers' && seg.length === 1 && method === 'GET') {
    await requireRole(req, ['requester', 'coordinator']);
    const rows = (await pool.query<Row>('SELECT id, name FROM consumers ORDER BY name')).rows;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ consumers: rows.map((r) => ({ id: str(r.id), name: str(r.name) })) }));
    return;
  }

  if (pathname === '/api/consumers/me/preferences' && method === 'GET') {
    const user = await requireRole(req, ['consumer']);
    const rows = (await pool.query<Row>(
      `SELECT interpreter_id, kind FROM consumer_preferences WHERE consumer_id = (SELECT id FROM consumers WHERE user_id = $1)`,
      [user.id],
    )).rows;
    const interpreters = (await pool.query<Row>('SELECT id, name FROM interpreters ORDER BY name')).rows;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      preferred: rows.filter((r) => str(r.kind) === 'preferred').map((r) => str(r.interpreter_id)),
      blocked: rows.filter((r) => str(r.kind) === 'blocked').map((r) => str(r.interpreter_id)),
      interpreters: interpreters.map((r) => ({ id: str(r.id), name: str(r.name) })),
    }));
    return;
  }

  if (pathname === '/api/consumers/me/preferences' && method === 'PUT') {
    const user = await requireRole(req, ['consumer']);
    const body = (await readJson(req)) as { preferred?: unknown; blocked?: unknown };
    const preferred = Array.isArray(body.preferred) ? body.preferred.map(String) : [];
    const blocked = Array.isArray(body.blocked) ? body.blocked.map(String) : [];
    const consumerId = (await pool.query<Row>('SELECT id FROM consumers WHERE user_id = $1', [user.id])).rows[0];
    if (!consumerId) throw apiError('not_found');
    await withTransaction(async (client) => {
      await savePreferences(client, str(consumerId.id), preferred, blocked);
      await writeAudit(client, {
        actorUserId: user.id, action: 'preferences.updated', entity: 'preferences', entityId: str(consumerId.id),
        from: null, to: null,
      });
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ preferred, blocked }));
    return;
  }

  if (pathname === '/api/consumers/me/preferences' && method === 'GET') {
    const user = await requireRole(req, ['consumer']);
    const rows = (await pool.query<Row>(
      `SELECT interpreter_id, kind FROM consumer_preferences WHERE consumer_id = (SELECT id FROM consumers WHERE user_id = $1)`,
      [user.id],
    )).rows;
    const interpreters = (await pool.query<Row>('SELECT id, name FROM interpreters ORDER BY name')).rows;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      preferred: rows.filter((r) => str(r.kind) === 'preferred').map((r) => str(r.interpreter_id)),
      blocked: rows.filter((r) => str(r.kind) === 'blocked').map((r) => str(r.interpreter_id)),
      interpreters: interpreters.map((r) => ({ id: str(r.id), name: str(r.name) })),
    }));
    return;
  }

  if (seg[0] === 'consumers' && seg.length === 3 && seg[2] === 'preferences' && method === 'GET') {
    await requireRole(req, ['coordinator']);
    const consumer = (await pool.query<Row>('SELECT id, name FROM consumers WHERE id = $1', [seg[1]])).rows[0];
    if (!consumer) throw apiError('not_found');
    const rows = (await pool.query<Row>(
      'SELECT interpreter_id, kind FROM consumer_preferences WHERE consumer_id = $1', [seg[1]],
    )).rows;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      consumer: { id: str(consumer.id), name: str(consumer.name) },
      preferred: rows.filter((r) => str(r.kind) === 'preferred').map((r) => str(r.interpreter_id)),
      blocked: rows.filter((r) => str(r.kind) === 'blocked').map((r) => str(r.interpreter_id)),
    }));
    return;
  }

  if (seg[0] === 'prep' && seg.length === 2 && method === 'GET') {
    const user = await requireUser(req);
    const file = (await pool.query<Row>(
      `SELECT p.id, p.storage_key, p.content_type, p.filename, r.org_id, r.id AS request_id, r.status
       FROM prep_files p JOIN requests r ON r.id = p.request_id WHERE p.id = $1`,
      [seg[1]],
    )).rows[0];
    if (!file) throw apiError('not_found');
    const allowed = await prepAllowed(user, file);
    if (!allowed) throw apiError('not_found');
    const bytes = await getObject(str(file.storage_key));
    res.writeHead(200, {
      'Content-Type': str(file.content_type),
      'Content-Disposition': `attachment; filename="${str(file.filename)}"`,
    });
    res.end(bytes);
    return;
  }

  if (seg[0] === 'credentials' && seg.length === 3 && seg[2] === 'scan' && method === 'GET') {
    const user = await requireUser(req);
    const cred = (await pool.query<Row>(
      `SELECT c.scan_key, c.interpreter_id FROM credentials c WHERE c.id = $1`, [seg[1]],
    )).rows[0];
    if (!cred) throw apiError('not_found');
    if (user.role === 'interpreter') {
      const own = await pool.query<Row>('SELECT id FROM interpreters WHERE id = $1 AND user_id = $2', [str(cred.interpreter_id), user.id]);
      if (own.rows.length === 0) throw apiError('not_found');
    } else if (user.role !== 'coordinator') {
      throw apiError('forbidden');
    }
    const bytes = await getObject(str(cred.scan_key));
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="scan.pdf"' });
    res.end(bytes);
    return;
  }

  if (pathname === '/api/audit' && method === 'GET') {
    await requireRole(req, ['coordinator', 'billing']);
    const requestId = url.searchParams.get('request_id') ?? '';
    const entries = await readAudit(pool, requestId);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ entries }));
    return;
  }

  throw apiError('not_found');
}

async function prepAllowed(user: SessionUser, file: Row): Promise<boolean> {
  if (user.role === 'coordinator' || user.role === 'billing') return true;
  if (user.role === 'requester') return str(file.org_id) === user.org_id;
  if (user.role === 'interpreter') {
    const status = str(file.status);
    if (status.startsWith('cancelled')) return false;
    const seat = await pool.query<Row>(
      `SELECT 1 FROM seats s JOIN interpreters i ON i.id = s.interpreter_id
       WHERE s.request_id = $1 AND s.status = 'accepted' AND i.user_id = $2`,
      [str(file.request_id), user.id],
    );
    return seat.rows.length > 0;
  }
  return false;
}

function userView(row: Row): SessionUser {
  return {
    id: str(row.id), name: str(row.name), email: str(row.email),
    role: str(row.role) as SessionUser['role'],
    org_id: row.org_id === null ? null : str(row.org_id),
  };
}

// ---------- boot ----------

const OWNER = `srv-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

async function sweepStatuses(): Promise<void> {
  await withTransaction(async (client) => {
    // Expire offers whose time has passed, with their audit entries.
    const expired = await client.query<Row>(
      `UPDATE offers SET status = 'expired' WHERE status = 'active' AND expires_at <= now() RETURNING id`,
    );
    for (const row of expired.rows) {
      await writeAudit(client, {
        actorUserId: null, action: 'offer.expired', entity: 'offer', entityId: str(row.id),
        from: 'active', to: 'expired',
      });
    }
    // Reopen seats with no live offer.
    await client.query(
      `UPDATE seats s SET status = 'open', interpreter_id = NULL, held_by_user_id = NULL
       WHERE s.status = 'offered' AND NOT EXISTS (
         SELECT 1 FROM offers o WHERE o.seat_id = s.id AND o.status = 'active'
       )`,
    );
    // Complete staffed requests whose end has passed, exactly once.
    const completed = await client.query<Row>(
      `UPDATE requests SET status = 'completed' WHERE status = 'staffed' AND end_at < now() RETURNING id`,
    );
    for (const row of completed.rows) {
      await writeAudit(client, {
        actorUserId: null, action: 'request.status_changed', entity: 'request', entityId: str(row.id),
        from: 'staffed', to: 'completed',
      });
    }
  });
}

async function main(): Promise<void> {
  publicUrl = config.publicUrl;

  // Serve immediately; health reports "starting" until Postgres and the schema are up.
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Seatweaver serving on ${config.port}`);
  });

  for (;;) {
    try {
      await migrateAndSeed();
      dbReady = true;
      break;
    } catch (err) {
      console.error('Database not ready, retrying', err instanceof Error ? err.message : err);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Kill Bill accounts at start, best effort; they are also created on first need.
  void withTransaction(async (client) => {
    const orgs = await client.query<Row>('SELECT id, name FROM orgs');
    for (const org of orgs.rows) {
      await ensureOrgAccount(client, str(org.id));
    }
  }).catch((err) => {
    console.error('Kill Bill accounts deferred', err instanceof Error ? err.message : err);
  });

  // Background sweeps: statuses + outbox every 15s, warnings hourly, sweep lock-safe across instances.
  setInterval(() => { void sweepStatuses().catch(() => {}); }, 15_000);
  setInterval(() => { void runOutboxTick(OWNER).catch(() => {}); }, 15_000);
  setInterval(() => { void withTransaction(async (client) => {
    await sendExpiryWarnings(client);
  }).catch(() => {}); }, 60 * 60 * 1000).unref();
  void withTransaction(async (client) => { await sendExpiryWarnings(client); }).catch(() => {});
  void runOutboxTick(OWNER).catch(() => {});
}

void main();
