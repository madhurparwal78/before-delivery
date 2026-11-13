import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createServer } from 'node:http';
import { loadConfig, type Config } from './config.js';
import { now, setGradingClock } from './clock.js';
import { applySchema, createPostgres, type PostgresService } from './postgres.js';
import { createValkey, type ValkeyService } from './valkey.js';
import { createMail, type MailService } from './mail.js';
import { ApiError, readSessionCookie, sendError, sendJson } from './errors.js';
import { clearedSessionCookie, sessionCookie } from './auth.js';
import { PlayerService } from './players.js';
import { GameService } from './games.js';
import { FinishService } from './finish.js';
import { DailyService } from './daily.js';
import { LeaderboardService } from './leaderboard.js';
import { ProfileService } from './profile.js';
import { installRooms, type RoomRuntime } from './rooms.js';
import { createHub } from './wshub.js';
import { isMonthString, isValidYmd } from '../shared/daily.js';
import { isLevel, type Level } from '../shared/puzzles.js';
import { score } from '../shared/score.js';
import type { LeaderboardRow } from '../shared/api.js';

// One TypeScript Node server: HTTP, the built client and /ws share the one
// port. Same-origin requests only, with the published body limits.

const BODY_LIMIT = 1000000;

export function todayInTz(cfg: Config): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: cfg.dailyTz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now());
}

export function dateInTz(cfg: Config, instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: cfg.dailyTz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > BODY_LIMIT) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Payload too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin.length === 0) return true;
  const host = req.headers.host;
  if (!host) return false;
  return origin === `http://${host}` || origin === `https://${host}`;
}

export function requestOrigin(req: IncomingMessage): string {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.length > 0) return origin;
  const host = req.headers.host ?? 'localhost';
  const proto = typeof req.headers['x-forwarded-proto'] === 'string' && req.headers['x-forwarded-proto'].length > 0
    ? (req.headers['x-forwarded-proto'] as string)
    : 'http';
  return `${proto}://${host}`;
}

interface Session {
  token: string;
  player: { player_id: string; email: string; display_name: string; verified: boolean };
}

export interface App {
  cfg: Config;
  db: PostgresService;
  valkey: ValkeyService;
  mail: MailService;
  players: PlayerService;
  games: GameService;
  finish: FinishService;
  daily: DailyService;
  leaderboard: LeaderboardService;
  profile: ProfileService;
  rooms: RoomRuntime;
  postgresDown(): boolean;
  leaderboardFanout: (date: string, latestPlayerId?: string) => Promise<void>;
}

export function createApp(cfg: Config): App {
  const state = { postgres: true, valkey: true, mailpit: true };

  const db = createPostgres({
    databaseUrl: cfg.databaseUrl,
    onStateChange: (down) => {
      state.postgres = down;
    },
  });
  const valkey = createValkey({
    valkeyUrl: cfg.valkeyUrl,
    onDown: (down) => {
      state.valkey = down;
    },
  });
  const mail = createMail({ host: cfg.smtpHost, port: cfg.smtpPort, mailFrom: cfg.mailFrom });

  // The schema is applied idempotently at boot; the server starts and listens
  // even while Postgres is unreachable, retrying every few seconds.
  void applySchema(db).then(() => {
    state.postgres = false;
  }).catch(() => undefined);

  const players = new PlayerService({
    db,
    mail,
    verifyTtlMinutes: cfg.verifyTtlMinutes,
    resetTtlMinutes: cfg.resetTtlMinutes,
  });
  const games = new GameService(db, {
    mistakeLimit: cfg.mistakeLimit,
    hintLimit: cfg.hintLimit,
    moveLimit: cfg.moveLimit,
  });
  const daily = new DailyService({ db, dailyStart: cfg.dailyStart });
  const leaderboard = new LeaderboardService({ db, leaderboardSize: cfg.leaderboardSize });
  const profile = new ProfileService({ db, dailyTz: cfg.dailyTz, dateInTz: (d) => dateInTz(cfg, d) });
  const rooms = installRooms({ db, valkey, cfg });

  // The live leaderboard fanout: every open leaderboard page for the date
  // shows the new ranking within 2 seconds and announces M43.
  const leaderboardFanout = async (date: string, latestPlayerId?: string): Promise<void> => {
    const live = await valkey.healthy();
    if (!live) return;
    const rows = await leaderboard.rows(date);
    let latest: { display_name: string; rank: number } | undefined;
    if (latestPlayerId) {
      const ranked = await leaderboard.latestRank(date, latestPlayerId);
      if (ranked) latest = ranked;
    }
    await valkey.publish('seam:live', JSON.stringify({
      kind: 'leaderboard',
      date,
      rows,
      latest,
    }));
  };

  const finish = new FinishService({
    db,
    limits: { mistakeLimit: cfg.mistakeLimit, hintLimit: cfg.hintLimit, moveLimit: cfg.moveLimit },
    todayInTz: () => todayInTz(cfg),
    onDailyResult: async (playerId, date) => {
      // Only a verified player's on-day result is announced live; an
      // unverified player appears only after confirming their email, so the
      // fanout checks verification first.
      const verified = await db.query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM finished_games f JOIN players p ON p.player_id = f.player_id
         WHERE f.player_id = $1 AND f.daily_date = $2 AND f.daily_state = 'solved' AND p.verified = TRUE`,
        [playerId, date],
      );
      if (Number(verified[0].n) > 0) await leaderboardFanout(date, playerId);
    },
  });

  const app: App = {
    cfg,
    db,
    valkey,
    mail,
    players,
    games,
    finish,
    daily,
    leaderboard,
    profile,
    rooms,
    postgresDown: () => state.postgres,
    leaderboardFanout,
  };
  return app;
}

function parseJson(raw: Buffer): unknown {
  const text = raw.toString('utf8');
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Body is not JSON');
  }
}

export async function handleApi(app: App, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  const origin = req.headers.origin;
  const isStateChange = method !== 'GET' && method !== 'HEAD' || path === '/ws';
  if (isStateChange && typeof origin === 'string' && origin.length > 0 && !sameOrigin(req)) {
    throw new ApiError(403, 'CROSS_ORIGIN', 'Cross-origin requests are refused');
  }

  if (path === '/api/health' && method === 'GET') {
    const [pgOk, vkOk, mailOk] = await Promise.all([
      app.db.healthy(),
      app.valkey.healthy(),
      app.mail.healthy(),
    ]);
    const down: string[] = [];
    if (!pgOk) down.push('postgres');
    if (!vkOk) down.push('valkey');
    if (!mailOk) down.push('mailpit');
    sendJson(res, 200, down.length === 0 ? { status: 'ok' } : { status: 'degraded', down });
    return;
  }

  // While Postgres is unreachable the API answers 503 STORAGE_UNAVAILABLE.
  if (app.postgresDown() && path !== '/api/health') {
    throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'The atelier is out of reach');
  }

  const raw = await readBody(req);
  const body = parseJson(raw);

  const route = pickRoute(path);
  if (!route) {
    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
    return;
  }
  await route(app, req, res, method, path, url, body);
}

type Route = (app: App, req: IncomingMessage, res: ServerResponse, method: string, path: string, url: URL, body: unknown) => Promise<void>;

function pickRoute(path: string): Route | null {
  if (path === '/api/auth/signup') return routeSignup;
  if (path === '/api/auth/signin') return routeSignin;
  if (path === '/api/auth/signout') return routeSignout;
  if (path === '/api/me') return routeMe;
  if (path === '/api/auth/verify/resend') return routeVerifyResend;
  if (path === '/api/auth/verify') return routeVerify;
  if (path === '/api/auth/reset') return routeReset;
  if (path === '/api/auth/reset/confirm') return routeResetConfirm;
  if (path === '/api/games' ) return routeCreateGame;
  if (path === '/api/daily') return routeDaily;
  if (path === '/api/profile') return routeProfile;
  if (path === '/api/duels') return routeCreateDuel;
  if (path === '/api/duels/join') return routeJoinDuel;
  if (path === '/api/grading/players') return routeGradingPlayers;
  if (path === '/api/grading/games') return routeGradingGames;
  if (path === '/api/grading/finished-games') return routeGradingFinished;
  if (path === '/api/grading/daily-results') return routeGradingDaily;
  if (path === '/api/grading/clock') return routeGradingClock;
  if (path.startsWith('/api/games/')) {
    const rest = path.slice('/api/games/'.length);
    if (rest.endsWith('/moves')) return routeSaveMoves;
    if (rest.endsWith('/finish')) return routeFinish;
    return routeGetGame;
  }
  if (path.startsWith('/api/daily/') && path.endsWith('/game')) return routeDailyGame;
  if (path.startsWith('/api/leaderboard/')) return routeLeaderboard;
  if (path.startsWith('/api/duels/')) return routeGetRoom;
  return null;
}

// ------------------------------------------------------------------ helpers

async function sessionOf(app: App, req: IncomingMessage): Promise<Session | null> {
  const token = readSessionCookie(req);
  if (!token) return null;
  const player = await app.players.sessionPlayer(token);
  if (!player) return null;
  return { token, player };
}

async function requireSession(app: App, req: IncomingMessage): Promise<Session> {
  const s = await sessionOf(app, req);
  if (!s) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in first');
  return s;
}

async function requireVerified(app: App, req: IncomingMessage): Promise<Session> {
  const s = await requireSession(app, req);
  if (!s.player.verified) throw new ApiError(403, 'NOT_VERIFIED', 'Confirm your email first');
  return s;
}

function shapeOf(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'MALFORMED', 'Body is not an object');
  }
  return body as Record<string, unknown>;
}

function field(body: unknown, name: string): unknown {
  return shapeOf(body)[name];
}

function strField(body: unknown, name: string): string {
  const v = field(body, name);
  if (typeof v !== 'string') throw new ApiError(400, 'MALFORMED', `Missing ${name}`);
  return v;
}

// ------------------------------------------------------------------- auth

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateSignup(body: unknown): { email: string; displayName: string; password: string } {
  const email = strField(body, 'email');
  const displayName = strField(body, 'display_name');
  const password = strField(body, 'password');
  const fields: Record<string, string> = {};
  if (!EMAIL_RE.test(email)) fields['email'] = 'Enter a valid email address.';
  if (displayName.length < 3 || displayName.length > 20) fields['display_name'] = 'Use 3 to 20 characters.';
  if (password.length < 10) fields['password'] = 'Use at least 10 characters.';
  if (Object.keys(fields).length > 0) throw new ApiError(422, 'VALIDATION', 'Check these details', fields);
  return { email, displayName, password };
}

async function routeSignup(app: App, req: IncomingMessage, res: ServerResponse, method: string, _path: string, _url: URL, body: unknown): Promise<void> {
  if (method !== 'POST') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const { email, displayName, password } = validateSignup(body);
  // If Mailpit cannot be reached the account is still created, but nothing
  // counts as sent.
  const mailUp = await app.mail.healthy();
  const created = await app.players.createPlayer(email, displayName, password, requestOrigin(req), mailUp);
  const session = await app.players.createSession(created.player.player_id);
  sendJson(res, 201, {
    player: app.players.toPlayerShape(created.player),
    verification_sent: created.token !== null,
  }, { 'Set-Cookie': sessionCookie(session) });
}

async function routeSignin(app: App, _req: IncomingMessage, res: ServerResponse, method: string, _path: string, _url: URL, body: unknown): Promise<void> {
  if (method !== 'POST') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const email = strField(body, 'email');
  const password = strField(body, 'password');
  try {
    const { player, session } = await app.players.signIn(email, password);
    sendJson(res, 200, { player: app.players.toPlayerShape(player) }, { 'Set-Cookie': sessionCookie(session) });
  } catch {
    throw new ApiError(401, 'BAD_CREDENTIALS', 'Email or password is incorrect.');
  }
}

async function routeSignout(app: App, req: IncomingMessage, res: ServerResponse, method: string): Promise<void> {
  if (method !== 'POST') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const s = await sessionOf(app, req);
  if (s) await app.players.endSession(s.token);
  res.writeHead(204, { 'Set-Cookie': clearedSessionCookie() });
  res.end();
}

async function routeMe(app: App, req: IncomingMessage, res: ServerResponse, method: string): Promise<void> {
  if (method !== 'GET') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const s = await requireSession(app, req);
  sendJson(res, 200, {
    player: {
      player_id: s.player.player_id,
      email: s.player.email,
      display_name: s.player.display_name,
      verified: s.player.verified,
    },
  });
}

async function routeVerifyResend(app: App, req: IncomingMessage, res: ServerResponse, method: string): Promise<void> {
  if (method !== 'POST') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const s = await requireSession(app, req);
  if (s.player.verified) throw new ApiError(409, 'ALREADY_VERIFIED', 'Already verified');
  const token = await app.players.sendVerification(s.player.player_id, s.player.email, requestOrigin(req));
  if (token === null) throw new ApiError(503, 'MAIL_UNAVAILABLE', 'Mail is unavailable');
  sendJson(res, 202, { sent: true });
}

async function routeVerify(app: App, _req: IncomingMessage, res: ServerResponse, method: string, _path: string, _url: URL, body: unknown): Promise<void> {
  if (method !== 'POST') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const token = strField(body, 'token');
  const outcome = await app.players.verifyToken(token);
  if (outcome === 'not_found') throw new ApiError(404, 'TOKEN_NOT_FOUND', 'This confirmation link isn\'t valid.');
  if (outcome === 'used') throw new ApiError(409, 'TOKEN_USED', 'This confirmation link was already used.');
  if (outcome === 'expired') throw new ApiError(410, 'TOKEN_EXPIRED', 'This confirmation link has expired.');
  const player = await app.players.playerOfToken(token);
  sendJson(res, 200, { player: { display_name: player?.display_name ?? '', verified: true } });
}

async function routeReset(app: App, req: IncomingMessage, res: ServerResponse, method: string, _path: string, _url: URL, body: unknown): Promise<void> {
  if (method !== 'POST') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const email = strField(body, 'email');
  if (!EMAIL_RE.test(email)) throw new ApiError(422, 'VALIDATION', 'Check these details', { email: 'Enter a valid email address.' });
  // If Mailpit cannot be reached, the server answers MAIL_UNAVAILABLE
  // before looking up the email.
  const mailUp = await app.mail.healthy();
  if (!mailUp) throw new ApiError(503, 'MAIL_UNAVAILABLE', 'Mail is unavailable');
  // The request always answers the same whether or not the account exists.
  await app.players.requestReset(email, requestOrigin(req));
  sendJson(res, 202, { sent: true });
}

async function routeResetConfirm(app: App, _req: IncomingMessage, res: ServerResponse, method: string, _path: string, _url: URL, body: unknown): Promise<void> {
  if (method !== 'POST') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const token = strField(body, 'token');
  const password = strField(body, 'password');
  if (password.length < 10) throw new ApiError(422, 'VALIDATION', 'Check these details', { password: 'Use at least 10 characters.' });
  const outcome = await app.players.resetPassword(token, password);
  if (outcome === 'not_found') throw new ApiError(404, 'TOKEN_NOT_FOUND', 'This reset link isn\'t valid.');
  if (outcome === 'used') throw new ApiError(409, 'TOKEN_USED', 'This reset link was already used.');
  if (outcome === 'expired') throw new ApiError(410, 'TOKEN_EXPIRED', 'This reset link has expired.');
  const { player, session } = outcome;
  sendJson(res, 200, { player: app.players.toPlayerShape(player) }, { 'Set-Cookie': sessionCookie(session) });
}

// ------------------------------------------------------------------ games

async function routeCreateGame(app: App, req: IncomingMessage, res: ServerResponse, method: string, _path: string, _url: URL, body: unknown): Promise<void> {
  if (method !== 'POST') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const s = await requireSession(app, req);
  const levelRaw = strField(body, 'level');
  if (!isLevel(levelRaw)) throw new ApiError(422, 'VALIDATION', 'Check these details', { level: 'Unknown level' });
  const level = levelRaw as Level;

  // Starting a new solo game at a level abandons the player's playing solo
  // game at that level; a lost game at that level that is still open becomes
  // closed instead.
  await app.games.closeLevelGames(s.player.player_id, level);
  const row = await app.games.createSoloGame(s.player.player_id, level);
  sendJson(res, 201, { game: app.games.toGameShape(row, 0) });
}

async function routeGetGame(app: App, req: IncomingMessage, res: ServerResponse, method: string, path: string): Promise<void> {
  if (method !== 'GET') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const s = await requireSession(app, req);
  const id = path.slice('/api/games/'.length).split('/')[0];
  const row = await app.games.loadGame(id);
  // Another player's game answers the same as an unknown game.
  if (!row || row.player_id !== s.player.player_id) {
    throw new ApiError(404, 'UNKNOWN_GAME', 'This game isn\'t in the collection.');
  }
  const moves = await app.games.moveCount(id);
  sendJson(res, 200, { game: app.games.toGameShape(row, moves) });
}

async function routeSaveMoves(app: App, req: IncomingMessage, res: ServerResponse, method: string, path: string, _url: URL, body: unknown): Promise<void> {
  if (method !== 'PUT') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const s = await requireSession(app, req);
  const id = path.slice('/api/games/'.length).split('/')[0];
  const row = await app.games.loadGame(id);
  if (!row || row.player_id !== s.player.player_id) {
    throw new ApiError(404, 'UNKNOWN_GAME', 'This game isn\'t in the collection.');
  }
  if (row.status === 'abandoned' || row.status === 'won' || (row.status === 'lost' && await app.games.isClosed(row))) {
    const code = row.status === 'won' ? 'ALREADY_FINISHED' : 'CLOSED_GAME';
    throw new ApiError(409, code, 'This game is closed');
  }
  const moves = field(body, 'moves');
  const elapsedRaw = field(body, 'elapsed_ms');
  const elapsed = typeof elapsedRaw === 'number' && Number.isFinite(elapsedRaw) ? elapsedRaw : 0;
  const outcome = await app.games.saveMoves(row, moves, elapsed);
  if ('error' in outcome) {
    const status = outcome.error === 'LOG_MALFORMED' ? 400 : 422;
    throw new ApiError(status, outcome.error, 'The log was refused', undefined, outcome.move);
  }
  const fresh = await app.games.loadGame(id);
  if (!fresh) throw new ApiError(404, 'UNKNOWN_GAME', 'This game isn\'t in the collection.');
  sendJson(res, 200, { game: app.games.toGameShape(fresh, await app.games.moveCount(id)) });
}

async function routeFinish(app: App, req: IncomingMessage, res: ServerResponse, method: string, path: string, _url: URL, body: unknown): Promise<void> {
  if (method !== 'POST') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const s = await requireSession(app, req);
  const id = path.slice('/api/games/'.length).split('/')[0];
  const row = await app.games.loadGame(id);
  if (!row || row.player_id !== s.player.player_id) {
    throw new ApiError(404, 'UNKNOWN_GAME', 'This game isn\'t in the collection.');
  }
  if (row.status === 'abandoned') throw new ApiError(409, 'CLOSED_GAME', 'This game is closed');
  if (row.status === 'lost' && await app.games.isClosed(row)) throw new ApiError(409, 'CLOSED_GAME', 'This game is closed');
  const outcome = await app.finish.finish(row, field(body, 'moves'), row.mode === 'daily');
  if (outcome.kind === 'refused') {
    throw new ApiError(outcome.status, outcome.code, 'The finish was refused', undefined, outcome.move);
  }
  sendJson(res, 200, { result: outcome.result });
}

// ------------------------------------------------------------------ daily

async function routeDaily(app: App, req: IncomingMessage, res: ServerResponse, method: string, _path: string, url: URL): Promise<void> {
  if (method !== 'GET') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const s = await requireSession(app, req);
  const monthRaw = url.searchParams.get('month');
  const today = todayInTz(app.cfg);
  const month = monthRaw && isMonthString(monthRaw) ? monthRaw : today.slice(0, 7);
  const shape = await app.daily.dailyCalendar(s.player.player_id, today, month);
  sendJson(res, 200, shape);
}

async function routeDailyGame(app: App, req: IncomingMessage, res: ServerResponse, method: string, path: string): Promise<void> {
  if (method !== 'POST') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const s = await requireSession(app, req);
  const date = path.slice('/api/daily/'.length).replace(/\/game$/, '');
  const today = todayInTz(app.cfg);
  if (!isValidYmd(date)) throw new ApiError(404, 'DAILY_NOT_FOUND', 'No daily for that date');
  if (date < app.cfg.dailyStart) throw new ApiError(404, 'DAILY_NOT_FOUND', 'No daily for that date');
  if (date > today) throw new ApiError(409, 'DAILY_NOT_OPEN', 'That date is not open yet');
  const existing = await app.games.findDailyGame(s.player.player_id, date);
  if (existing) {
    sendJson(res, 200, { game: app.games.toGameShape(existing, await app.games.moveCount(existing.id)) });
    return;
  }
  const row = await app.games.createDailyGame(s.player.player_id, date);
  sendJson(res, 201, { game: app.games.toGameShape(row, 0) });
}

async function routeLeaderboard(app: App, _req: IncomingMessage, res: ServerResponse, method: string, path: string): Promise<void> {
  if (method !== 'GET') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const date = path.slice('/api/leaderboard/'.length);
  if (!isValidYmd(date)) throw new ApiError(422, 'VALIDATION', 'Check these details');
  const rows = await app.leaderboard.rows(date);
  const live = await app.valkey.healthy();
  sendJson(res, 200, { date, live, rows });
}

async function routeProfile(app: App, req: IncomingMessage, res: ServerResponse, method: string): Promise<void> {
  if (method !== 'GET') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const s = await requireSession(app, req);
  sendJson(res, 200, await app.profile.profile(s.player.player_id));
}

// ------------------------------------------------------------------ duels

async function routeCreateDuel(app: App, req: IncomingMessage, res: ServerResponse, method: string, _path: string, _url: URL, body: unknown): Promise<void> {
  if (method !== 'POST') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const s = await requireVerified(app, req);
  const levelRaw = strField(body, 'level');
  if (!isLevel(levelRaw)) throw new ApiError(422, 'VALIDATION', 'Check these details', { level: 'Unknown level' });
  const live = await app.valkey.healthy();
  if (!live) throw new ApiError(503, 'LIVE_UNAVAILABLE', 'Live duels are unavailable right now');
  const room = await app.rooms.create(s.player.player_id, levelRaw as Level);
  sendJson(res, 201, { room });
}

async function routeJoinDuel(app: App, req: IncomingMessage, res: ServerResponse, method: string, _path: string, _url: URL, body: unknown): Promise<void> {
  if (method !== 'POST') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const s = await requireVerified(app, req);
  const codeRaw = strField(body, 'code');
  const code = codeRaw.toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new ApiError(404, 'ROOM_NOT_FOUND', 'No room has that code.');
  const live = await app.valkey.healthy();
  if (!live) throw new ApiError(503, 'LIVE_UNAVAILABLE', 'Live duels are unavailable right now');
  const outcome = await app.rooms.join(s.player.player_id, code);
  if (outcome.code === 'RATE_LIMITED') {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many tries. Wait a minute and try again.', undefined, undefined, outcome.retryAfter);
  }
  if (outcome.code === 'ROOM_NOT_FOUND') throw new ApiError(404, 'ROOM_NOT_FOUND', 'No room has that code.');
  if (outcome.code === 'ROOM_FULL') throw new ApiError(409, 'ROOM_FULL', 'This room already has two players.');
  sendJson(res, 200, { room: outcome.room });
}

async function routeGetRoom(app: App, req: IncomingMessage, res: ServerResponse, method: string, path: string): Promise<void> {
  if (method !== 'GET') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const s = await requireVerified(app, req);
  const code = path.slice('/api/duels/'.length).toUpperCase();
  const live = await app.valkey.healthy();
  if (!live) throw new ApiError(503, 'LIVE_UNAVAILABLE', 'Live duels are unavailable right now');
  const room = await app.rooms.roomForSeat(code, s.player.player_id);
  if (!room) throw new ApiError(404, 'ROOM_NOT_FOUND', 'No room has that code.');
  sendJson(res, 200, { room });
}

// ---------------------------------------------------------------- grading

async function routeGradingPlayers(app: App, _req: IncomingMessage, res: ServerResponse, method: string, _path: string, _url: URL, body: unknown): Promise<void> {
  if (!app.cfg.gradingRoutes) throw new ApiError(404, 'NOT_FOUND', 'Not found');
  if (method !== 'POST') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const list = field(body, 'players');
  if (!Array.isArray(list)) throw new ApiError(400, 'MALFORMED', 'players must be an array');
  const out = [];
  for (const item of list) {
    const rec = shapeOf(item);
    const key = String(rec['key']);
    const email = String(rec['email']);
    const displayName = String(rec['display_name']);
    const password = String(rec['password']);
    const verified = rec['verified'] === true;
    const created = await app.players.createGradedPlayer(email, displayName, password, verified);
    const session = await app.players.createSession(created.player_id);
    out.push({ key, player_id: created.player_id, session });
  }
  sendJson(res, 201, { players: out });
}

async function routeGradingGames(app: App, _req: IncomingMessage, res: ServerResponse, method: string, _path: string, _url: URL, body: unknown): Promise<void> {
  if (!app.cfg.gradingRoutes) throw new ApiError(404, 'NOT_FOUND', 'Not found');
  if (method !== 'POST') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const playerId = strField(body, 'player_id');
  const puzzleId = strField(body, 'puzzle_id');
  const mode = strField(body, 'mode');
  const date = mode === 'daily' ? strField(body, 'date') : null;
  const entries = Array.isArray(field(body, 'entries')) ? (field(body, 'entries') as Array<Record<string, unknown>>) : [];
  const notes = Array.isArray(field(body, 'notes')) ? (field(body, 'notes') as Array<Record<string, unknown>>) : [];
  const mistakes = Number(field(body, 'mistakes') ?? 0);
  const hints = Number(field(body, 'hints') ?? 0);
  const elapsedMs = Number(field(body, 'elapsed_ms') ?? 0);
  const secondChanceUsed = field(body, 'second_chance_used') === true;

  let seeded: { id: string };
  try {
    seeded = await app.games.createGradedGame({
      playerId, puzzleId, mode: mode === 'daily' ? 'daily' : 'solo', date,
      entries, notes, mistakes, hints, elapsedMs, secondChanceUsed,
    });
  } catch {
    // SEED_INVALID covers a wrong entry, a note on a non-empty cell, a daily
    // whose puzzle_id is not that date's puzzle or a daily the player
    // already has, and mistakes reaching the limit.
    throw new ApiError(422, 'SEED_INVALID', 'The seed is invalid');
  }
  sendJson(res, 201, { id: seeded.id, url: `/play/${seeded.id}` });
}

async function routeGradingFinished(app: App, _req: IncomingMessage, res: ServerResponse, method: string, _path: string, _url: URL, body: unknown): Promise<void> {
  if (!app.cfg.gradingRoutes) throw new ApiError(404, 'NOT_FOUND', 'Not found');
  if (method !== 'POST') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const playerId = strField(body, 'player_id');
  const level = strField(body, 'level');
  const result = strField(body, 'result');
  const elapsedMs = Number(field(body, 'elapsed_ms') ?? 0);
  const mistakes = Number(field(body, 'mistakes') ?? 0);
  const hints = Number(field(body, 'hints') ?? 0);
  const finishedAt = new Date(strField(body, 'finished_at'));
  if (!isLevel(level)) throw new ApiError(422, 'SEED_INVALID', 'Unknown level');
  const seconds = Math.floor(elapsedMs / 1000);
  const resultScore = result === 'won' ? score(level as Level, seconds, mistakes, hints) : 0;
  const id = await app.games.createGradedFinishedGame({
    playerId, level: level as Level, result: result === 'won' ? 'won' : 'lost',
    seconds, mistakes, hints, score: resultScore, finishedAt,
  });
  sendJson(res, 201, { id });
}

async function routeGradingDaily(app: App, _req: IncomingMessage, res: ServerResponse, method: string, _path: string, _url: URL, body: unknown): Promise<void> {
  if (!app.cfg.gradingRoutes) throw new ApiError(404, 'NOT_FOUND', 'Not found');
  if (method !== 'POST') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const playerId = strField(body, 'player_id');
  const date = strField(body, 'date');
  const finishedAt = new Date(strField(body, 'finished_at'));
  const elapsedMs = Number(field(body, 'elapsed_ms') ?? 0);
  const mistakes = Number(field(body, 'mistakes') ?? 0);
  const hints = Number(field(body, 'hints') ?? 0);
  if (!isValidYmd(date)) throw new ApiError(422, 'SEED_INVALID', 'Bad date');
  const finishDate = dateInTz(app.cfg, finishedAt);
  const dailyState = finishDate === date ? 'solved' : 'late';
  const seconds = Math.floor(elapsedMs / 1000);
  const id = await app.games.createGradedDailyResult({
    playerId, date, seconds, mistakes, hints,
    score: score('medium', seconds, mistakes, hints),
    finishedAt, dailyState,
  });
  sendJson(res, 201, { id });
}

async function routeGradingClock(_app: App, _req: IncomingMessage, res: ServerResponse, method: string, _path: string, _url: URL, body: unknown): Promise<void> {
  if (!_app.cfg.gradingRoutes) throw new ApiError(404, 'NOT_FOUND', 'Not found');
  if (method !== 'POST') throw new ApiError(404, 'NOT_FOUND', 'Not found');
  const nowRaw = field(body, 'now');
  if (nowRaw === null) {
    setGradingClock(null);
    sendJson(res, 200, { now: null });
    return;
  }
  if (typeof nowRaw !== 'string') throw new ApiError(400, 'MALFORMED', 'now must be a string or null');
  const instant = new Date(nowRaw);
  if (Number.isNaN(instant.getTime())) throw new ApiError(400, 'MALFORMED', 'now is not an instant');
  setGradingClock(instant);
  sendJson(res, 200, { now: nowRaw });
}

// -------------------------------------------------------------- documents

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

export function serveStatic(res: ServerResponse, path: string): void {
  const clientDir = join(process.cwd(), 'dist', 'client');
  let rel = path === '/' ? 'index.html' : path.slice(1);
  rel = normalize(rel);
  const target = join(clientDir, rel);
  if (!target.startsWith(clientDir) || !existsSync(target) || !statSync(target).isFile()) {
    const html = readFileSync(join(clientDir, 'index.html'));
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': html.length });
    res.end(html);
    return;
  }
  const data = readFileSync(target);
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[extname(target)] ?? 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

export async function createServerApp(cfg: Config): Promise<{ server: import('node:http').Server; app: App }> {
  const app = createApp(cfg);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const path = url.pathname;
      const method = req.method ?? 'GET';

      // The health check answers on every instance and never 503.
      if (path === '/api/health' && method === 'GET') {
        const [pgOk, vkOk, mailOk] = await Promise.all([
          app.db.healthy(),
          app.valkey.healthy(),
          app.mail.healthy(),
        ]);
        const down: string[] = [];
        if (!pgOk) down.push('postgres');
        if (!vkOk) down.push('valkey');
        if (!mailOk) down.push('mailpit');
        sendJson(res, 200, down.length === 0 ? { status: 'ok' } : { status: 'degraded', down });
        return;
      }

      if (path.startsWith('/api/')) {
        await handleApi(app, req, res);
        return;
      }

      if (method === 'GET' || method === 'HEAD') {
        serveStatic(res, path);
        return;
      }

      serveStatic(res, path);
    } catch (err) {
      if (err instanceof ApiError) {
        sendError(res, err);
      } else {
        process.stderr.write(`INTERNAL ${String(err)}\n`);
        sendError(res, new ApiError(500, 'INTERNAL', 'Something went wrong at the atelier. Try again.'));
      }
    }
  });

  // The WebSocket hub attaches to the same port.
  const hub = createHub(async (token) => {
    const player = await app.players.sessionPlayer(token);
    return player ? { player_id: player.player_id, display_name: player.display_name } : null;
  });
  hub.attach(server);
  app.rooms.setHub(hub);

  // Live leaderboard fan-out between server processes runs through Valkey
  // publish and subscribe; this process delivers it to its own sockets.
  // When Valkey is unreachable the subscription simply stays down.
  app.valkey.subscribe('seam:live', (message) => {
    try {
      const parsed = JSON.parse(message) as {
        kind?: string;
        date?: string;
        rows?: LeaderboardRow[];
        latest?: { display_name: string; rank: number };
      };
      if (parsed.kind !== 'leaderboard' || !parsed.date) return;
      for (const client of hub.clientsOfLeaderboard(parsed.date)) {
        hub.send(client, {
          type: 'leaderboard',
          date: parsed.date,
          rows: parsed.rows ?? [],
          latest: parsed.latest ?? null,
        });
      }
    } catch {
      // ignore malformed live messages
    }
  }).catch(() => undefined);

  return { server, app };
}

// The serve command boots here: the server binds 0.0.0.0 on APP_PUBLIC_PORT
// when it is set, else on 4173.
async function main(): Promise<void> {
  const cfg = loadConfig();
  const { server } = await createServerApp(cfg);
  server.listen(cfg.appPort, '0.0.0.0', () => {
    process.stdout.write(`Seam listening on 0.0.0.0:${cfg.appPort}\n`);
  });
}

void main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
