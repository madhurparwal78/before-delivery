import { IncomingMessage, ServerResponse } from 'node:http';
import { Deps, inReadTx, inWriteTx, getStations, getCurrentDocuments } from '../store.js';
import { ApiError, messages, errUnauthenticated, errForbidden, errNotFound, errValidation, errConflict, errInternal } from './errors.js';
import { fieldCopy } from './copy.js';
import { checkOrigin, cookieToken, readBody, idempotencyKey, setSecurityHeaders, noStore, Session, loadSession } from './pipeline.js';
import { KitchenClock } from '../domain/kitchen.js';
import {
  CLEANUP_MINUTES, MIN_BOOKING_MINUTES, OPENS_MIN, CLOSSES_MIN, spanStatus,
} from '../domain/rules.js';
import { ObjectStore } from '../storage/s3.js';
import { KillBill } from '../billing/killbill.js';
import { Mailer } from '../mail/queue.js';
import { hashPassword, verifyPassword, newId, randomToken } from '../domain/crypto.js';
import { readOccupancy, stationSpanMetrics, shelfFreeInHalfHour, clearanceFor } from '../booking/occupancy.js';
import { renderBooking, renderPack, renderDocument } from '../booking/render.js';

export interface Router {
  deps: Deps;
  kb: KillBill;
  store: ObjectStore;
  mailer: Mailer;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  body: Record<string, unknown>;
  rawBody: Uint8Array | undefined;
  session: Session | null;
  params: Record<string, string>;
  idemKey: string | null;
  deps: Deps;
  kb: KillBill;
  objStore: ObjectStore;
  mailer: Mailer;
}

export function json(res: ServerResponse, status: number, data: unknown, headers?: Record<string, string>): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

export function noBody(res: ServerResponse, status: number, headers?: Record<string, string>): void {
  res.writeHead(status, headers);
  res.end();
}

export function apiError(res: ServerResponse, e: ApiError): void {
  const headers: Record<string, string> = {};
  if (e.retryAfter !== undefined) headers['Retry-After'] = String(e.retryAfter);
  const body: Record<string, unknown> = { error: e.code, message: e.message };
  if (e.fields) body.fields = e.fields;
  json(res, e.status, body, headers);
}

// ---------- helpers ----------

async function requireSession(ctx: Ctx): Promise<Session> {
  if (ctx.session === null) throw errUnauthenticated();
  return ctx.session;
}

async function requireStaff(ctx: Ctx): Promise<Session> {
  const session = await requireSession(ctx);
  if (session.role !== 'owner' && session.role !== 'shift_lead') throw errForbidden();
  return session;
}

function parseDateKey(clock: KitchenClock, raw: string | null): string | null {
  if (raw === null) return null;
  return clock.parseDate(raw) === null ? null : raw;
}

// ---------- routes ----------

export async function handleApi(router: Router, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/api/')) return false;
  setSecurityHeaders(res);
  noStore(res);

  const ctx: Ctx = {
    req, res, url,
    method: req.method ?? 'GET',
    body: {},
    rawBody: undefined,
    session: null,
    params: {},
    idemKey: null,
    deps: router.deps,
    kb: router.kb,
    objStore: router.store,
    mailer: router.mailer,
  };

  try {
    checkOrigin(req, url);
    // Precedence: size and body-type checks run before authentication, so the
    // body is read once here and parsed by each route.
    if (ctx.method === 'POST' || ctx.method === 'PUT' || ctx.method === 'PATCH' || ctx.method === 'DELETE') {
      const upload = url.pathname === '/api/documents';
      const { raw } = await readBody(req, upload);
      ctx.rawBody = raw;
    }
    ctx.session = await loadSession(router.deps, cookieToken(req));
    ctx.idemKey = idempotencyKey(req);
    await route(ctx);
    return true;
  } catch (e) {
    if (e instanceof ApiError) {
      apiError(res, e);
      return true;
    }
    process.stderr.write(`api error: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    apiError(res, errInternal());
    return true;
  }
}

async function route(ctx: Ctx): Promise<void> {
  const { method, url } = ctx;
  const path = url.pathname;

  if (path === '/api/health' && method === 'GET') {
    json(ctx.res, 200, { status: 'ok' });
    return;
  }

  if (path === '/api/session' && method === 'POST') {
    await signIn(ctx);
    return;
  }
  if (path === '/api/session' && method === 'DELETE') {
    await signOut(ctx);
    return;
  }
  if (path === '/api/session/confirm' && method === 'POST') {
    await confirmPassword(ctx);
    return;
  }
  if (path === '/api/me' && method === 'GET') {
    await me(ctx);
    return;
  }
  if (path === '/api/tenants/apply' && method === 'POST') {
    await apply(ctx);
    return;
  }
  if (path === '/api/kitchen' && method === 'GET') {
    await kitchen(ctx);
    return;
  }
  if (path === '/api/floor' && method === 'GET') {
    await floor(ctx);
    return;
  }
  if (path === '/api/bookings' && method === 'POST') {
    await postBooking(ctx);
    return;
  }
  if (path === '/api/bookings' && method === 'GET') {
    await listBookings(ctx);
    return;
  }
  const bookingAction = /^\/api\/bookings\/([^/]+)\/(confirm|move|cancel|check-in|check-out|no-show)$/.exec(path);
  if (bookingAction) {
    ctx.params.id = bookingAction[1];
    const action = bookingAction[2];
    if (action === 'confirm' && method === 'POST') return await postConfirm(ctx);
    if (action === 'move' && method === 'POST') return await postMove(ctx);
    if (action === 'cancel' && method === 'POST') return await postCancel(ctx);
    if (action === 'check-in' && method === 'POST') return await postCheckIn(ctx);
    if (action === 'check-out' && method === 'POST') return await postCheckOut(ctx);
    if (action === 'no-show' && method === 'POST') return await postNoShow(ctx);
    throw errNotFound();
  }
  const bookingId = /^\/api\/bookings\/([^/]+)$/.exec(path);
  if (bookingId && method === 'GET') {
    ctx.params.id = bookingId[1];
    return await getBooking(ctx);
  }
  if (path === '/api/door' && method === 'GET') {
    return await doorList(ctx);
  }
  if (path === '/api/packs' && method === 'POST') {
    return await postPack(ctx);
  }
  if (path === '/api/packs' && method === 'GET') {
    return await listPacks(ctx);
  }
  const packId = /^\/api\/packs\/([^/]+)$/.exec(path);
  if (packId && method === 'GET') {
    ctx.params.id = packId[1];
    return await getPack(ctx);
  }
  const packRefund = /^\/api\/packs\/([^/]+)\/refund$/.exec(path);
  if (packRefund && method === 'POST') {
    ctx.params.id = packRefund[1];
    return await postRefund(ctx);
  }
  if (path === '/api/documents' && method === 'POST') {
    return await postDocument(ctx);
  }
  if (path === '/api/documents' && method === 'GET') {
    return await listDocuments(ctx);
  }
  const docPath = /^\/api\/documents\/([^/]+)(\/file)?$/.exec(path);
  if (docPath && method === 'GET') {
    ctx.params.id = docPath[1];
    if (docPath[2]) return await getDocumentFile(ctx);
    return await getDocument(ctx);
  }
  if (path === '/api/tenants' && method === 'GET') {
    return await listTenants(ctx);
  }
  const tenantPath = /^\/api\/tenants\/([^/]+)$/.exec(path);
  if (tenantPath && method === 'GET') {
    ctx.params.id = tenantPath[1];
    return await getTenantDetail(ctx);
  }
  const approvePath = /^\/api\/tenants\/([^/]+)\/approve$/.exec(path);
  if (approvePath && method === 'POST') {
    ctx.params.id = approvePath[1];
    return await approveTenant(ctx);
  }
  if (path === '/api/reports/daily' && method === 'GET') {
    return await dailyReport(ctx);
  }
  throw errNotFound();
}

// ---------- body reading ----------

async function readMultipart(ctx: Ctx): Promise<{ fields: Map<string, string>; file: Uint8Array | null }> {
  const raw = ctx.rawBody ?? new Uint8Array(0);
  const contentType = ctx.req.headers['content-type'] ?? '';
  const m = /boundary="?([^";]+)"?/i.exec(contentType);
  if (!m) throw new ApiError(400, 'malformed_body', messages.malformedBody);
  const boundary = Buffer.from(`--${m[1]}`);
  const buf = Buffer.from(raw);
  const parts: Array<{ headers: Record<string, string>; data: Buffer }> = [];
  let idx = buf.indexOf(boundary);
  while (idx !== -1) {
    const next = buf.indexOf(boundary, idx + boundary.length);
    if (next === -1) break;
    let segment = buf.subarray(idx + boundary.length, next);
    if (segment[0] === 13 && segment[1] === 10) segment = segment.subarray(2);
    const headerEnd = segment.indexOf('\r\n\r\n');
    if (headerEnd === -1) { idx = next; continue; }
    const headerText = segment.subarray(0, headerEnd).toString('utf8');
    const data = segment.subarray(headerEnd + 4);
    const trimmed = data.subarray(0, data.length - 2);
    const headers: Record<string, string> = {};
    for (const line of headerText.split('\r\n')) {
      const [k, ...rest] = line.split(':');
      headers[k.trim().toLowerCase()] = rest.join(':').trim();
    }
    parts.push({ headers, data: trimmed });
    idx = next;
  }
  if (parts.length === 0) throw new ApiError(400, 'malformed_body', messages.malformedBody);
  const fields = new Map<string, string>();
  let file: Uint8Array | null = null;
  for (const part of parts) {
    const name = /name="([^"]*)"/.exec(part.headers['content-disposition'] ?? '')?.[1];
    if (name === undefined) continue;
    if (name === 'file') {
      file = new Uint8Array(part.data);
    } else {
      fields.set(name, part.data.toString('utf8'));
    }
  }
  return { fields, file };
}

// ---------- session routes ----------

async function signIn(ctx: Ctx): Promise<void> {
  const body = await readBodyJsonForSession(ctx);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const fields: Record<string, string> = {};
  if (email === '') fields.email = fieldCopy.emailEmpty;
  if (password === '') fields.password = fieldCopy.passwordEmpty;
  if (Object.keys(fields).length > 0) throw errValidation(fields);

  const deps = ctx.deps;
  // A failed sign-in must stay counted, so attempt records commit even when
  // the request answers 401 or 429. One transaction, explicit commit before
  // the refusal is thrown.
  const client = await deps.db.connect();
  let result: { token: string; user: unknown } | null = null;
  let refusal: ApiError | null = null;
  try {
    await client.query('BEGIN');
    const nowRow = await client.query<{ now: string }>('SELECT now()::text AS now');
    const now = new Date(nowRow.rows[0].now + 'Z').getTime();
    const recent = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM sign_in_attempts WHERE email=$1 AND success=false AND at > $2`,
      [email, now - deps.config.signinWindowSeconds * 1000],
    );
    if (recent.rows[0].n >= 5) {
      const oldest = await client.query<{ at: number }>(
        `SELECT at FROM sign_in_attempts WHERE email=$1 AND success=false AND at > $2 ORDER BY at LIMIT 1`,
        [email, now - deps.config.signinWindowSeconds * 1000],
      );
      const wait = Math.max(1, Math.ceil((oldest.rows[0].at + deps.config.signinWindowSeconds * 1000 - now) / 1000));
      await client.query(`INSERT INTO sign_in_attempts (email, at, success) VALUES ($1,$2,false)`, [email, now]);
      await client.query('COMMIT');
      refusal = new ApiError(429, 'too_many_attempts', messages.tooManyAttempts, undefined, Math.min(deps.config.signinWindowSeconds, wait));
    } else {
      const userR = await client.query<{ id: string; email: string; role: string; display_name: string; password_hash: string; password_salt: string }>(
        `SELECT * FROM users WHERE email=$1`, [email],
      );
      const user = userR.rows[0];
      if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
        await client.query(`INSERT INTO sign_in_attempts (email, at, success) VALUES ($1,$2,false)`, [email, now]);
        await client.query('COMMIT');
        refusal = new ApiError(401, 'invalid_credentials', "That email and password don't match an account.");
      } else {
        await client.query(`INSERT INTO sign_in_attempts (email, at, success) VALUES ($1,$2,true)`, [email, now]);
        const token = randomToken();
        await client.query(`INSERT INTO sessions (token, user_id, created_at) VALUES ($1,$2,$3)`, [token, user.id, now]);
        let tenant: { id: string; businessName: string; status: string; suspendedReason: string | null } | null = null;
        if (user.role === 'tenant') {
          const t = await client.query<{ id: string; business_name: string; status: string; suspended_reason: string | null }>(
            `SELECT id, business_name, status, suspended_reason FROM tenants WHERE user_id=$1`, [user.id],
          );
          const row = t.rows[0];
          tenant = { id: row.id, businessName: row.business_name, status: row.status, suspendedReason: row.suspended_reason };
        }
        await client.query('COMMIT');
        result = {
          token,
          user: { id: user.id, role: user.role, email: user.email, displayName: user.display_name, tenant },
        };
      }
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    throw e;
  }
  client.release();
  if (refusal !== null) throw refusal;
  json(ctx.res, 200, { user: (result as { user: unknown }).user }, {
    'Set-Cookie': `sh_session=${(result as { token: string }).token}; HttpOnly; SameSite=Lax; Path=/`,
  });
}

async function readBodyJsonForSession(ctx: Ctx): Promise<Record<string, unknown>> {
  return parseJsonBodyOrEmpty(ctx.rawBody, ctx.req.headers['content-type']);
}

function parseJsonBodyOrEmpty(raw: Uint8Array | undefined, contentType: string | undefined): Record<string, unknown> {
  if (raw === undefined || raw.length === 0) return {};
  const type = (contentType ?? '').split(';')[0].trim();
  if (type !== '' && type !== 'application/json') throw new ApiError(415, 'unsupported_media_type', messages.unsupportedMedia);
  try {
    const parsed = JSON.parse(Buffer.from(raw).toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ApiError(400, 'malformed_body', messages.malformedBody);
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, 'malformed_body', messages.malformedBody);
  }
}

async function signOut(ctx: Ctx): Promise<void> {
  const token = cookieToken(ctx.req);
  if (token !== null) {
    await inWriteTx(ctx.deps, async (tx) => {
      await tx.query(`DELETE FROM sessions WHERE token=$1`, [token]);
    });
  }
  noBody(ctx.res, 204, { 'Set-Cookie': 'sh_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
}

async function confirmPassword(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const body = await readBodyJsonForSession(ctx);
  const password = typeof body.password === 'string' ? body.password : '';
  const fields: Record<string, string> = {};
  if (password === '') fields.password = fieldCopy.passwordEmpty;
  const allowed = ['password'];
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) fields[key] = fieldCopy.notAccepted;
  }
  if (Object.keys(fields).length > 0) throw errValidation(fields);

  const deps = ctx.deps;
  // A wrong password on confirmation counts as a failed sign-in and stays
  // counted, so attempt records commit even when the request answers 401/429.
  const client = await deps.db.connect();
  let refusal: ApiError | null = null;
  try {
    await client.query('BEGIN');
    const nowRow = await client.query<{ now: string }>('SELECT now()::text AS now');
    const now = new Date(nowRow.rows[0].now + 'Z').getTime();
    const emailR = await client.query<{ email: string }>(`SELECT email FROM users WHERE id=$1`, [session.userId]);
    const email = emailR.rows[0].email;
    const recent = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM sign_in_attempts WHERE email=$1 AND success=false AND at > $2`,
      [email, now - deps.config.signinWindowSeconds * 1000],
    );
    if (recent.rows[0].n >= 5) {
      const oldest = await client.query<{ at: number }>(
        `SELECT at FROM sign_in_attempts WHERE email=$1 AND success=false AND at > $2 ORDER BY at LIMIT 1`,
        [email, now - deps.config.signinWindowSeconds * 1000],
      );
      const wait = Math.max(1, Math.ceil((oldest.rows[0].at + deps.config.signinWindowSeconds * 1000 - now) / 1000));
      await client.query(`INSERT INTO sign_in_attempts (email, at, success) VALUES ($1,$2,false)`, [email, now]);
      await client.query('COMMIT');
      refusal = new ApiError(429, 'too_many_attempts', messages.tooManyAttempts, undefined, Math.min(deps.config.signinWindowSeconds, wait));
    } else {
      const userR = await client.query<{ password_hash: string; password_salt: string }>(`SELECT password_hash, password_salt FROM users WHERE id=$1`, [session.userId]);
      const user = userR.rows[0];
      if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
        await client.query(`INSERT INTO sign_in_attempts (email, at, success) VALUES ($1,$2,false)`, [email, now]);
        await client.query('COMMIT');
        refusal = new ApiError(401, 'invalid_credentials', "That password doesn't match your account.");
      } else {
        await client.query(`INSERT INTO sign_in_attempts (email, at, success) VALUES ($1,$2,true)`, [email, now]);
        await client.query(`UPDATE sessions SET confirmed_at=$1 WHERE token=$2`, [now, cookieToken(ctx.req)!]);
        await client.query('COMMIT');
      }
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    throw e;
  }
  client.release();
  if (refusal !== null) throw refusal;
  noBody(ctx.res, 204);
}

export interface SessionView {
  role: 'owner' | 'shift_lead' | 'tenant' | null;
  userId: string;
  tenantId: string | null;
  confirmedAt: number | null;
  displayName: string;
  email: string;
}

async function me(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const emailR = await inReadTx(ctx.deps, async (tx) => {
    const r = await tx.query<{ email: string }>(`SELECT email FROM users WHERE id=$1`, [session.userId]);
    return r.rows[0].email;
  });
  json(ctx.res, 200, await renderMe(ctx.deps, session, emailR));
}

async function renderMe(deps: Deps, session: Session, email: string): Promise<unknown> {
  return inReadTx(deps, async (tx) => {
    let tenant = null;
    if (session.tenantId !== null) {
      const r = await tx.query(`SELECT id, business_name, status, suspended_reason FROM tenants WHERE id=$1`, [session.tenantId]);
      const row = r.rows[0];
      tenant = { id: row.id, businessName: row.business_name, status: row.status, suspendedReason: row.suspended_reason };
    }
    return {
      id: session.userId,
      role: session.role,
      email,
      displayName: session.displayName,
      tenant,
    };
  });
}

async function apply(ctx: Ctx): Promise<void> {
  const body = await readBodyJsonForSession(ctx);
  const allowed = ['businessName', 'contactName', 'email', 'password'];
  const fields: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) fields[key] = fieldCopy.notAccepted;
  }
  const businessName = typeof body.businessName === 'string' ? body.businessName : '';
  const contactName = typeof body.contactName === 'string' ? body.contactName : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (businessName === '') fields.businessName = fieldCopy.nameEmpty;
  else if (businessName.length > 80) fields.businessName = fieldCopy.nameLong;
  else if (/[\x00-\x1F\x7F-\x9F]/.test(businessName)) fields.businessName = fieldCopy.nameControl;
  if (contactName === '') fields.contactName = fieldCopy.nameEmpty;
  else if (contactName.length > 80) fields.contactName = fieldCopy.nameLong;
  else if (/[\x00-\x1F\x7F-\x9F]/.test(contactName)) fields.contactName = fieldCopy.nameControl;
  if (email === '') fields.email = fieldCopy.emailEmpty;
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = fieldCopy.emailInvalid;
  if (password === '') fields.password = fieldCopy.passwordEmpty;
  else if (password.length < 10) fields.password = fieldCopy.passwordShort;
  else if (password.length > 200) fields.password = fieldCopy.passwordLong;
  if (Object.keys(fields).length > 0) throw errValidation(fields);

  const deps = ctx.deps;
  const result = await inWriteTx(deps, async (tx, now) => {
    const existing = await tx.query(`SELECT id FROM users WHERE email=$1`, [email]);
    if (existing.rows.length > 0) {
      const f: Record<string, string> = { email: fieldCopy.emailTaken };
      throw errConflict('email_taken', f.email);
    }
    const userId = newId();
    const tenantId = newId();
    const { hash, salt } = hashPassword(password);
    await tx.query(
      `INSERT INTO users (id, email, password_hash, password_salt, role, display_name, created_at)
       VALUES ($1,$2,$3,$4,'tenant',$5,$6)`,
      [userId, email, hash, salt, contactName, now],
    );
    await tx.query(
      `INSERT INTO tenants (id, user_id, business_name, contact_name, status, created_at)
       VALUES ($1,$2,$3,$4,'applied',$5)`,
      [tenantId, userId, businessName, contactName, now],
    );
    const token = randomToken();
    await tx.query(`INSERT INTO sessions (token, user_id, created_at) VALUES ($1,$2,$3)`, [token, userId, now]);
    return {
      token,
      user: {
        id: userId, role: 'tenant', email, displayName: contactName,
        tenant: { id: tenantId, businessName: businessName, status: 'applied', suspendedReason: null },
      },
    };
  });
  json(ctx.res, 201, { user: result.user }, {
    'Set-Cookie': `sh_session=${result.token}; HttpOnly; SameSite=Lax; Path=/`,
  });
}

async function kitchen(ctx: Ctx): Promise<void> {
  const deps = ctx.deps;
  const data = await inReadTx(deps, async (_tx, now) => {
    return {
      name: 'Halfsheet Commissary',
      timeZone: deps.clock.zone,
      opensAt: '05:00',
      closesAt: '23:00',
      cleanupMinutes: CLEANUP_MINUTES,
      minimumBookingMinutes: MIN_BOOKING_MINUTES,
      holdSeconds: deps.config.holdSeconds,
      today: deps.clock.dateKey(now),
      now: deps.clock.iso(now),
    };
  });
  json(ctx.res, 200, data);
}

async function floor(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const deps = ctx.deps;
  const dateRaw = ctx.url.searchParams.get('date');
  const from = ctx.url.searchParams.get('from');
  const to = ctx.url.searchParams.get('to');
  const fields: Record<string, string> = {};
  const dateKey = parseDateKey(deps.clock, dateRaw);
  if (dateKey === null) fields.date = fieldCopy.badDate;
  if ((from === null) !== (to === null)) fields.from = fieldCopy.spanHalf;
  let fromMin = -1; let toMin = -1;
  if (from !== null && to !== null) {
    const parseHm = (s: string): number | null => {
      const m = /^(\d{2}):(\d{2})$/.exec(s);
      if (!m) return null;
      const h = Number(m[1]); const mm = Number(m[2]);
      if (mm % 30 !== 0) return null;
      return h * 60 + mm;
    };
    fromMin = parseHm(from) ?? -1;
    toMin = parseHm(to) ?? -1;
    if (fromMin === -1 || toMin === -1) { fields.from = fieldCopy.spanHalfHour; }
    else if (fromMin < OPENS_MIN || toMin > CLOSSES_MIN || fromMin >= toMin) { fields.from = fieldCopy.spanInvalid; }
  }
  if (Object.keys(fields).length > 0) throw errValidation(fields);

  if (dateKey === null) throw errValidation(fields);

  const data = await inReadTx(deps, async (tx, now) => {
    const stations = await getStations(tx);
    const occupancy = await readOccupancy(tx, dateKey, deps.clock);
    const [y, m, d] = dateKey.split('-').map(Number);
    const dayStart = deps.clock.fromWall(y, m, d, 0, 0, 0);
    const tenantNames = new Map<string, string>(
      (await tx.query(`SELECT id, business_name FROM tenants`)).rows.map((r: { id: string; business_name: string }) => [r.id, r.business_name]),
    );
    const isTenant = session.role === 'tenant';
    const callerTenantId = session.tenantId;

    let spanStart = 0; let spanEnd = 0; let spanStatusValue: string | null = null;
    if (fromMin >= 0 && toMin > fromMin) {
      spanStart = dayStart + fromMin * 60_000;
      spanEnd = dayStart + toMin * 60_000;
      spanStatusValue = spanStatus(deps.clock, now, spanStart);
    }

    const coolerFree: Array<{ time: string; freeShelves: number }> = [];
    for (let i = 0; i < 36; i++) {
      const halfStart = dayStart + (OPENS_MIN + i * 30) * 60_000;
      const halfEnd = halfStart + 30 * 60_000;
      let free = 0;
      for (const shelf of stations.filter((s) => s.kind === 'cooler_shelf')) {
        if (shelfFreeInHalfHour(halfStart, halfEnd, occupancy, shelf.id)) free++;
      }
      coolerFree.push({ time: deps.clock.hhmm(halfStart), freeShelves: free });
    }

    const stationsJson = stations.map((station) => {
      const intervals = occupancy
        .filter((b) => b.station_id === station.id || b.shelf_id === station.id)
        .map((b) => {
          if (isTenant) {
            return {
              start: deps.clock.iso(b.start),
              end: deps.clock.iso(b.end),
              bufferEnd: deps.clock.iso(b.buffer_end),
              mine: b.tenant_id === callerTenantId,
            };
          }
          return {
            start: deps.clock.iso(b.start),
            end: deps.clock.iso(b.end),
            bufferEnd: deps.clock.iso(b.buffer_end),
            bookingId: b.id,
            status: b.status,
            tenantId: b.tenant_id,
            tenantName: tenantNames.get(b.tenant_id) ?? '',
          };
        });
      const base: Record<string, unknown> = {
        id: station.id,
        name: station.name,
        kind: station.kind,
        cleanupMinutes: station.cleanup_minutes,
        col: station.col,
        row: station.row,
        intervals,
      };
      if (fromMin >= 0 && toMin > fromMin) {
        const metrics = stationSpanMetrics(spanStart, spanEnd, occupancy, station.id);
        base.occupiedMinutes = metrics.occupiedMinutes;
        base.bufferMinutes = metrics.bufferMinutes;
        base.freeMinutes = metrics.freeMinutes;
      }
      return base;
    });

    return {
      date: dateKey,
      from: from,
      to: to,
      now: deps.clock.iso(now),
      spanStatus: spanStatusValue,
      coolerFree,
      stations: stationsJson,
    };
  });
  json(ctx.res, 200, data);
}

// The step-up password check shared by purchases of larger packs and refunds.
function requireFreshConfirmation(ctx: Ctx): void {
  const session = ctx.session!;
  if (session.confirmedAt === null || Date.now() >= session.confirmedAt + ctx.deps.config.reauthSeconds * 1000) {
    throw new ApiError(403, 'reauth_required', 'Confirm your password to continue.');
  }
}

// ---------- bookings ----------

function idemKeyOr400(ctx: Ctx): string {
  if (ctx.idemKey === null || ctx.idemKey.length === 0) {
    throw new ApiError(400, 'idempotency_key_required', 'An Idempotency-Key header is required.');
  }
  return ctx.idemKey;
}

interface StoredIdem {
  status: string;
  response_status: number | null;
  response_body: unknown;
}

// Step 5: the lookup answers a replay, conflict or in-progress without writing.
async function lookupIdempotency(ctx: Ctx, endpoint: string, requestHash: string): Promise<{ replay: boolean; stored?: StoredIdem }> {
  const session = ctx.session!;
  return inReadTx(ctx.deps, async () => {
    const existing = await ctx.deps.db.query(
      `SELECT status, request_hash, response_status, response_body FROM idempotency_keys WHERE user_id=$1 AND endpoint=$2 AND key=$3`,
      [session.userId, endpoint, ctx.idemKey],
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.status === 'running') {
        throw new ApiError(409, 'idempotency_in_progress', messages.idempotencyInProgress);
      }
      if (row.request_hash !== requestHash) {
        throw new ApiError(409, 'idempotency_conflict', messages.idempotencyConflict);
      }
      return { replay: true, stored: row };
    }
    return { replay: false };
  });
}

// The claim marks the key running before the action executes.
async function claimIdempotency(ctx: Ctx, endpoint: string, requestHash: string): Promise<void> {
  const session = ctx.session!;
  await inWriteTx(ctx.deps, async (tx, now) => {
    await tx.query(
      `INSERT INTO idempotency_keys (user_id, endpoint, key, request_hash, status, created_at)
       VALUES ($1,$2,$3,$4,'running',$5)
       ON CONFLICT (user_id, endpoint, key) DO NOTHING`,
      [session.userId, endpoint, ctx.idemKey, requestHash, now],
    );
  });
}

async function hashBody(body: unknown): Promise<string> {
  const crypto = await import('node:crypto');
  const stable = JSON.stringify(body, (_k, v) => v);
  return crypto.createHash('sha256').update(stable).digest('hex');
}

async function storeIdemResponse(ctx: Ctx, endpoint: string, status: number, body: unknown): Promise<void> {
  const session = ctx.session!;
  await inWriteTx(ctx.deps, async (tx) => {
    await tx.query(
      `UPDATE idempotency_keys SET status='done', response_status=$4, response_body=$5
       WHERE user_id=$1 AND endpoint=$2 AND key=$3`,
      [session.userId, endpoint, ctx.idemKey, status, JSON.stringify(body)],
    );
  });
}

async function clearIdemKey(ctx: Ctx, endpoint: string): Promise<void> {
  const session = ctx.session!;
  await inWriteTx(ctx.deps, async (tx) => {
    await tx.query(`DELETE FROM idempotency_keys WHERE user_id=$1 AND endpoint=$2 AND key=$3`, [session.userId, endpoint, ctx.idemKey]);
  });
}

async function postBooking(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  if (session.role !== 'tenant' || session.tenantId === null) {
    // Role check after the 404 rules for other tenants' records; a claim body
    // has no path id, so this is a plain 403.
    throw errForbidden();
  }
  const key = idemKeyOr400(ctx);
  const body = await readBodyJsonForSession(ctx);
  const allowed = ['stationId', 'start', 'end', 'shelfId'];
  const unaccepted: Record<string, string> = {};
  for (const k of Object.keys(body)) {
    if (!allowed.includes(k)) unaccepted[k] = fieldCopy.notAccepted;
  }
  const normalized = {
    stationId: body.stationId,
    start: body.start,
    end: body.end,
    shelfId: body.shelfId === undefined ? null : body.shelfId,
  };
  const requestHash = await hashBody({ endpoint: 'POST /api/bookings', body: normalized });

  const { createClaim } = await import('../booking/actions.js');
  const { validateShape } = await import('../domain/rules.js');

  const replay = await lookupIdempotency(ctx, 'POST /api/bookings', requestHash);
  if (replay.replay && replay.stored) {
    json(ctx.res, replay.stored.response_status ?? 201, replay.stored.response_body, { 'Idempotent-Replay': 'true' });
    return;
  }
  // Step 6: the claim limit, before shape validation and rule refusals.
  const { countClaim } = await import('../booking/actions.js');
  await countClaim(ctx.deps, session.tenantId);
  const shape = await inReadTx(ctx.deps, async (tx, now) => {
    const stations = await getStations(tx);
    const stationMap = new Map(stations.map((s) => [s.id, s]));
    return validateShape({
      clock: ctx.deps.clock, now, body: normalized as Record<string, unknown>,
      stations: stationMap, isMove: false, current: null,
    });
  });
  if ('fields' in shape && Object.keys(shape.fields).length > 0) {
    const fields: Record<string, string> = { ...unaccepted, ...shape.fields };
    const ordered: Record<string, string> = {};
    for (const k of ['stationId', 'shelfId', 'start', 'end', ...Object.keys(unaccepted)]) {
      if (fields[k]) ordered[k] = fields[k];
    }
    throw errValidation(ordered);
  }
  await claimIdempotency(ctx, 'POST /api/bookings', requestHash);

  try {
    const result = shape as { start: number; end: number; stationId: string; shelfId: string | null };
    const booking = await createClaim(ctx.deps, session.tenantId, {
      stationId: result.stationId, start: result.start, end: result.end, shelfId: result.shelfId,
    });
    const rendered = await inReadTx(ctx.deps, async (tx, now) => {
      const stations = await getStations(tx);
      return renderBooking(tx, ctx.deps.clock, booking, 'tenant', now, new Map(stations.map((s) => [s.id, s.name])));
    });
    await storeIdemResponse(ctx, 'POST /api/bookings', 201, rendered);
    json(ctx.res, 201, rendered);
  } catch (e) {
    // Only 2xx responses are stored; release the key so it runs fresh.
    await clearIdemKey(ctx, 'POST /api/bookings');
    throw e;
  }
  void key;
}

async function getBooking(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const id = ctx.params.id;
  const data = await inReadTx(ctx.deps, async (tx, now) => {
    const stations = await getStations(tx);
    const names = new Map(stations.map((s) => [s.id, s.name]));
    const { getBookingRow } = await import('../store.js');
    const booking = await getBookingRow(tx, id);
    if (!booking) return null;
    if (session.role === 'tenant' && booking.tenant_id !== session.tenantId) return null;
    if (session.role === 'owner' || session.role === 'shift_lead') {
      return renderBooking(tx, ctx.deps.clock, booking, 'staff', now, names);
    }
    return renderBooking(tx, ctx.deps.clock, booking, 'tenant', now, names);
  });
  if (data === null) throw errNotFound();
  json(ctx.res, 200, data);
}

async function listBookings(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const dateRaw = ctx.url.searchParams.get('date');
  const deps = ctx.deps;
  if (session.role === 'owner' || session.role === 'shift_lead') {
    if (dateRaw === null) throw errValidation({ date: fieldCopy.doorDateRequired });
    const dateKey = parseDateKey(deps.clock, dateRaw);
    if (dateKey === null) throw errValidation({ date: fieldCopy.badDate });
  }
  const dateKey = dateRaw === null ? null : parseDateKey(deps.clock, dateRaw);
  if (dateRaw !== null && dateKey === null) throw errValidation({ date: fieldCopy.badDate });

  const data = await inReadTx(deps, async (tx, now) => {
    const stations = await getStations(tx);
    const names = new Map(stations.map((s) => [s.id, s.name]));
    const isStaff = session.role === 'owner' || session.role === 'shift_lead';
    let rows;
    if (isStaff) {
      const [y, m, d] = dateKey!.split('-').map(Number);
      const dayStart = deps.clock.fromWall(y, m, d, 0, 0, 0);
      const dayEnd = dayStart + 86_400_000;
      const r = await tx.query(`SELECT * FROM bookings WHERE start >= $1 AND start < $2 ORDER BY start`, [dayStart, dayEnd]);
      rows = r.rows;
    } else if (dateKey === null) {
      const r = await tx.query(`SELECT * FROM bookings WHERE tenant_id=$1 ORDER BY start`, [session.tenantId]);
      rows = r.rows;
    } else {
      const [y, m, d] = dateKey.split('-').map(Number);
      const dayStart = deps.clock.fromWall(y, m, d, 0, 0, 0);
      const r = await tx.query(`SELECT * FROM bookings WHERE tenant_id=$1 AND start >= $2 ORDER BY start`, [session.tenantId, dayStart]);
      rows = r.rows;
    }
    const role = isStaff ? 'staff' : 'tenant';
    const bookings = [];
    for (const row of rows) {
      bookings.push(await renderBooking(tx, deps.clock, row, role, now, names));
    }
    return { bookings };
  });
  json(ctx.res, 200, data);
}

async function postConfirm(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  if (session.role !== 'tenant' || session.tenantId === null) throw errForbidden();
  const { confirmBooking } = await import('../booking/actions.js');
  const booking = await confirmBooking(ctx.deps, session.tenantId, ctx.params.id);
  const rendered = await inReadTx(ctx.deps, async (tx, now) => {
    const stations = await getStations(tx);
    return renderBooking(tx, ctx.deps.clock, booking, 'tenant', now, new Map(stations.map((s) => [s.id, s.name])));
  });
  json(ctx.res, 200, rendered);
}

async function postMove(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  if (session.role !== 'tenant' || session.tenantId === null) {
    const b = await inReadTx(ctx.deps, async (tx) => {
      const { getBookingRow } = await import('../store.js');
      return getBookingRow(tx, ctx.params.id);
    });
    if (!b) throw errNotFound();
    throw errForbidden();
  }
  idemKeyOr400(ctx);
  const body = await readBodyJsonForSession(ctx);
  const allowed = ['stationId', 'start', 'end', 'shelfId'];
  const unaccepted: Record<string, string> = {};
  for (const k of Object.keys(body)) {
    if (!allowed.includes(k)) unaccepted[k] = fieldCopy.notAccepted;
  }
  const normalized = {
    stationId: body.stationId,
    start: body.start,
    end: body.end,
    shelfId: body.shelfId === undefined ? null : body.shelfId,
  };
  const { moveBooking } = await import('../booking/actions.js');
  const { validateShape } = await import('../domain/rules.js');

  const current = await inReadTx(ctx.deps, async (tx) => {
    const { getBookingRow } = await import('../store.js');
    return getBookingRow(tx, ctx.params.id);
  });
  if (!current || current.tenant_id !== session.tenantId) throw errNotFound();

  const requestHash = await hashBody({ endpoint: 'POST /api/bookings/:id/move', id: ctx.params.id, body: normalized });
  const replay = await lookupIdempotency(ctx, 'POST /api/bookings/:id/move', requestHash);
  if (replay.replay && replay.stored) {
    json(ctx.res, replay.stored.response_status ?? 200, replay.stored.response_body, { 'Idempotent-Replay': 'true' });
    return;
  }
  const shape = await inReadTx(ctx.deps, async (tx, now) => {
    const stations = await getStations(tx);
    const stationMap = new Map(stations.map((s) => [s.id, s]));
    return validateShape({
      clock: ctx.deps.clock, now, body: normalized as Record<string, unknown>,
      stations: stationMap, isMove: true,
      current: { stationId: current.station_id, shelfId: current.shelf_id, start: current.start, end: current.end },
    });
  });
  if ('fields' in shape && Object.keys(shape.fields).length > 0) {
    const fields: Record<string, string> = { ...unaccepted, ...shape.fields };
    const ordered: Record<string, string> = {};
    for (const k of ['stationId', 'shelfId', 'start', 'end', ...Object.keys(unaccepted)]) {
      if (fields[k]) ordered[k] = fields[k];
    }
    throw errValidation(ordered);
  }
  await claimIdempotency(ctx, 'POST /api/bookings/:id/move', requestHash);

  try {
    const result = shape as { start: number; end: number; stationId: string; shelfId: string | null };
    const booking = await moveBooking(ctx.deps, session.tenantId, ctx.params.id, {
      stationId: result.stationId, start: result.start, end: result.end, shelfId: result.shelfId,
    });
    const rendered = await inReadTx(ctx.deps, async (tx, now) => {
      const stations = await getStations(tx);
      return renderBooking(tx, ctx.deps.clock, booking, 'tenant', now, new Map(stations.map((s) => [s.id, s.name])));
    });
    await storeIdemResponse(ctx, 'POST /api/bookings/:id/move', 200, rendered);
    json(ctx.res, 200, rendered);
  } catch (e) {
    await clearIdemKey(ctx, 'POST /api/bookings/:id/move');
    throw e;
  }
}

async function postCancel(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  if (session.role !== 'tenant' || session.tenantId === null) {
    const b = await inReadTx(ctx.deps, async (tx) => {
      const { getBookingRow } = await import('../store.js');
      return getBookingRow(tx, ctx.params.id);
    });
    if (!b) throw errNotFound();
    throw errForbidden();
  }
  const { cancelBooking } = await import('../booking/actions.js');
  const booking = await cancelBooking(ctx.deps, session.tenantId, ctx.params.id);
  const rendered = await inReadTx(ctx.deps, async (tx, now) => {
    const stations = await getStations(tx);
    return renderBooking(tx, ctx.deps.clock, booking, 'tenant', now, new Map(stations.map((s) => [s.id, s.name])));
  });
  json(ctx.res, 200, rendered);
}

async function postCheckIn(ctx: Ctx): Promise<void> {
  const session = await requireStaff(ctx);
  const b = await inReadTx(ctx.deps, async (tx) => {
    const { getBookingRow } = await import('../store.js');
    return getBookingRow(tx, ctx.params.id);
  });
  if (!b) throw errNotFound();
  const { checkIn } = await import('../booking/doorActions.js');
  const booking = await checkIn(ctx.deps, ctx.params.id, session.displayName);
  const rendered = await inReadTx(ctx.deps, async (tx, now) => {
    const stations = await getStations(tx);
    return renderBooking(tx, ctx.deps.clock, booking, 'staff', now, new Map(stations.map((s) => [s.id, s.name])));
  });
  json(ctx.res, 200, rendered);
}

async function postCheckOut(ctx: Ctx): Promise<void> {
  const session = await requireStaff(ctx);
  const b = await inReadTx(ctx.deps, async (tx) => {
    const { getBookingRow } = await import('../store.js');
    return getBookingRow(tx, ctx.params.id);
  });
  if (!b) throw errNotFound();
  const body = await readBodyJsonForSession(ctx);
  const allowed = ['cleanupDone', 'note'];
  const fields: Record<string, string> = {};
  for (const k of Object.keys(body)) {
    if (!allowed.includes(k)) fields[k] = fieldCopy.notAccepted;
  }
  if (body.cleanupDone !== true) fields.cleanupDone = fieldCopy.cleanupDone;
  if (typeof body.note === 'string' && body.note.length > 500) fields.note = fieldCopy.noteLong;
  if (body.note !== undefined && typeof body.note !== 'string') fields.note = fieldCopy.noteLong;
  if (Object.keys(fields).length > 0) throw errValidation(fields);
  const { checkOut } = await import('../booking/doorActions.js');
  const booking = await checkOut(ctx.deps, ctx.params.id, session.displayName, true, typeof body.note === 'string' ? body.note : '');
  const rendered = await inReadTx(ctx.deps, async (tx, now) => {
    const stations = await getStations(tx);
    return renderBooking(tx, ctx.deps.clock, booking, 'staff', now, new Map(stations.map((s) => [s.id, s.name])));
  });
  json(ctx.res, 200, rendered);
}

async function postNoShow(ctx: Ctx): Promise<void> {
  const session = await requireStaff(ctx);
  const b = await inReadTx(ctx.deps, async (tx) => {
    const { getBookingRow } = await import('../store.js');
    return getBookingRow(tx, ctx.params.id);
  });
  if (!b) throw errNotFound();
  const { markNoShow } = await import('../booking/doorActions.js');
  const booking = await markNoShow(ctx.deps, ctx.params.id, session.displayName);
  const rendered = await inReadTx(ctx.deps, async (tx, now) => {
    const stations = await getStations(tx);
    return renderBooking(tx, ctx.deps.clock, booking, 'staff', now, new Map(stations.map((s) => [s.id, s.name])));
  });
  json(ctx.res, 200, rendered);
}

async function doorList(ctx: Ctx): Promise<void> {
  await requireStaff(ctx);
  const deps = ctx.deps;
  const dateRaw = ctx.url.searchParams.get('date');
  let dateKey: string;
  if (dateRaw === null) {
    dateKey = await inReadTx(deps, async (_tx, now) => deps.clock.dateKey(now));
  } else {
    const parsed = parseDateKey(deps.clock, dateRaw);
    if (parsed === null) throw errValidation({ date: fieldCopy.badDate });
    dateKey = parsed;
  }
  const data = await inReadTx(deps, async (tx, now) => {
    const stations = await getStations(tx);
    const [y, m, d] = dateKey.split('-').map(Number);
    const dayStart = deps.clock.fromWall(y, m, d, 0, 0, 0);
    const dayEnd = dayStart + 86_400_000;
    const r = await tx.query(`SELECT * FROM bookings WHERE start >= $1 AND start < $2 ORDER BY start`, [dayStart, dayEnd]);
    const entries = [];
    for (const b of r.rows) {
      const docs = await getCurrentDocuments(tx, b.tenant_id);
      const tenantR = await tx.query<{ business_name: string; status: string }>(`SELECT business_name, status FROM tenants WHERE id=$1`, [b.tenant_id]);
      const clearance = clearanceFor(tenantR.rows[0].status, docs.insurance?.expires_on ?? null, docs.foodHandler?.expires_on ?? null, dateKey);
      const { doorLogFor } = await import('../booking/door.js');
      const log = await doorLogFor(tx, b.id);
      entries.push({
        bookingId: b.id,
        tenantId: b.tenant_id,
        tenantName: tenantR.rows[0].business_name,
        stationId: b.station_id,
        stationName: stations.find((s) => s.id === b.station_id)?.name ?? b.station_id,
        shelfId: b.shelf_id,
        shelfName: b.shelf_id ? (stations.find((s) => s.id === b.shelf_id)?.name ?? b.shelf_id) : null,
        start: deps.clock.iso(b.start),
        end: deps.clock.iso(b.end),
        status: b.status,
        cleared: clearance.cleared,
        reason: clearance.reason,
        checkInOpensAt: deps.clock.iso(b.start - 30 * 60_000),
        actions: doorActionsFor(b, now, clearance),
        doorLog: log.map((entry) => ({ action: entry.action, at: deps.clock.iso(entry.at), by: entry.by })),
        cleanupNote: b.cleanup_note,
      });
    }
    return { date: dateKey, now: deps.clock.iso(now), entries };
  });
  json(ctx.res, 200, data);
}

function doorActionsFor(b: { status: string; start: number; end: number }, now: number, clearance: { cleared: boolean }): string[] {
  const actions: string[] = [];
  if (b.status === 'confirmed') {
    const opensAt = b.start - 30 * 60_000;
    if (now >= opensAt && now < b.end && clearance.cleared) actions.push('check_in');
    if (now >= b.start) actions.push('no_show');
  } else if (b.status === 'checked_in') {
    actions.push('check_out');
  }
  return actions;
}

// ---------- packs ----------

async function postPack(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  if (session.role !== 'tenant' || session.tenantId === null) throw errForbidden();
  idemKeyOr400(ctx);
  const body = await readBodyJsonForSession(ctx);
  const allowed = ['hours'];
  const fields: Record<string, string> = {};
  for (const k of Object.keys(body)) {
    if (!allowed.includes(k)) fields[k] = fieldCopy.notAccepted;
  }
  const hours = body.hours;
  if (hours !== 10 && hours !== 20 && hours !== 40) fields.hours = fieldCopy.hoursInvalid;
  if (Object.keys(fields).length > 0) throw errValidation(fields);

  // Step 5: the replay lookup never needs the password and never calls Kill Bill.
  const requestHash = await hashBody({ endpoint: 'POST /api/packs', body: { hours } });
  const replay = await lookupIdempotency(ctx, 'POST /api/packs', requestHash);
  if (replay.replay && replay.stored) {
    json(ctx.res, replay.stored.response_status ?? 201, replay.stored.response_body, { 'Idempotent-Replay': 'true' });
    return;
  }

  // Step 9: the step-up password check writes nothing on refusal.
  if (hours === 20 || hours === 40) {
    requireFreshConfirmation(ctx);
  }
  await claimIdempotency(ctx, 'POST /api/packs', requestHash);

  const { purchasePack } = await import('../booking/purchases.js');
  const { newId } = await import('../domain/crypto.js');

  // A purchase records its attempt before its first billing call.
  const attemptId = await inWriteTx(ctx.deps, async (tx, now) => {
    const id = newId();
    const existing = await tx.query(
      `SELECT id, status, invoice_id, payment_id FROM purchase_attempts WHERE user_id=$1 AND key=$2`,
      [session.userId, ctx.idemKey],
    );
    if (existing.rows.length > 0) {
      return existing.rows[0];
    }
    await tx.query(
      `INSERT INTO purchase_attempts (id, user_id, key, created_at, status) VALUES ($1,$2,$3,$4,'open')`,
      [id, session.userId, ctx.idemKey, now],
    );
    return { id, status: 'open', invoice_id: null, payment_id: null };
  });

  try {
    const outcome = await purchasePack(ctx.deps, ctx.kb, session.tenantId, hours as 10 | 20 | 40, attemptId.id);
    const rendered = await inReadTx(ctx.deps, async (tx, now) => {
      return renderPack(tx, ctx.deps.clock, outcome.pack, now, false);
    });
    await storeIdemResponse(ctx, 'POST /api/packs', 201, rendered);
    json(ctx.res, 201, rendered);
  } catch (e) {
    await clearIdemKey(ctx, 'POST /api/packs');
    throw e;
  }
}

async function listPacks(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  if (session.role !== 'tenant' || session.tenantId === null) throw errForbidden();
  const data = await inReadTx(ctx.deps, async (tx, now) => {
    const r = await tx.query(`SELECT * FROM packs WHERE tenant_id=$1 ORDER BY purchased_at, id`, [session.tenantId]);
    const packs = [];
    for (const row of r.rows) {
      packs.push(await renderPack(tx, ctx.deps.clock, row, now, false));
    }
    return { packs };
  });
  json(ctx.res, 200, data);
}

async function loadPackForCaller(ctx: Ctx): Promise<import('../store.js').PackRow | null> {
  const session = ctx.session!;
  return inReadTx(ctx.deps, async (tx) => {
    const r = await tx.query<import('../store.js').PackRow>(`SELECT * FROM packs WHERE id=$1`, [ctx.params.id]);
    const pack = r.rows[0];
    if (!pack) return null;
    if (session.role === 'owner') return pack;
    if (session.role === 'tenant' && pack.tenant_id === session.tenantId) return pack;
    return null;
  });
}

async function getPack(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  const pack = await loadPackForCaller(ctx);
  if (pack === null) {
    // A shift lead asking for a real pack gets 403; anything unknown gets 404.
    if (session.role === 'shift_lead') {
      const exists = await inReadTx(ctx.deps, async (tx) => {
        const r = await tx.query(`SELECT id FROM packs WHERE id=$1`, [ctx.params.id]);
        return r.rows.length > 0;
      });
      if (exists) throw errForbidden();
    }
    throw errNotFound();
  }
  const data = await inReadTx(ctx.deps, async (tx, now) => {
    return renderPack(tx, ctx.deps.clock, pack, now, true);
  });
  json(ctx.res, 200, data);
}

async function postRefund(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  if (session.role !== 'owner') {
    // A tenant naming their own pack on a closed route gets 403; unknown 404.
    const pack = await loadPackForCaller(ctx);
    if (pack === null) throw errNotFound();
    throw errForbidden();
  }
  const body = await readBodyJsonForSession(ctx);
  const allowed = ['expectedCents'];
  const fields: Record<string, string> = {};
  for (const k of Object.keys(body)) {
    if (!allowed.includes(k)) fields[k] = fieldCopy.notAccepted;
  }
  if (typeof body.expectedCents !== 'number' || !Number.isInteger(body.expectedCents) || body.expectedCents < 0) {
    fields.expectedCents = fieldCopy.expectedCents;
  }
  if (Object.keys(fields).length > 0) throw errValidation(fields);

  requireFreshConfirmation(ctx);

  const { refundPack } = await import('../booking/purchases.js');
  const pack = await refundPack(ctx.deps, ctx.kb, ctx.params.id, body.expectedCents as number);
  const data = await inReadTx(ctx.deps, async (tx, now) => {
    return renderPack(tx, ctx.deps.clock, pack, now, true);
  });
  json(ctx.res, 200, data);
}

// ---------- documents ----------

async function postDocument(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  if (session.role !== 'tenant' || session.tenantId === null) throw errForbidden();
  const { fields, file } = await readMultipart(ctx);
  const kind = fields.get('kind');
  const expiresOn = fields.get('expiresOn');
  const limit = fields.get('perOccurrenceLimit');
  const insured = fields.get('additionalInsured');

  const errors: Record<string, string> = {};
  const isInsurance = kind === 'insurance_certificate';
  if (kind !== 'insurance_certificate' && kind !== 'food_handler_card') errors.kind = fieldCopy.kindInvalid;
  const todayKey = ctx.deps.clock.dateKey(Date.now());
  if (expiresOn === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) || ctx.deps.clock.parseDate(expiresOn) === null) {
    errors.expiresOn = fieldCopy.expiresInvalid;
  } else if (expiresOn < todayKey) {
    errors.expiresOn = fieldCopy.filePast;
  }
  if (isInsurance) {
    const limitNum = limit === undefined ? NaN : Number(limit);
    if (!Number.isInteger(limitNum) || limitNum < 1000000) errors.perOccurrenceLimit = fieldCopy.limitLow;
    if (insured !== 'true') errors.additionalInsured = fieldCopy.additionalInsured;
  } else if (kind === 'food_handler_card') {
    if (limit !== undefined) errors.perOccurrenceLimit = fieldCopy.notAccepted;
    if (insured !== undefined) errors.additionalInsured = fieldCopy.notAccepted;
  }
  if (file === null || file.length === 0) errors.file = fieldCopy.fileMissing;
  if (Object.keys(errors).length > 0) throw errValidation(errors);

  const { uploadDocument } = await import('../booking/documents.js');
  const doc = await uploadDocument(ctx.deps, ctx.objStore, session.tenantId, {
    kind: kind as 'insurance_certificate' | 'food_handler_card',
    expiresOn: expiresOn ?? '',
    perOccurrenceLimit: isInsurance ? Number(limit) : null,
    additionalInsured: isInsurance ? insured === 'true' : null,
    bytes: file as Uint8Array,
  });
  const data = await inReadTx(ctx.deps, async (tx) => {
    const today = ctx.deps.clock.dateKey(Date.now());
    return renderDocument(tx, ctx.deps.clock, doc, today);
  });
  json(ctx.res, 201, data);
}

async function listDocuments(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  let tenantId: string;
  if (session.role === 'owner') {
    const raw = ctx.url.searchParams.get('tenantId');
    if (raw === null) throw errValidation({ tenantId: fieldCopy.doorDateRequired });
    tenantId = raw;
  } else if (session.role === 'tenant') {
    const raw = ctx.url.searchParams.get('tenantId');
    if (raw !== null && raw !== session.tenantId) throw errNotFound();
    tenantId = session.tenantId!;
  } else {
    throw errForbidden();
  }
  const data = await inReadTx(ctx.deps, async (tx, now) => {
    const today = ctx.deps.clock.dateKey(now);
    const r = await tx.query(`SELECT * FROM documents WHERE tenant_id=$1 ORDER BY uploaded_at DESC`, [tenantId]);
    const documents = [];
    for (const row of r.rows) {
      documents.push(await renderDocument(tx, ctx.deps.clock, row, today));
    }
    return { documents };
  });
  json(ctx.res, 200, data);
}

async function loadDocument(ctx: Ctx): Promise<import('../store.js').DocumentRow | null> {
  const session = ctx.session!;
  return inReadTx(ctx.deps, async (tx) => {
    const r = await tx.query<import('../store.js').DocumentRow>(`SELECT * FROM documents WHERE id=$1`, [ctx.params.id]);
    const doc = r.rows[0];
    if (!doc) return null;
    if (session.role === 'owner') return doc;
    if (session.role === 'tenant' && doc.tenant_id === session.tenantId) return doc;
    return null;
  });
}

async function getDocument(ctx: Ctx): Promise<void> {
  await requireSession(ctx);
  const doc = await loadDocument(ctx);
  if (doc === null) throw errNotFound();
  const data = await inReadTx(ctx.deps, async (tx, now) => {
    const today = ctx.deps.clock.dateKey(now);
    return renderDocument(tx, ctx.deps.clock, doc, today);
  });
  json(ctx.res, 200, data);
}

async function getDocumentFile(ctx: Ctx): Promise<void> {
  await requireSession(ctx);
  const doc = await loadDocument(ctx);
  if (doc === null) throw errNotFound();
  if (!doc.has_file) throw new ApiError(404, 'file_not_found', "That record isn't available.");
  const { readDocumentFile } = await import('../booking/documents.js');
  const file = await readDocumentFile(ctx.deps, ctx.objStore, doc);
  const ext = doc.content_type === 'image/png' ? 'png' : doc.content_type === 'image/jpeg' ? 'jpg' : 'pdf';
  const body = Buffer.from(file.bytes);
  ctx.res.writeHead(200, {
    'Content-Type': file.contentType,
    'Content-Length': String(body.length),
    'Content-Disposition': `inline; filename="${doc.kind}-${doc.id}.${ext}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
    'Cache-Control': 'private, no-store',
  });
  ctx.res.end(body);
}

// ---------- tenants ----------

async function listTenants(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  if (session.role !== 'owner') throw errForbidden();
  const data = await inReadTx(ctx.deps, async (tx, now) => {
    const today = ctx.deps.clock.dateKey(now);
    const r = await tx.query(`SELECT * FROM tenants ORDER BY business_name`);
    const tenants = [];
    for (const row of r.rows) {
      const docs = await getCurrentDocuments(tx, row.id);
      tenants.push({
        id: row.id,
        businessName: row.business_name,
        contactName: row.contact_name,
        email: (await tx.query<{ email: string }>(`SELECT email FROM users WHERE id=$1`, [row.user_id])).rows[0].email,
        status: row.status,
        suspendedReason: row.suspended_reason,
        insuranceExpiresOn: docs.insurance?.expires_on ?? null,
        foodHandlerExpiresOn: docs.foodHandler?.expires_on ?? null,
        createdAt: ctx.deps.clock.iso(row.created_at),
      });
    }
    void today;
    return { tenants };
  });
  json(ctx.res, 200, data);
}

async function getTenantDetail(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  if (session.role !== 'owner') throw errNotFound();
  const data = await inReadTx(ctx.deps, async (tx, now) => {
    const r = await tx.query(`SELECT * FROM tenants WHERE id=$1`, [ctx.params.id]);
    const tenant = r.rows[0];
    if (!tenant) return null;
    const today = ctx.deps.clock.dateKey(now);
    const docs = await getCurrentDocuments(tx, tenant.id);
    const packsR = await tx.query(`SELECT * FROM packs WHERE tenant_id=$1 ORDER BY purchased_at, id`, [tenant.id]);
    const packs = [];
    for (const pack of packsR.rows) {
      packs.push(await renderPack(tx, ctx.deps.clock, pack, now, true));
    }
    const docsR = await tx.query(`SELECT * FROM documents WHERE tenant_id=$1 ORDER BY uploaded_at DESC`, [tenant.id]);
    const documents = [];
    for (const doc of docsR.rows) {
      documents.push(await renderDocument(tx, ctx.deps.clock, doc, today));
    }
    const email = (await tx.query<{ email: string }>(`SELECT email FROM users WHERE id=$1`, [tenant.user_id])).rows[0].email;
    return {
      id: tenant.id,
      businessName: tenant.business_name,
      contactName: tenant.contact_name,
      email,
      status: tenant.status,
      suspendedReason: tenant.suspended_reason,
      insuranceExpiresOn: docs.insurance?.expires_on ?? null,
      foodHandlerExpiresOn: docs.foodHandler?.expires_on ?? null,
      createdAt: ctx.deps.clock.iso(tenant.created_at),
      packs,
      documents,
    };
  });
  if (data === null) throw errNotFound();
  json(ctx.res, 200, data);
}

async function approveTenant(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  if (session.role !== 'owner') throw errNotFound();
  const todayKey = await inReadTx(ctx.deps, async (_tx, now) => ctx.deps.clock.dateKey(now));
  const result = await inWriteTx(ctx.deps, async (tx) => {
    const r = await tx.query(`SELECT * FROM tenants WHERE id=$1 FOR UPDATE`, [ctx.params.id]);
    const tenant = r.rows[0];
    if (!tenant) return null;
    if (tenant.status !== 'documents_pending') {
      throw errConflict('invalid_transition', 'Approve applies to a tenant waiting for review.');
    }
    const docs = await getCurrentDocuments(tx, tenant.id);
    const insurance = docs.insurance?.expires_on ?? '';
    const food = docs.foodHandler?.expires_on ?? '';
    if (insurance === '' || food === '' || insurance < todayKey || food < todayKey) {
      throw errConflict('documents_not_valid', 'This tenant has a lapsed document and cannot be approved.');
    }
    await tx.query(`UPDATE tenants SET status='approved', suspended_reason=NULL WHERE id=$1`, [ctx.params.id]);
    return true;
  });
  if (result === null) throw errNotFound();
  const data = await inReadTx(ctx.deps, async (tx, _now) => {
    const r = await tx.query(`SELECT * FROM tenants WHERE id=$1`, [ctx.params.id]);
    const tenant = r.rows[0];
    const docs = await getCurrentDocuments(tx, tenant.id);
    return {
      id: tenant.id,
      businessName: tenant.business_name,
      contactName: tenant.contact_name,
      email: (await tx.query<{ email: string }>(`SELECT email FROM users WHERE id=$1`, [tenant.user_id])).rows[0].email,
      status: tenant.status,
      suspendedReason: tenant.suspended_reason,
      insuranceExpiresOn: docs.insurance?.expires_on ?? null,
      foodHandlerExpiresOn: docs.foodHandler?.expires_on ?? null,
      createdAt: ctx.deps.clock.iso(tenant.created_at),
    };
  });
  json(ctx.res, 200, data);
}

// ---------- report ----------

async function dailyReport(ctx: Ctx): Promise<void> {
  const session = await requireSession(ctx);
  if (session.role !== 'owner') throw errForbidden();
  const dateRaw = ctx.url.searchParams.get('date');
  if (dateRaw === null) throw errValidation({ date: fieldCopy.reportDateRequired });
  const dateKey = parseDateKey(ctx.deps.clock, dateRaw);
  if (dateKey === null) throw errValidation({ date: fieldCopy.badDate });
  const deps = ctx.deps;
  const data = await inReadTx(deps, async (tx) => {
    const stations = await getStations(tx);
    const [y, m, d] = dateKey.split('-').map(Number);
    const dayStart = deps.clock.fromWall(y, m, d, 0, 0, 0);
    const dayEnd = dayStart + 86_400_000;
    const r = await tx.query(
      `SELECT b.*, t.business_name FROM bookings b JOIN tenants t ON t.id=b.tenant_id
       WHERE b.start >= $1 AND b.start < $2 AND b.status IN ('confirmed','checked_in','completed','no_show')`,
      [dayStart, dayEnd],
    );
    const stationMinutes = new Map<string, number>();
    const stationCount = new Map<string, number>();
    for (const s of stations) { stationMinutes.set(s.id, 0); stationCount.set(s.id, 0); }
    const tenantMinutes = new Map<string, number>();
    const tenantBookings = new Map<string, number>();
    const tenantNoShows = new Map<string, number>();
    const tenantNames = new Map<string, string>();
    for (const b of r.rows) {
      const spanMinutes = Math.round((b.end - b.start) / 60_000);
      for (const stationId of [b.station_id, ...(b.shelf_id ? [b.shelf_id] : [])]) {
        stationMinutes.set(stationId, (stationMinutes.get(stationId) ?? 0) + spanMinutes);
        stationCount.set(stationId, (stationCount.get(stationId) ?? 0) + 1);
      }
      const minutes = spanMinutes * (b.shelf_id === null ? 1 : 2);
      tenantMinutes.set(b.tenant_id, (tenantMinutes.get(b.tenant_id) ?? 0) + minutes);
      tenantBookings.set(b.tenant_id, (tenantBookings.get(b.tenant_id) ?? 0) + 1);
      if (b.status === 'no_show') tenantNoShows.set(b.tenant_id, (tenantNoShows.get(b.tenant_id) ?? 0) + 1);
      tenantNames.set(b.tenant_id, b.business_name);
    }
    let total = 0;
    const stationsJson = stations.map((s) => {
      const booked = stationMinutes.get(s.id) ?? 0;
      total += booked;
      return { stationId: s.id, stationName: s.name, bookedMinutes: booked, bookingCount: stationCount.get(s.id) ?? 0 };
    });
    const tenantsJson = [...tenantMinutes.entries()].map(([id, minutes]) => ({
      tenantId: id,
      businessName: tenantNames.get(id) ?? '',
      bookedMinutes: minutes,
      bookingCount: tenantBookings.get(id) ?? 0,
      noShowCount: tenantNoShows.get(id) ?? 0,
    }));
    return {
      date: dateKey,
      timeZone: deps.clock.zone,
      totalBookedMinutes: total,
      stations: stationsJson,
      tenants: tenantsJson,
    };
  });
  json(ctx.res, 200, data);
}
