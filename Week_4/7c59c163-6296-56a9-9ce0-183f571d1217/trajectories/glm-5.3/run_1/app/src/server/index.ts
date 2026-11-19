import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { loadConfig } from './config.js';
import { AppError } from './errors.js';
import { createPool, type Pool } from './db.js';
import { applySchema } from './schema.js';
import { KeycloakClient } from './keycloak.js';
import { KillBillClient } from './killbill.js';
import { SvixClient } from './svix.js';
import { Mailer } from './mailer.js';
import { createRedis, createSubscriber, RateLimiter, Bus } from './valkey.js';
import { createS3Client } from './s3.js';
import { Exchange } from './exchange.js';
import { Billing } from './billing.js';
import { applySeed } from './seed.js';
import { startWorkers } from './workers.js';
import { handleApi, type HandlerDeps, type RequestCtx, type SessionData } from './routes.js';
import { enqueue } from './queue.js';
import type { PoolClient } from 'pg';

const config = loadConfig();
const pool: Pool = createPool(config.databaseUrl, 20);
const keycloak = new KeycloakClient(config);
const killbill = new KillBillClient(config);
const svix = new SvixClient(config);
const mailer = new Mailer(config);
const redis = createRedis(config);
const subscriber = createSubscriber(config);
const limiter = new RateLimiter(redis);
const bus = new Bus(redis);
const s3 = createS3Client(config);

const sessions = new Map<string, SessionData>();

async function enqueueNotify(client: PoolClient, venueId: string, payload: Record<string, unknown>): Promise<void> {
  await enqueue(client, {
    kind: payload['kind'] as 'book' | 'member_event' | 'webhook' | 'email',
    venueId,
    payload,
  });
}

const exchange = new Exchange(pool, config, enqueueNotify);
const billing = new Billing(pool, config, killbill, limiter);

async function killbillUp(): Promise<boolean> {
  try {
    await killbill.getAccountByExternalKey('plumtide-health-probe');
    return true;
  } catch {
    return false;
  }
}

const deps: HandlerDeps = {
  pool,
  config,
  keycloak,
  svix,
  mailer,
  limiter,
  redis,
  s3,
  exchange,
  billing,
  sessions,
  killbillUp,
};

interface StreamClient {
  res: ServerResponse;
  memberId: string | null;
  marketId: string;
}

const streamClients = new Set<StreamClient>();

function sseWrite(client: StreamClient, event: string, data: Record<string, unknown>): void {
  client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function start(): Promise<void> {
  await applySchema(pool).catch((err) => {
    console.error('schema apply failed', err);
  });
  await redis.connect().catch(() => undefined);

  void startupLoop();
  void startWorkers({
    workerId: `worker-${crypto.randomUUID()}`,
    pool,
    config,
    mailer,
    svix,
    bus,
    s3,
  });
  void relayLoop();
  void timersLoop();

  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`plumtide-venue serving on 0.0.0.0:${config.port}`);
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';

    if (url.pathname === '/api/stream') {
      await handleStream(req, res, url);
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      const isMultipart = (req.headers['content-type'] ?? '').includes('multipart/form-data');
      const limit = isMultipart ? 5_200_000 : 65_536;
      const bodyBuffer = await readBody(req, limit);
      const ctx = await buildContext(req, url, method, bodyBuffer);
      const result = await handleApi(deps, ctx);
      if (Buffer.isBuffer((result as { body: unknown }).body)) {
        const csv = result as { status: number; body: Buffer; contentType: string; headers?: Record<string, string> };
        res.writeHead(csv.status, {
          'Content-Type': csv.contentType,
          'Content-Length': csv.body.length,
          ...(csv.headers ?? {}),
        });
        res.end(csv.body);
        return;
      }
      const json = result as { status: number; body: unknown; headers?: Record<string, string> };
      if (json.status === 204) {
        res.writeHead(204, json.headers ?? {});
        res.end();
        return;
      }
      const payload = JSON.stringify(json.body);
      res.writeHead(json.status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        ...(json.headers ?? {}),
      });
      res.end(payload);
      return;
    }

    if (url.pathname.startsWith('/auth/')) {
      await handleAuth(req, res, url);
      return;
    }

    // Static frontend
    serveStatic(res, url.pathname);
  } catch (err) {
    if (err instanceof AppError) {
      const payload = JSON.stringify(err.body);
      res.writeHead(err.status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
      });
      res.end(payload);
      return;
    }
    console.error('request failed', err);
    if (!res.headersSent) {
      const payload = JSON.stringify({ error: 'internal' });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
      res.end(payload);
    } else {
      res.end();
    }
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      total += chunk.length;
      if (total > limit) {
        aborted = true;
        reject(new AppError(413, { error: 'payload_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      if (!aborted) reject(err);
    });
  });
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq > 0) out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

async function buildContext(req: IncomingMessage, url: URL, method: string, bodyBuffer: Buffer): Promise<RequestCtx> {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies['pv_session'];
  const session = sessionId ? sessions.get(sessionId) ?? null : null;

  const ctx: RequestCtx = {
    method,
    url,
    headers: req.headers as Record<string, string | string[] | undefined>,
    bodyBuffer,
    session,
    member: null,
    apiKeyId: null,
  };

  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer pv_')) {
    const secret = auth.slice('Bearer '.length);
    const hash = crypto.createHash('sha256').update(secret).digest('hex');
    const res = await pool.query(`SELECT * FROM api_keys WHERE secret_hash = $1 AND revoked_at IS NULL`, [hash]);
    const key = res.rows[0] as { id: string; member_id: string } | undefined;
    if (key) {
      ctx.apiKeyId = key.id;
      const memberRes = await pool.query(`SELECT * FROM members WHERE id = $1`, [key.member_id]);
      ctx.member = (memberRes.rows[0] as RequestCtx['member']) ?? null;
      const outcome = await limiter.consume(key.id).catch(() => null);
      if (outcome && !outcome.allowed) {
        throw new AppError(429, { error: 'rate_limited', retry_after_ms: outcome.retryAfterMs });
      }
    }
  }
  return ctx;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
};

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const SERVABLE_EXTENSIONS = new Set(['.html', '.css', '.js', '.json', '.ttf', '.woff', '.woff2', '.svg', '.png', '.ico', '.txt']);

function sendFile(res: ServerResponse, target: string, cache: string): void {
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': cache,
  });
  fs.createReadStream(target).pipe(res);
}

// Paths that must never be served, per the server boundary rule.
const PROTECTED = new Set(['/run.json', '/package.json', '/package-lock.json', '/tsconfig.json', '/tsconfig.server.json', '/tsconfig.client.json', '/third_party_notices.md']);

function serveStatic(res: ServerResponse, pathname: string): void {
  const lowered = pathname.toLowerCase();
  if (PROTECTED.has(pathname) || lowered.endsWith('.ts') || lowered.endsWith('.env') || pathname.startsWith('/src/') || pathname.startsWith('/dist/') || pathname.startsWith('/node_modules/') || pathname.startsWith('/tools/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  let relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (relative.endsWith('/')) relative += 'index.html';
  const target = path.resolve(PUBLIC_DIR, relative);
  const inside = target === PUBLIC_DIR || target.startsWith(PUBLIC_DIR + path.sep);
  const ext = path.extname(target).toLowerCase();
  if (inside && SERVABLE_EXTENSIONS.has(ext) && fs.existsSync(target) && fs.statSync(target).isFile()) {
    sendFile(res, target, ext === '.html' ? 'no-cache' : 'public, max-age=3600');
    return;
  }
  // SPA routes fall back to the index, which renders the Not found page for
  // unknown records; unknown paths return the index which shows Not found.
  const index = path.resolve(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(index)) {
    sendFile(res, index, 'no-cache');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}

interface AuthAttempt {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
  createdAt: number;
  used: boolean;
}

const authAttempts = new Map<string, AuthAttempt>();

async function handleAuth(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const issuer = config.keycloak.issuerUrl.replace(/\/$/, '');
  if (url.pathname === '/auth/login') {
    const nextParam = url.searchParams.get('next');
    const next = nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';
    const state = crypto.randomBytes(24).toString('hex');
    const nonce = crypto.randomBytes(24).toString('hex');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const attemptId = crypto.randomBytes(24).toString('hex');
    authAttempts.set(attemptId, { state, nonce, verifier, next, createdAt: Date.now(), used: false });
    const authUrl = new URL(`${issuer}/protocol/openid-connect/auth`);
    authUrl.searchParams.set('client_id', config.keycloak.clientId);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('nonce', nonce);
    authUrl.searchParams.set('redirect_uri', `${config.publicUrl}/auth/callback`);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    res.writeHead(302, {
      Location: authUrl.toString(),
      'Set-Cookie': `pv_attempt=${attemptId}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=600`,
    });
    res.end();
    return;
  }

  if (url.pathname === '/auth/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const cookies = parseCookies(req.headers.cookie);
    const attemptId = cookies['pv_attempt'];
    const attempt = attemptId ? authAttempts.get(attemptId) : undefined;
    const next = attempt?.next ?? '/';
    if (!code || !state || !attempt || attempt.used || attempt.state !== state || Date.now() - attempt.createdAt > 600_000) {
      authAttempts.delete(attemptId ?? '');
      res.writeHead(302, { 'Set-Cookie': 'pv_attempt=; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=0', Location: '/signin-error' });
      res.end();
      return;
    }
    attempt.used = true;
    try {
      const tokenRes = await fetch(`${issuer}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.keycloak.clientId,
          client_secret: config.keycloak.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: `${config.publicUrl}/auth/callback`,
          code_verifier: attempt.verifier,
        }),
      });
      if (!tokenRes.ok) throw new Error('token exchange failed');
      const tokens = (await tokenRes.json()) as { access_token: string };
      const payload = JSON.parse(Buffer.from(tokens.access_token.split('.')[1] ?? '', 'base64').toString('utf8')) as {
        sub: string;
        preferred_username?: string;
        nonce?: string;
        realm_access?: { roles?: string[] };
      };
      if (payload.nonce !== attempt.nonce) throw new Error('nonce mismatch');
      const roles = payload.realm_access?.roles ?? [];
      const groups = await keycloak.userGroups(payload.sub);
      const venueGroup = groups.find((g) => g.name.startsWith('venue-'));
      const venueSlug = venueGroup ? venueGroup.name.replace(/^venue-/, '') : null;
      let venueId: string | null = null;
      if (venueSlug) {
        const venueRes = await pool.query(`SELECT id FROM venues WHERE slug = $1`, [venueSlug]);
        venueId = ((venueRes.rows[0] as { id: string } | undefined)?.id) ?? null;
      }
      const session: SessionData = {
        userId: payload.sub,
        username: payload.preferred_username ?? '',
        roles: roles.filter((r) => ['trader', 'builder', 'market_admin', 'org_owner', 'founder_operator'].includes(r)),
        venueId,
      };
      const sessionId = crypto.randomBytes(24).toString('hex');
      sessions.set(sessionId, session);
      authAttempts.delete(attemptId ?? '');
      res.writeHead(302, {
        'Set-Cookie': [
          `pv_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`,
          'pv_attempt=; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=0',
        ],
        Location: next,
      });
      res.end();
      return;
    } catch {
      authAttempts.delete(attemptId ?? '');
      res.writeHead(302, { Location: '/signin-unavailable' });
      res.end();
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
}

async function handleStream(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies['pv_session'];
  const session = sessionId ? sessions.get(sessionId) ?? null : null;
  if (!session) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthenticated' }));
    return;
  }
  const marketId = url.searchParams.get('market_id') ?? '';
  const headers = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' };
  res.writeHead(200, headers);
  const client: StreamClient = { res, memberId: session.venueId ? session.userId : null, marketId };
  streamClients.add(client);
  req.on('close', () => {
    streamClients.delete(client);
  });
}

async function relayLoop(): Promise<void> {
  await subscriber.connect().catch(() => undefined);
  subscriber.on('message', (channel, message) => {
    try {
      const parsed = JSON.parse(message) as { event: string; data: Record<string, unknown> };
      for (const client of streamClients) {
        if (channel.startsWith('market:')) {
          if (channel.slice('market:'.length) === client.marketId) {
            sseWrite(client, parsed.event, parsed.data);
          }
        } else if (channel.startsWith('member:')) {
          if (client.memberId && channel.slice('member:'.length) === client.memberId) {
            sseWrite(client, parsed.event, parsed.data);
          }
        }
      }
    } catch {
      // ignore malformed messages
    }
  });
  const patternSubscribe = async (): Promise<void> => {
    await subscriber.psubscribe('market:*', 'member:*').catch(() => undefined);
  };
  await patternSubscribe();
}

async function timersLoop(): Promise<void> {
  setInterval(() => {
    void closeDueEvents();
  }, 1000);
  setInterval(() => {
    void billing.pollOverdue();
  }, config.overduePollSeconds * 1000);
  setInterval(() => {
    void settleResolvedEvents();
  }, 1000);
  setInterval(() => {
    void monthlyStatements();
  }, 60_000);
}

async function closeDueEvents(): Promise<void> {
  const res = await pool.query(
    `SELECT id, venue_id FROM markets WHERE kind = 'event' AND status IN ('trading','halted') AND closes_at IS NOT NULL AND closes_at <= now() AND auto_closed = false`
  );
  for (const row of res.rows as { id: string; venue_id: string }[]) {
    await exchange.closeEvent(row.venue_id, row.id).catch(() => undefined);
    await publishMarketEvent(row.venue_id, row.id);
  }
}

async function settleResolvedEvents(): Promise<void> {
  const res = await pool.query(
    `SELECT id, venue_id, outcome FROM markets WHERE kind = 'event' AND status = 'resolved' AND outcome IS NOT NULL AND settled_at IS NULL`
  );
  for (const row of res.rows as { id: string; venue_id: string; outcome: 'yes' | 'no' }[]) {
    await exchange.settleEvent(row.venue_id, row.id, row.outcome).catch(() => undefined);
    await publishMarketEvent(row.venue_id, row.id);
  }
}

async function publishMarketEvent(venueId: string, marketId: string): Promise<void> {
  const client = await pool.connect();
  try {
    const market = await exchange.loadMarketAny(client, marketId);
    if (!market) return;
    const snapshot = await exchange.bookSnapshot(client, market);
    await bus.publish(`market:${marketId}`, 'book', snapshot as unknown as Record<string, unknown>);
    await bus.publish(`market:${marketId}`, 'market', { market_id: marketId, status: market.status, last_price: market.last_price, outcome: market.outcome });
  } finally {
    client.release();
  }
  void venueId;
}

async function monthlyStatements(): Promise<void> {
  const res = await pool.query(`SELECT id, time_zone FROM venues`);
  for (const venue of res.rows as { id: string; time_zone: string }[]) {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: venue.time_zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: false });
    const parts = fmt.formatToParts(now);
    const day = Number(parts.find((p) => p.type === 'day')?.value ?? '0');
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    if (day === 1 && hour === 0 && minute < 10) {
      const monthFmt = new Intl.DateTimeFormat('en-US', { timeZone: venue.time_zone, year: 'numeric', month: '2-digit' });
      const current = monthFmt.formatToParts(new Date(now.getTime() - 24 * 3600 * 1000));
      const year = current.find((p) => p.type === 'year')?.value ?? '';
      const month = current.find((p) => p.type === 'month')?.value ?? '';
      const targetMonth = `${year}-${month}`;
      const members = await pool.query(`SELECT id FROM members WHERE venue_id = $1`, [venue.id]);
      for (const member of members.rows as { id: string }[]) {
        const exists = await pool.query(`SELECT 1 FROM statement_runs WHERE venue_id = $1 AND month = $2`, [venue.id, targetMonth]);
        if ((exists.rowCount ?? 0) > 0) continue;
      }
      await pool.query(`INSERT INTO statement_runs (venue_id, month) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [venue.id, targetMonth]);
    }
  }
}

async function startupLoop(): Promise<void> {
  let keycloakReady = false;
  let killbillReady = false;
  let seedDone = false;
  while (!(keycloakReady && killbillReady && seedDone)) {
    if (!keycloakReady) {
      try {
        await keycloak.ensureRoles();
        keycloakReady = true;
      } catch {
        await sleep(10_000);
        continue;
      }
    }
    if (!killbillReady) {
      try {
        await killbill.ensureCatalog();
        await killbill.ensureOverdueConfig();
        killbillReady = true;
      } catch {
        await sleep(10_000);
        continue;
      }
    }
    if (!seedDone) {
      try {
        await applySeed(pool, config, keycloak, killbill, killbillReady && keycloakReady);
        seedDone = true;
      } catch {
        await sleep(10_000);
        continue;
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

start().catch((err) => {
  console.error('failed to start', err);
  process.exit(1);
});
