import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadConfig, type Config } from './config.js';
import { createDb, type Db } from './db.js';
import { applySchema } from './migrate.js';
import { runSeed } from './seed.js';
import { Router } from './router.js';
import { ApiError, errors } from './errors.js';
import { MAX_BODY_BYTES, parseCookies, sendEmpty, sendError, sendJson, setCookie, type Ctx } from './http.js';
import { logger } from './logger.js';
import { MatchService } from './matches.js';
import { PresenceRegistry } from './presence.js';
import { createMailPort, type MailPort } from './mail.js';
import { createKillBillPort, type KillBillPort } from './killbill.js';
import * as auth from './auth.js';
import { requirePlayerId } from './auth.js';
import * as shop from './shop.js';
import * as friends from './friends.js';
import * as clubs from './clubs.js';
import * as tournaments from './tournaments.js';
import * as grading from './grading.js';
import { copy } from './copy.js';
import { verifyPassword } from './password.js';
import { ledgerLines, rowToLine, walletBalance } from './ledger.js';
import type { Mode, PocketName } from '../shared/types.js';
import { POCKET_NAMES } from '../shared/game.js';
import { sweepTournaments } from './tournaments.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

interface SseState {
  res: ServerResponse;
  playerId: string | null;
  topics: Set<string>;
  closed: boolean;
}

const sseClients = new Map<string, SseState>();

export async function createApp(override?: Partial<Config>): Promise<{ server: ReturnType<typeof createServer>; start: () => Promise<void>; close: () => Promise<void> }> {
  const config = { ...loadConfig(), ...override };
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 20,
    connectionTimeoutMillis: 5_000,
  });
  pg.types.setTypeParser(20, (value: string) => Number(value)); // bigint balances as JSON numbers
  pool.on('error', (err) => logger.error('pg pool error', err));
  const db: Db = createDb(pool);
  const presence = new PresenceRegistry();
  const mail: MailPort = await createMailPort(config, db);
  const killbill: KillBillPort = createKillBillPort(config);

  const authDeps: auth.AuthDeps = {
    db,
    config,
    mail,
    onMeChange: (playerId) => {
      for (const state of sseClients.values()) {
        if (state.playerId === playerId) writeSse(state, { type: 'me' });
      }
    },
  };
  const matches = new MatchService(db, config, {
    onTableChange: (tableId) => {
      for (const state of sseClients.values()) {
        if (state.topics.has(`table:${tableId}`)) writeSse(state, { type: 'table', tableId });
      }
    },
    onMeChange: authDeps.onMeChange,
    onTournamentChange: (tournamentId) => {
      for (const state of sseClients.values()) {
        if (state.topics.has(`tournament:${tournamentId}`)) writeSse(state, { type: 'tournament', tournamentId });
      }
    },
    clockTick: () => undefined,
  });
  const friendsDeps: friends.FriendsDeps = {
    db,
    presence,
    matches,
    onFriendsChange: (playerId) => {
      for (const state of sseClients.values()) {
        if (state.playerId === playerId) writeSse(state, { type: 'friends' });
      }
    },
  };
  const shopDeps: shop.ShopDeps = { db, config, killbill, mail, onMeChange: authDeps.onMeChange };
  const clubDeps: clubs.ClubDeps = {
    db,
    onClubChange: (clubId, playerIds) => {
      for (const state of sseClients.values()) {
        if (state.topics.has(`club:${clubId}`) || (state.playerId && playerIds.includes(state.playerId))) {
          writeSse(state, { type: 'club', clubId });
        }
      }
    },
    onMeChange: authDeps.onMeChange,
  };
  const tournamentDeps: tournaments.TournamentDeps = {
    db,
    onTournamentChange: (tournamentId, playerIds) => {
      for (const state of sseClients.values()) {
        if (state.topics.has(`tournament:${tournamentId}`) || (state.playerId && playerIds.includes(state.playerId))) {
          writeSse(state, { type: 'tournament', tournamentId });
        }
      }
    },
    onMeChange: authDeps.onMeChange,
  };
  const gradingDeps: grading.GradingDeps = { db, matches, onMeChange: authDeps.onMeChange };

  const router = new Router();

  // Health
  router.get('/api/health', async (ctx) => {
    const status = await healthStatus(db, killbill, config);
    sendJson(ctx, 200, status);
  });

  // Auth
  router.post('/api/auth/signup', (ctx) => withStore(ctx, () => auth.signup(authDeps, ctx)));
  router.post('/api/auth/signin', (ctx) => withStore(ctx, () => auth.signin(authDeps, ctx)));
  router.post('/api/auth/signout', (ctx) => withStore(ctx, () => auth.signout(authDeps, ctx)));
  router.post('/api/auth/resend-verification', (ctx) => withStore(ctx, () => auth.resendVerification(authDeps, ctx)));
  router.post('/api/auth/verify', (ctx) => withStore(ctx, () => auth.verify(authDeps, ctx)));

  // Me and wallet
  router.get('/api/me', (ctx) => withStore(ctx, async () => {
    const body = await meFor(ctx);
    sendJson(ctx, 200, body);
  }));
  router.patch('/api/me/settings', (ctx) => withStore(ctx, () => patchSettings(db, ctx)));
  router.delete('/api/me', (ctx) => withStore(ctx, () => deleteAccount(db, ctx)));
  router.post('/api/wallet/daily-reward', (ctx) => withStore(ctx, () => auth.claimDaily(authDeps, ctx)));
  router.post('/api/wallet/refill', (ctx) => withStore(ctx, () => auth.refill(authDeps, ctx)));
  router.get('/api/wallet/ledger', (ctx) => withStore(ctx, () => walletLedger(db, ctx)));

  // Play
  router.post('/api/queue', (ctx) => withStore(ctx, () => joinQueueRoute(matches, db, ctx)));
  router.get('/api/queue', (ctx) => withStore(ctx, () => queueRoute(matches, db, ctx)));
  router.delete('/api/queue', (ctx) => withStore(ctx, () => cancelQueueRoute(matches, db, ctx)));
  router.get('/api/tables/{id}', (ctx) => withStore(ctx, () => tableRoute(matches, db, ctx)));
  router.post('/api/tables/{id}/shots', (ctx) => withStore(ctx, () => shotRoute(matches, db, ctx)));
  router.post('/api/tables/{id}/place', (ctx) => withStore(ctx, () => placeRoute(matches, db, ctx)));
  router.post('/api/tables/{id}/rematch', (ctx) => withStore(ctx, () => rematchRoute(matches, db, ctx)));
  router.get('/api/tables/{id}/heartbeat', (ctx) => withStore(ctx, () => heartbeatRoute(matches, db, ctx)));
  router.get('/api/matches/{id}/ledger', (ctx) => withStore(ctx, () => matchLedgerRoute(matches, db, ctx)));

  // Shop
  router.get('/api/shop', (ctx) => withStore(ctx, () => shop.getShop(shopDeps, ctx)));
  router.post('/api/shop/items/{id}/buy', (ctx) => withStore(ctx, () => shop.buyItem(shopDeps, ctx, ctx.params.id)));
  router.post('/api/shop/items/{id}/equip', (ctx) => withStore(ctx, () => shop.equipItem(shopDeps, ctx, ctx.params.id)));
  router.post('/api/shop/cash-packs/{id}/purchase', (ctx) => withStore(ctx, () => shop.purchasePack(shopDeps, ctx, ctx.params.id)));

  // Friends and invites
  router.get('/api/friends', (ctx) => withStore(ctx, () => friends.getFriends(friendsDeps, ctx)));
  router.post('/api/friends/requests', (ctx) => withStore(ctx, () => friends.sendRequest(friendsDeps, ctx)));
  router.post('/api/friends/requests/{id}/accept', (ctx) => withStore(ctx, () => friends.acceptRequest(friendsDeps, ctx, ctx.params.id)));
  router.post('/api/friends/requests/{id}/decline', (ctx) => withStore(ctx, () => friends.declineRequest(friendsDeps, ctx, ctx.params.id)));
  router.post('/api/friends/{playerId}/block', (ctx) => withStore(ctx, () => friends.blockPlayer(friendsDeps, ctx, ctx.params.playerId)));
  router.delete('/api/friends/{playerId}/block', (ctx) => withStore(ctx, () => friends.unblockPlayer(friendsDeps, ctx, ctx.params.playerId)));
  router.post('/api/private-tables', (ctx) => withStore(ctx, () => friends.createPrivateTable(friendsDeps, ctx)));
  router.get('/api/invites/{token}', (ctx) => withStore(ctx, () => friends.getInvite(friendsDeps, ctx, ctx.params.token)));
  router.post('/api/invites/{token}/accept', (ctx) => withStore(ctx, () => friends.acceptInvite(friendsDeps, ctx, ctx.params.token)));

  // Clubs and leaderboards
  router.get('/api/clubs', (ctx) => withStore(ctx, () => clubs.listClubs(clubDeps, ctx)));
  router.post('/api/clubs', (ctx) => withStore(ctx, () => clubs.createClub(clubDeps, ctx)));
  router.get('/api/clubs/{id}', (ctx) => withStore(ctx, () => clubs.getClub(clubDeps, ctx, ctx.params.id)));
  router.post('/api/clubs/{id}/join', (ctx) => withStore(ctx, () => clubs.joinClub(clubDeps, ctx, ctx.params.id)));
  router.post('/api/clubs/{id}/leave', (ctx) => withStore(ctx, () => clubs.leaveClub(clubDeps, ctx, ctx.params.id)));
  router.post('/api/clubs/{id}/requests/{playerId}', (ctx) => withStore(ctx, () => clubs.decideRequest(clubDeps, ctx, ctx.params.id, ctx.params.playerId)));
  router.patch('/api/clubs/{id}/members/{playerId}', (ctx) => withStore(ctx, () => clubs.changeRole(clubDeps, ctx, ctx.params.id, ctx.params.playerId)));
  router.post('/api/clubs/{id}/messages', (ctx) => withStore(ctx, () => clubs.sendClubMessage(clubDeps, ctx, ctx.params.id)));
  router.get('/api/leaderboards', (ctx) => withStore(ctx, () => clubs.leaderboard(clubDeps, ctx)));

  // Tournaments
  router.get('/api/tournaments', (ctx) => withStore(ctx, () => tournaments.listTournaments(tournamentDeps, ctx)));
  router.get('/api/tournaments/{id}', (ctx) => withStore(ctx, () => tournaments.getTournament(tournamentDeps, ctx, ctx.params.id)));
  router.post('/api/tournaments/{id}/register', (ctx) => withStore(ctx, () => tournaments.register(tournamentDeps, ctx, ctx.params.id)));
  router.post('/api/tournaments/{id}/ready', (ctx) => withStore(ctx, () => tournaments.ready(tournamentDeps, ctx, ctx.params.id)));

  // Grading
  if (config.gradingKey) {
    router.post('/api/grading/players', (ctx) => guardGrading(ctx, config.gradingKey, () => withStore(ctx, () => grading.createGradingPlayer(gradingDeps, ctx))));
    router.patch('/api/grading/players/{id}', (ctx) => guardGrading(ctx, config.gradingKey, () => withStore(ctx, () => grading.patchGradingPlayer(gradingDeps, ctx, ctx.params.id))));
    router.post('/api/grading/tables', (ctx) => guardGrading(ctx, config.gradingKey, () => withStore(ctx, () => grading.createGradingTable(gradingDeps, ctx))));
  }

  // Live events; topics arrive as repeat query parameters.
  router.get('/api/events', async (ctx) => {
    const sessionId = ctx.cookies['hs_session'];
    let playerId: string | null = null;
    if (sessionId) {
      const res = await db.query<{ player_id: string }>(`SELECT player_id FROM sessions WHERE id = $1`, [sessionId]);
      playerId = res.rows[0]?.player_id ?? null;
    }
    const topics = ctx.search.getAll('topic');
    openSse(ctx, playerId, topics);
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const ctx: Ctx = {
      req,
      res,
      method: req.method ?? 'GET',
      path: url.pathname,
      pathname: url.pathname,
      search: url.searchParams,
      params: {},
      cookies: parseCookies(req.headers.cookie),
      origin: req.headers.origin ?? null,
      host: req.headers.host ?? null,
      body: undefined,
      rawBody: Buffer.alloc(0),
      ip: req.socket.remoteAddress ?? '',
      cookieOut: null,
      statusOut: 200,
      headersOut: {},
    };

    try {
      if (ctx.pathname.startsWith('/api/')) {
        await handleApi(ctx, router, config, db);
        return;
      }
      await serveStatic(ctx);
    } catch (err) {
      handleError(ctx, err);
    }
  });

  async function start(): Promise<void> {
    try {
      await applySchema(db);
      await runSeed(db);
      logger.info('schema applied and seed data ready');
    } catch (err) {
      logger.warn(`postgres is unreachable at boot: ${(err as Error).message}`);
    }
    await new Promise<void>((resolve) => server.listen(config.port, '0.0.0.0', resolve));
    logger.info(`listening on 0.0.0.0:${config.port}`);

    const clock = setInterval(() => {
      for (const state of sseClients.values()) writeSse(state, { type: 'tick' });
      void sweepTournaments(tournamentDeps);
      void matchSweeps();
      void mail.deliverPending().catch(() => undefined);
    }, 1_000);
    clock.unref();
  }

  async function matchSweeps(): Promise<void> {
    // Expired turns become fouls; both dropped too long voids the match.
    try {
      const res = await db.query<{ id: string; active_seat: 1 | 2; turn_started_at: Date; shot_clock_seconds: number; seat1_dropped_since: Date | null; seat2_dropped_since: Date | null }>(
        `SELECT id, active_seat, turn_started_at, shot_clock_seconds, seat1_dropped_since, seat2_dropped_since
         FROM matches WHERE status = 'in_play'`
      );
      for (const row of res.rows) {
        const expired = (Date.now() - row.turn_started_at.getTime()) / 1000 > row.shot_clock_seconds;
        if (expired) {
          await matches.expireTurn(row.id, row.active_seat);
        }
        const dropped1 = row.seat1_dropped_since !== null && (Date.now() - new Date(row.seat1_dropped_since).getTime()) / 1000 > config.reconnectGraceSeconds;
        const dropped2 = row.seat2_dropped_since !== null && (Date.now() - new Date(row.seat2_dropped_since).getTime()) / 1000 > config.reconnectGraceSeconds;
        if (dropped1 && dropped2) {
          await matches.voidExpired(row.id);
        }
      }
      // Any terminal match with open escrow is settled or voided exactly once, and
      // tournament rounds advance when all their matches have a winner.
      await matches.closeOpenEscrow();
      await tournaments.sweepBrackets(tournamentDeps);
    } catch (err) {
      logger.warn(`match sweep failed: ${(err as Error).message}`);
    }
  }

  function close(): Promise<void> {
    return new Promise((resolve) => {
      server.close(() => resolve());
      pool.end().catch(() => undefined);
    });
  }

  return { server, start, close };
}

function openSse(ctx: Ctx, playerId: string | null, topics: string[]): void {
  const id = `sse_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  ctx.res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const state: SseState = { res: ctx.res, playerId, topics: new Set(topics), closed: false };
  sseClients.set(id, state);
  ctx.res.write(`retry: 1000\n\n`);
  ctx.res.on('close', () => {
    state.closed = true;
    sseClients.delete(id);
  });
}

function writeSse(state: SseState, event: Record<string, unknown>): void {
  if (state.closed) return;
  try {
    state.res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch {
    state.closed = true;
  }
}

import { createConnection } from 'node:net';

async function probeSmtp(host: string, port: number, timeoutMs = 3_000): Promise<boolean> {
  if (!host) return false;
  return new Promise((resolve) => {
    let settled = false;
    const socket = createConnection({ host, port });
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
  });
}

let healthCache: { at: number; body: Record<string, string> } | null = null;
async function healthStatus(db: Db, killbill: KillBillPort, config: Config): Promise<Record<string, string>> {
  if (healthCache && Date.now() - healthCache.at < 5_000) return healthCache.body;
  let ok = true;
  try {
    await db.query('SELECT 1');
  } catch {
    ok = false;
  }
  if (ok) {
    const reach = await killbill.reachable();
    if (!reach) ok = false;
  }
  if (ok) {
    const smtpOk = await probeSmtp(config.smtpHost, config.smtpPort);
    if (!smtpOk) ok = false;
  }
  const body = ok ? { status: 'ok' } : { status: 'unavailable' };
  healthCache = { at: Date.now(), body };
  return body;
}

async function handleApi(ctx: Ctx, router: Router, config: Config, db: Db): Promise<void> {
  if (!isSameOrigin(ctx)) throw errors.crossOrigin();

  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(ctx.method)) {
    await readBody(ctx);
    if (ctx.rawBody.length > 0 && !ctx.req.headers['content-type']?.startsWith('application/json')) {
      throw errors.unsupportedMediaType();
    }
    if (ctx.rawBody.length > 0) {
      try {
        ctx.body = JSON.parse(ctx.rawBody.toString('utf8'));
      } catch {
        throw errors.malformedJson();
      }
    }
  }

  const found = router.match(ctx.method, ctx.pathname);
  if (!found) throw errors.notFound();
  ctx.params = found.params;
  await found.handler(ctx);
  void db;
  void config;
}

async function readBody(ctx: Ctx, ignore = false): Promise<void> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of ctx.req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw errors.payloadTooLarge();
    }
    chunks.push(buf);
  }
  if (!ignore) ctx.rawBody = Buffer.concat(chunks);
}

function isSameOrigin(ctx: Ctx): boolean {
  const origin = ctx.origin;
  if (!origin) return true;
  const host = ctx.host ?? '';
  try {
    const parsed = new URL(origin);
    return parsed.host === host;
  } catch {
    return false;
  }
}

async function serveStatic(ctx: Ctx): Promise<void> {
  let pathname = ctx.pathname;
  if (pathname === '/') pathname = '/index.html';
  const target = normalize(join(PUBLIC_DIR, pathname));
  if (!target.startsWith(PUBLIC_DIR)) throw errors.notFound();
  if (isBlockedPath(pathname)) throw errors.notFound();
  let content: Buffer;
  try {
    content = await readFile(target);
  } catch {
    // SPA fallback: unknown paths render the shell.
    content = await readFile(join(PUBLIC_DIR, 'index.html'));
  }
  const type = MIME[extname(target)] ?? 'application/octet-stream';
  ctx.res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  ctx.res.end(content);
}

function isBlockedPath(pathname: string): boolean {
  const base = pathname.split('/').pop() ?? '';
  const blocked = [
    'package.json', 'package-lock.json', 'tsconfig.json', 'run.json', 'THIRD_PARTY_NOTICES.md',
    '.env', '.npmrc', 'npm-debug.log', 'schema.sql',
  ];
  if (blocked.includes(base)) return true;
  if (/\.(ts|tsx|sql|env)$/.test(base)) return true;
  return false;
}

function handleError(ctx: Ctx, err: unknown): void {
  if (err instanceof ApiError) {
    sendError(ctx, err);
    return;
  }
  const message = (err as Error).message ?? '';
  if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND') || message.includes('ETIMEDOUT') || message.includes('connect ECONNREFUSED')) {
    sendError(ctx, errors.storeUnavailable());
    return;
  }
  logger.error('unhandled error', err);
  if (!ctx.res.headersSent) {
    sendError(ctx, new ApiError(500, 'not_found', 'Something went wrong.'));
  } else {
    ctx.res.end();
  }
}

async function withStore(ctx: Ctx, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const message = (err as Error).message ?? '';
    if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND') || message.includes('ETIMEDOUT') || message.includes('Connection terminated') || message.includes('connection refused')) {
      throw errors.storeUnavailable();
    }
    throw err;
  }
}

async function meFor(ctx: Ctx): Promise<Record<string, unknown>> {
  const db = createAppDb();
  const playerId = await auth.requirePlayerId(db, ctx);
  const client = await db.pool.connect();
  try {
    const res = await client.query(
      `SELECT * FROM players WHERE id = $1 AND deleted_at IS NULL`, [playerId]
    );
    const row = res.rows[0];
    if (!row) throw errors.unauthenticated();
    const body = auth.fullMe(row);
    const pending = await client.query(`SELECT 1 FROM mail_outbox WHERE player_id = $1 AND status = 'pending' LIMIT 1`, [playerId]);
    const activeTable = await client.query<{ id: string }>(
      `SELECT id FROM matches WHERE status IN ('paired','in_play') AND (seat1_player = $1 OR seat2_player = $1) LIMIT 1`, [playerId]
    );
    body.mailDelayed = (pending.rowCount ?? 0) > 0;
    body.activeTableUrl = activeTable.rows[0]?.id ? `/table/${activeTable.rows[0].id}` : null;
    return body;
  } finally {
    client.release();
  }
}

let appDb: Db | null = null;
function createAppDb(): Db {
  return getAppDb();
}

function getAppDb(): Db {
  if (!appDb) throw new Error('database not initialised');
  return appDb;
}

export function bindDb(db: Db): void {
  appDb = db;
}

async function patchSettings(db: Db, ctx: Ctx): Promise<void> {
  const playerId = await requirePlayerId(db, ctx);
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const allowed = ['sound', 'music', 'aimSensitivity', 'leftHanded', 'reducedMotion', 'theme'];
  const fields: Record<string, string> = {};
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) fields[key] = 'Not accepted.';
  }
  if (typeof body.aimSensitivity === 'number' && (body.aimSensitivity < 1 || body.aimSensitivity > 10)) {
    fields.aimSensitivity = 'Choose between 1 and 10.';
  }
  if (typeof body.theme === 'string' && !['light', 'dark', 'system'].includes(body.theme)) {
    fields.theme = 'Choose Light, Dark or System.';
  }
  if (Object.keys(fields).length > 0) throw errors.validation(fields);
  const res = await db.query<{ settings: Record<string, unknown> }>(`SELECT settings FROM players WHERE id = $1`, [playerId]);
  const settings = { ...(res.rows[0]?.settings ?? {}) };
  for (const key of allowed) {
    if (body[key] !== undefined) settings[key] = body[key];
  }
  await db.query(`UPDATE players SET settings = $2::jsonb WHERE id = $1`, [playerId, JSON.stringify(settings)]);
  sendJson(ctx, 200, settings);
}

async function deleteAccount(db: Db, ctx: Ctx): Promise<void> {
  const playerId = await requirePlayerId(db, ctx);
  const body = (ctx.body ?? {}) as { password?: string };
  const res = await db.query<{ password_hash: string }>(`SELECT password_hash FROM players WHERE id = $1 AND deleted_at IS NULL`, [playerId]);
  const row = res.rows[0];
  if (!row) throw errors.unauthenticated();
  if (!verifyPassword(body.password ?? '', row.password_hash)) {
    throw new ApiError(403, 'invalid_credentials', copy.badSignIn);
  }
  await db.tx(async (client) => {
    const live = (await client.query(
      `SELECT 1 FROM matches WHERE status IN ('paired','in_play') AND (seat1_player = $1 OR seat2_player = $1) LIMIT 1`, [playerId]
    )).rowCount ?? 0;
    if (live > 0) throw new ApiError(409, 'in_match', 'Finish your match first.');
    const queued = (await client.query(`SELECT 1 FROM queue_tickets WHERE player_id = $1 AND status = 'queued'`, [playerId])).rowCount ?? 0;
    if (queued > 0) throw new ApiError(409, 'in_match', 'Leave the queue first.');
    const club = (await client.query<{ club_id: string; role: string }>(`SELECT club_id, role FROM club_members WHERE player_id = $1`, [playerId])).rows[0];
    if (club) {
      if (club.role === 'owner') {
        const heir = (await client.query<{ player_id: string }>(
          `SELECT player_id FROM club_members WHERE club_id = $1 AND player_id <> $2 ORDER BY joined_at LIMIT 1`, [club.club_id, playerId]
        )).rows[0];
        if (heir) {
          await client.query(`UPDATE club_members SET role = 'owner' WHERE club_id = $1 AND player_id = $2`, [club.club_id, heir.player_id]);
          await client.query(`UPDATE clubs SET owner_id = $2 WHERE id = $1`, [club.club_id, heir.player_id]);
        } else {
          await client.query(`DELETE FROM clubs WHERE id = $1`, [club.club_id]);
        }
      }
      await client.query(`DELETE FROM club_members WHERE player_id = $1`, [playerId]);
    }
    await client.query(`UPDATE players SET display_name = 'Player', email = 'deleted+' || $2 || '@longrail.internal', deleted_at = now(), password_hash = '-' WHERE id = $1`, [playerId, playerId]);
    await client.query(`DELETE FROM sessions WHERE player_id = $1`, [playerId]);
  });
  setCookie(ctx, 'hs_session', '', { HttpOnly: '', SameSite: 'Lax', Path: '/', 'Max-Age': '0' });
  sendEmpty(ctx, 204);
}

async function walletLedger(db: Db, ctx: Ctx): Promise<void> {
  const playerId = await requirePlayerId(db, ctx);
  const currency = ctx.search.get('currency');
  if (currency !== 'coins' && currency !== 'cash') {
    throw errors.validation({ currency: 'Choose coins or cash.' });
  }
  const balance = await walletBalance(db, playerId, currency);
  const client = await db.pool.connect();
  try {
    const lines = await ledgerLines(client, playerId, currency);
    sendJson(ctx, 200, { balance, lines });
  } finally {
    client.release();
  }
}

async function joinQueueRoute(matches: MatchService, db: Db, ctx: Ctx): Promise<void> {
  const playerId = await requirePlayerId(db, ctx);
  const sessionId = ctx.cookies['hs_session'];
  if (!sessionId) throw errors.unauthenticated();
  const body = (ctx.body ?? {}) as { mode?: string; tier?: number };
  const mode: Mode = body.mode === 'nine-ball' ? 'nine-ball' : body.mode === 'no-guidelines' ? 'no-guidelines' : 'eight-ball';
  if (body.mode !== undefined && !['eight-ball', 'nine-ball', 'no-guidelines'].includes(body.mode)) {
    throw errors.validation({ mode: 'Choose a supported mode.' });
  }
  if (typeof body.tier !== 'number' || !Number.isInteger(body.tier) || body.tier < 1 || body.tier > 5) {
    throw errors.validation({ tier: 'Choose a tier from 1 to 5.' });
  }
  const result = await matches.joinQueue(playerId, mode, body.tier, sessionId);
  sendJson(ctx, 201, { ticketId: result.ticketId, status: 'queued' });
}

async function queueRoute(matches: MatchService, db: Db, ctx: Ctx): Promise<void> {
  const playerId = await requirePlayerId(db, ctx);
  const status = await matches.queueStatus(playerId);
  sendJson(ctx, 200, status);
}

async function cancelQueueRoute(matches: MatchService, db: Db, ctx: Ctx): Promise<void> {
  const playerId = await requirePlayerId(db, ctx);
  const result = await matches.cancelQueue(playerId);
  sendJson(ctx, 200, result);
}

async function tableRoute(matches: MatchService, db: Db, ctx: Ctx): Promise<void> {
  const sessionId = ctx.cookies['hs_session'] ?? null;
  let playerId: string | null = null;
  if (sessionId) {
    const res = await db.query<{ player_id: string }>(`SELECT player_id FROM sessions WHERE id = $1`, [sessionId]);
    playerId = res.rows[0]?.player_id ?? null;
  }
  const row = await matches.loadMatchNoLock(ctx.params.id);
  if (!row) throw errors.notFound();
  if (!playerId || (row.seat1_player !== playerId && row.seat2_player !== playerId)) {
    throw new ApiError(403, 'not_seated', copy.tableNotYours);
  }
  // Take an unclaimed seat for this player (grading and tournament tables).
  const seated = await matches.claimSeatIfNeeded(ctx.params.id, playerId, sessionId);
  const fresh = await matches.loadMatchNoLock(ctx.params.id);
  if (!fresh) throw errors.notFound();
  const body = await matches.tableBody(seated ?? sessionId, fresh);
  sendJson(ctx, 200, body);
}

async function shotRoute(matches: MatchService, db: Db, ctx: Ctx): Promise<void> {
  const sessionId = ctx.cookies['hs_session'];
  if (!sessionId) throw errors.unauthenticated();
  const raw = (ctx.body ?? {}) as Record<string, unknown>;
  const allowed = new Set(['aimDegrees', 'power', 'sideSpin', 'topSpin', 'calledPocket']);
  const fields: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) fields[key] = 'Not accepted.';
  }
  if (typeof raw.aimDegrees !== 'number' || raw.aimDegrees < 0 || raw.aimDegrees >= 360) fields.aimDegrees = 'Aim must be from 0.0 to 359.9 degrees.';
  if (typeof raw.power !== 'number' || raw.power < 0 || raw.power > 100 || !Number.isInteger(raw.power)) fields.power = 'Power must be a whole number from 0 to 100.';
  if (typeof raw.sideSpin !== 'number' || raw.sideSpin < -100 || raw.sideSpin > 100) fields.sideSpin = 'Side spin must be from -100 to 100.';
  if (typeof raw.topSpin !== 'number' || raw.topSpin < -100 || raw.topSpin > 100) fields.topSpin = 'Top spin must be from -100 to 100.';
  if (raw.calledPocket !== null && raw.calledPocket !== undefined && !POCKET_NAMES.includes(raw.calledPocket as PocketName)) {
    fields.calledPocket = 'Choose a pocket.';
  }
  if (Object.keys(fields).length > 0) throw errors.validation(fields);
  const body = {
    aimDegrees: raw.aimDegrees as number,
    power: raw.power as number,
    sideSpin: raw.sideSpin as number,
    topSpin: raw.topSpin as number,
    calledPocket: (raw.calledPocket as PocketName | null) ?? null,
  };
  const result = await matches.takeShot(ctx.params.id, sessionId, body);
  sendJson(ctx, 200, result);
}

async function placeRoute(matches: MatchService, db: Db, ctx: Ctx): Promise<void> {
  const sessionId = ctx.cookies['hs_session'];
  if (!sessionId) throw errors.unauthenticated();
  const raw = (ctx.body ?? {}) as Record<string, unknown>;
  const allowed = new Set(['across', 'along']);
  const fields: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) fields[key] = 'Not accepted.';
  }
  if (typeof raw.across !== 'number' || raw.across < 0 || raw.across > 100) fields.across = 'Across must be from 0 to 100.';
  if (typeof raw.along !== 'number' || raw.along < 0 || raw.along > 100) fields.along = 'Along must be from 0 to 100.';
  if (Object.keys(fields).length > 0) throw errors.validation(fields);
  const result = await matches.placeBall(ctx.params.id, sessionId, raw.across as number, raw.along as number);
  sendJson(ctx, 200, result);
}

async function rematchRoute(matches: MatchService, db: Db, ctx: Ctx): Promise<void> {
  const playerId = await requirePlayerId(db, ctx);
  const sessionId = ctx.cookies['hs_session'];
  if (!sessionId) throw errors.unauthenticated();
  const result = await matches.rematch(ctx.params.id, playerId, sessionId);
  if (result.status === 'waiting') sendJson(ctx, 202, result);
  else sendJson(ctx, 201, result);
}

async function heartbeatRoute(matches: MatchService, db: Db, ctx: Ctx): Promise<void> {
  const sessionId = ctx.cookies['hs_session'];
  if (sessionId) await matches.heartbeat(ctx.params.id, sessionId);
  const fresh = await matches.loadMatchNoLock(ctx.params.id);
  if (!fresh) throw errors.notFound();
  const body = await matches.tableBody(sessionId, fresh);
  sendJson(ctx, 200, body);
}

async function matchLedgerRoute(matches: MatchService, db: Db, ctx: Ctx): Promise<void> {
  const playerId = await requirePlayerId(db, ctx);
  const row = await matches.loadMatchNoLock(ctx.params.id);
  if (!row) throw errors.notFound();
  if (row.seat1_player !== playerId && row.seat2_player !== playerId) {
    throw new ApiError(403, 'not_seated', copy.tableNotYours);
  }
  const res = await db.query(
    `SELECT id, pair_id AS "pairId", player_id AS "playerId", currency, account, amount, kind, ref_id AS "refId", created_at AS "createdAt"
     FROM ledger_lines WHERE ref_id = $1 ORDER BY created_at ASC, id ASC`,
    [ctx.params.id]
  );
  sendJson(ctx, 200, { lines: res.rows.map(rowToLine) });
}

function guardGrading(ctx: Ctx, key: string | null, next: () => Promise<void>): Promise<void> {
  if (!key || ctx.req.headers['x-grading-key'] !== key) {
    return Promise.reject(errors.notFound());
  }
  return next();
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  bootstrapDb();
}

async function bootstrapDb(): Promise<void> {
  const config = loadConfig();
  pg.types.setTypeParser(20, (value: string) => Number(value)); // bigint balances as JSON numbers
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, connectionTimeoutMillis: 5_000 });
  pool.on('error', (err) => logger.error('pg pool error', err));
  const db = createDb(pool);
  bindDb(db);
  const app = await createApp();
  await app.start();
}
