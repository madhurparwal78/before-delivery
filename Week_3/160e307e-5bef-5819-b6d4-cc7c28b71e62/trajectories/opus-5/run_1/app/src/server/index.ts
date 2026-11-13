import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { notFound, rateLimited, unprocessable } from './errors.js';
import { databaseReachable, query } from './db.js';
import { env, publicConfig } from './env.js';
import {
  LOCAL_MATCH_BODY_LIMIT,
  Router,
  bool,
  num,
  originAllowed,
  parseCookies,
  parseJsonBody,
  readBody,
  sendError,
  sendJson,
  sendNoContent,
  sessionCookie,
  str,
} from './http.js';
import type { Ctx } from './http.js';
import type { LiveMatch } from './match.js';
import { pageHtml } from './page.js';
import { openLink, requestLink } from './auth.js';
import {
  emoteAllowed,
  getMatch,
  markReady,
  matchJson,
  offerRematch,
  previewAllowed,
  requireSeat,
  resign,
  submitShot,
} from './match.js';
import { bus } from './bus.js';
import { closeRoom, createRoom, joinRoom, roomJson } from './rooms.js';
import { enterQueue, leaveQueue, queueStatus, startQueueLoop } from './queue.js';
import type { QueueMode } from './queue.js';
import { equip, purchase, shopBody } from './shop.js';
import { recordLocalMatch } from './local.js';
import type { LocalShot, LocalSubmission } from './local.js';
import { ledgerFor } from './ledger.js';
import {
  gradingCreateMatch,
  gradingCreatePlayer,
  gradingShot,
  gradingSimulate,
  requireGradingKey,
} from './grading.js';
import {
  meBody,
  playerById,
  playerByName,
  requirePlayer,
  sessionPlayer,
  setAvatar,
  setName,
  skipName,
} from './players.js';
import { attachSocket } from './ws.js';
import { LEADERBOARD_MAX_RD, LEADERBOARD_MIN_GAMES, LEADERBOARD_SIZE, round2, tierOf } from '../shared/rating.js';
import type { Format, Seat } from '../shared/types.js';

const publicDir = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const STATIC_FILES = new Map<string, string>([
  ['/app.js', 'text/javascript; charset=utf-8'],
  ['/app.css', 'text/css; charset=utf-8'],
]);

const EMOTES = ['nice-shot', 'well-played', 'oops', 'thinking', 'good-game', 'hello'];

const router = new Router();

function seatValue(value: number | null): Seat | null {
  return value === 0 || value === 1 ? value : null;
}

function requireFormat(value: string | null): Format {
  if (value === 'quick' || value === 'classic') return value;
  throw unprocessable('INVALID_INTENT');
}

/* Session and profile */

router.get('/api/me', async (ctx) => {
  const player = await requirePlayer(ctx);
  sendJson(ctx.res, 200, await meBody(player));
});

router.post('/api/me/name', async (ctx) => {
  const player = await requirePlayer(ctx);
  const name = str(ctx.body, 'name');
  if (name === null) throw unprocessable('NAME_INVALID');
  const updated = await setName(player, name, num(ctx.body, 'avatar'));
  sendJson(ctx.res, 200, await meBody(updated));
});

router.post('/api/me/skip', async (ctx) => {
  const player = await requirePlayer(ctx);
  sendJson(ctx.res, 200, await meBody(await skipName(player)));
});

router.post('/api/me/avatar', async (ctx) => {
  const player = await requirePlayer(ctx);
  const avatar = num(ctx.body, 'avatar');
  if (avatar === null) throw unprocessable('AVATAR_INVALID');
  sendJson(ctx.res, 200, await meBody(await setAvatar(player, avatar)));
});

router.get('/api/players/by-name/:name', async (ctx) => {
  const player = await playerByName(ctx.params.name);
  if (player === null) throw notFound();
  sendJson(ctx.res, 200, {
    id: player.id,
    name: player.name,
    avatar: player.avatar,
    rating: round2(player.rating),
    rd: round2(player.rd),
    tier: tierOf(player.rating),
    rankedGames: player.ranked_games,
  });
});

router.get('/api/players/:id/history', async (ctx) => {
  const player = await playerById(ctx.params.id);
  if (player === null) throw notFound();
  const rows = await query<{
    match_id: string;
    mode: string;
    format: string;
    opponent_name: string;
    seat: number;
    score: number;
    opponent_score: number;
    rating_delta: number | null;
    winner_seat: number | null;
    end_reason: string | null;
    ended_at: Date;
  }>(
    `select mp.match_id::text, m.mode, m.format, mp.opponent_name, mp.seat, mp.score, mp.opponent_score,
            mp.rating_delta, m.winner_seat, m.end_reason, m.ended_at
     from match_players mp join matches m on m.id = mp.match_id
     where mp.player_id = $1 and m.status in ('completed', 'forfeit') and m.ended_at is not null
     order by m.ended_at desc limit 50`,
    [player.id],
  );
  sendJson(ctx.res, 200, {
    matches: rows.map((row) => ({
      matchId: row.match_id,
      mode: row.mode,
      format: row.format,
      opponent: row.opponent_name,
      result: row.winner_seat === row.seat ? 'won' : 'lost',
      yourScore: row.score,
      theirScore: row.opponent_score,
      ratingDelta: row.rating_delta === null ? null : round2(row.rating_delta),
      endReason: row.end_reason,
      endedAt: row.ended_at.toISOString(),
    })),
  });
});

router.get('/api/leaderboard', async (ctx) => {
  const player = await sessionPlayer(ctx);
  const rows = await query<{
    id: string;
    name: string;
    rating: number;
    ranked_games: number;
  }>(
    `select id, name, rating, ranked_games from players
     where ranked_games >= $1 and rd < $2 order by rating desc, name asc limit $3`,
    [LEADERBOARD_MIN_GAMES, LEADERBOARD_MAX_RD, LEADERBOARD_SIZE],
  );
  const table = rows.map((row, index) => ({
    rank: index + 1,
    playerId: row.id,
    name: row.name,
    rating: round2(row.rating),
    tier: tierOf(row.rating),
    rankedGames: row.ranked_games,
  }));
  let you: Record<string, unknown> | null = null;
  if (player !== null) {
    const inTable = table.find((row) => row.playerId === player.id);
    if (inTable !== undefined) {
      you = inTable;
    } else {
      const ahead = await query<{ count: string }>(
        `select count(*)::text as count from players
         where ranked_games >= $1 and rd < $2 and rating > $3`,
        [LEADERBOARD_MIN_GAMES, LEADERBOARD_MAX_RD, player.rating],
      );
      you = {
        rank: Number(ahead[0]?.count ?? '0') + 1,
        playerId: player.id,
        name: player.name,
        rating: round2(player.rating),
        tier: tierOf(player.rating),
        rankedGames: player.ranked_games,
      };
    }
  }
  sendJson(ctx.res, 200, { rows: table, you });
});

router.get('/api/config', (ctx) => {
  sendJson(ctx.res, 200, publicConfig());
});

router.get('/api/me/ledger', async (ctx) => {
  const player = await requirePlayer(ctx);
  sendJson(ctx.res, 200, await ledgerFor(player.id));
});

/* Email link */

router.post('/api/auth/link', async (ctx) => {
  const player = await requirePlayer(ctx);
  const email = str(ctx.body, 'email');
  if (email === null) throw unprocessable('EMAIL_INVALID');
  await requestLink(player, email);
  sendJson(ctx.res, 202, { status: 'sent' });
});

/* Rooms */

router.post('/api/rooms', async (ctx) => {
  const player = await requirePlayer(ctx);
  const format = requireFormat(str(ctx.body, 'format'));
  const room = await createRoom(player, format);
  sendJson(ctx.res, 201, { code: room.code, url: `/join/${room.code}`, matchId: room.matchId });
});

router.get('/api/rooms/:code', async (ctx) => {
  sendJson(ctx.res, 200, await roomJson(ctx.params.code));
});

router.post('/api/rooms/:code/join', async (ctx) => {
  const player = await requirePlayer(ctx);
  sendJson(ctx.res, 200, await joinRoom(ctx.params.code, player));
});

router.delete('/api/rooms/:code', async (ctx) => {
  const player = await requirePlayer(ctx);
  await closeRoom(ctx.params.code, player);
  sendNoContent(ctx.res);
});

/* Queue */

router.post('/api/queue', async (ctx) => {
  const player = await requirePlayer(ctx);
  const mode = str(ctx.body, 'mode');
  if (mode !== 'casual' && mode !== 'ranked') throw unprocessable('INVALID_INTENT');
  sendJson(ctx.res, 202, await enterQueue(player, mode as QueueMode));
});

router.get('/api/queue', async (ctx) => {
  const player = await requirePlayer(ctx);
  sendJson(ctx.res, 200, await queueStatus(player));
});

router.delete('/api/queue', async (ctx) => {
  const player = await requirePlayer(ctx);
  await leaveQueue(player);
  sendNoContent(ctx.res);
});

/* Matches */

async function matchContext(ctx: Ctx): Promise<{ match: LiveMatch; seat: Seat; playerId: string }> {
  const player = await requirePlayer(ctx);
  const match = await getMatch(ctx.params.id);
  if (match === null) throw notFound();
  return { match, seat: requireSeat(match, player.id), playerId: player.id };
}

router.get('/api/matches/:id', async (ctx) => {
  const { match } = await matchContext(ctx);
  sendJson(ctx.res, 200, matchJson(match));
});

router.post('/api/matches/:id/ready', async (ctx) => {
  const { match, seat } = await matchContext(ctx);
  await markReady(match, seat);
  if (match.roomCode !== null) {
    bus.toMatch(`room:${match.roomCode}`, 'roomStatus', await roomJson(match.roomCode));
  }
  sendJson(ctx.res, 200, matchJson(match));
});

router.post('/api/matches/:id/preview', async (ctx) => {
  const { match, seat, playerId } = await matchContext(ctx);
  if (!previewAllowed(match.id, playerId)) throw rateLimited();
  bus.toMatch(match.id, 'preview', {
    seat,
    x: num(ctx.body, 'x') ?? 0,
    dx: num(ctx.body, 'dx') ?? 0,
    dy: num(ctx.body, 'dy') ?? 0,
    p: num(ctx.body, 'p') ?? 0,
  });
  sendNoContent(ctx.res);
});

router.post('/api/matches/:id/shots', async (ctx) => {
  const { match, seat } = await matchContext(ctx);
  const result = await submitShot(match, seat, {
    shotSeq: num(ctx.body, 'shotSeq') ?? -1,
    x: num(ctx.body, 'x') ?? Number.NaN,
    dx: num(ctx.body, 'dx') ?? Number.NaN,
    dy: num(ctx.body, 'dy') ?? Number.NaN,
    p: num(ctx.body, 'p') ?? Number.NaN,
    modelVersion: str(ctx.body, 'modelVersion') ?? '',
  });
  sendJson(ctx.res, 200, result);
});

router.post('/api/matches/:id/emotes', async (ctx) => {
  const { match, seat, playerId } = await matchContext(ctx);
  const emote = str(ctx.body, 'emote');
  if (emote === null || !EMOTES.includes(emote)) throw unprocessable('INVALID_EMOTE');
  if (!emoteAllowed(match.id, playerId)) throw rateLimited();
  bus.toMatch(match.id, 'emote', { seat, emote });
  sendNoContent(ctx.res);
});

router.post('/api/matches/:id/resign', async (ctx) => {
  const { match, seat } = await matchContext(ctx);
  await resign(match, seat);
  sendJson(ctx.res, 200, matchJson(match));
});

router.post('/api/matches/:id/rematch', async (ctx) => {
  const { match, seat } = await matchContext(ctx);
  const accept = bool(ctx.body, 'accept');
  sendJson(ctx.res, 200, await offerRematch(match, seat, accept === true));
});

/* Pass and play */

router.post(
  '/api/local-matches',
  async (ctx) => {
    const player = await requirePlayer(ctx);
    const shotsBody = ctx.body.shots;
    const playersBody = ctx.body.players;
    const claimedBody = ctx.body.claimed as Record<string, unknown> | undefined;
    const key = str(ctx.body, 'idempotencyKey');
    if (!Array.isArray(shotsBody) || !Array.isArray(playersBody) || claimedBody === undefined || key === null) {
      throw unprocessable('RESULT_MISMATCH');
    }
    const scores = claimedBody.scores;
    if (!Array.isArray(scores)) throw unprocessable('RESULT_MISMATCH');
    const submission: LocalSubmission = {
      format: requireFormat(str(ctx.body, 'format')),
      players: playersBody.map((entry) => ({ name: String((entry as Record<string, unknown>).name ?? '') })),
      shots: shotsBody.map((entry) => {
        const row = entry as Record<string, unknown>;
        return {
          seat: (Number(row.seat) === 1 ? 1 : 0) as Seat,
          x: Number(row.x),
          dx: Number(row.dx),
          dy: Number(row.dy),
          p: Number(row.p),
        } satisfies LocalShot;
      }),
      resignedSeat: seatValue(num(ctx.body, 'resignedSeat')),
      claimed: {
        winnerSeat: (Number(claimedBody.winnerSeat) === 1 ? 1 : 0) as Seat,
        scores: [Number(scores[0]), Number(scores[1])],
      },
      modelVersion: str(ctx.body, 'modelVersion') ?? '',
      idempotencyKey: key,
    };
    sendJson(ctx.res, 201, await recordLocalMatch(player, submission));
  },
  LOCAL_MATCH_BODY_LIMIT,
);

/* Shop */

router.get('/api/shop', async (ctx) => {
  const player = await requirePlayer(ctx);
  sendJson(ctx.res, 200, await shopBody(player));
});

router.post('/api/shop/purchase', async (ctx) => {
  const player = await requirePlayer(ctx);
  const itemId = str(ctx.body, 'itemId');
  const key = str(ctx.body, 'idempotencyKey');
  if (itemId === null || key === null) throw notFound('ITEM_NOT_FOUND');
  sendJson(ctx.res, 200, await purchase(player, itemId, key));
});

router.post('/api/shop/equip', async (ctx) => {
  const player = await requirePlayer(ctx);
  const itemId = str(ctx.body, 'itemId');
  if (itemId === null) throw notFound('ITEM_NOT_FOUND');
  sendJson(ctx.res, 200, await equip(player, itemId));
});

/* Health */

router.get('/api/health', async (ctx) => {
  sendJson(ctx.res, 200, { status: (await databaseReachable()) ? 'ok' : 'unavailable' });
});

/* Grading */

router.post('/api/grading/players', async (ctx) => {
  requireGradingKey(ctx);
  sendJson(ctx.res, 201, await gradingCreatePlayer(ctx));
});

router.post('/api/grading/matches', async (ctx) => {
  requireGradingKey(ctx);
  sendJson(ctx.res, 201, await gradingCreateMatch(ctx));
});

router.post('/api/grading/matches/:id/shots', async (ctx) => {
  requireGradingKey(ctx);
  sendJson(ctx.res, 200, await gradingShot(ctx));
});

router.post('/api/grading/simulate', (ctx) => {
  requireGradingKey(ctx);
  sendJson(ctx.res, 200, gradingSimulate(ctx));
});

/* Static files and pages */

async function serveStatic(path: string, res: ServerResponse): Promise<boolean> {
  const type =
    STATIC_FILES.get(path) ??
    (path.startsWith('/fonts/') && path.endsWith('.woff2') ? 'font/woff2' : undefined);
  if (type === undefined) return false;
  try {
    const body = await readFile(join(publicDir, path));
    res.writeHead(200, {
      'content-type': type,
      'content-length': body.length,
      'cache-control': path.startsWith('/fonts/') ? 'public, max-age=604800' : 'no-cache',
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
  });
  res.end(html);
}

function redirect(res: ServerResponse, location: string, cookie: string | null): void {
  const headers: Record<string, string> = { location, 'cache-control': 'no-store' };
  if (cookie !== null) headers['set-cookie'] = cookie;
  res.writeHead(302, headers);
  res.end();
}

async function handlePage(ctx: Ctx): Promise<void> {
  if (ctx.path.startsWith('/auth/link/')) {
    const token = ctx.path.slice('/auth/link/'.length);
    const current = await sessionPlayer(ctx).catch(() => null);
    const outcome = await openLink(token, current?.id ?? null).catch(() => ({ kind: 'expired' }) as const);
    if (outcome.kind === 'expired') {
      sendHtml(ctx.res, 200, pageHtml({ link: 'expired' }));
      return;
    }
    const cookie = outcome.sessionId === null ? null : sessionCookie(outcome.sessionId);
    const target =
      outcome.kind === 'linked'
        ? `/?linked=${encodeURIComponent(outcome.email)}`
        : `/?signedin=${encodeURIComponent(outcome.name)}`;
    redirect(ctx.res, target, cookie);
    return;
  }

  const player = await requirePlayer(ctx).catch(() => null);
  if (ctx.path === '/' && player !== null && !player.chosen) {
    redirect(ctx.res, '/welcome', null);
    return;
  }
  sendHtml(ctx.res, 200, pageHtml({}));
}

/** Source, configuration, dependencies and credentials are never served. */
function denied(path: string): boolean {
  if (path.split('/').some((part) => part.startsWith('.') && part.length > 1)) return true;
  return ['/src/', '/dist/', '/node_modules/', '/logs/'].some((prefix) => path.startsWith(prefix));
}

/* Request pipeline */

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  const method = req.method ?? 'GET';
  const isApi = path.startsWith('/api/');

  if (STATE_CHANGING.has(method) && !originAllowed(req)) {
    sendJson(res, 403, { error: 'CROSS_ORIGIN' });
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const ctx: Ctx = {
    req,
    res,
    url,
    method,
    path,
    params: {},
    body: {},
    cookies,
    sessionId: cookies.dc_session ?? null,
    setSession: (id: string) => {
      ctx.sessionId = id;
      res.setHeader('set-cookie', sessionCookie(id));
    },
  };

  const match = router.match(method, path);
  if (match !== null) {
    try {
      if (path.startsWith('/api/grading/')) requireGradingKey(ctx);
      if (STATE_CHANGING.has(method)) {
        const raw = await readBody(req, match.route.bodyLimit);
        ctx.body = parseJsonBody(raw, req.headers['content-type']);
      }
      ctx.params = match.params;
      await match.route.handler(ctx);
    } catch (error) {
      sendError(res, error);
    }
    return;
  }

  if (method === 'GET' || method === 'HEAD') {
    if (!denied(path) && (await serveStatic(path, res))) return;
    if (isApi || extname(path) !== '' || denied(path)) {
      if (isApi) sendJson(res, 404, { error: 'NOT_FOUND' });
      else sendHtml(res, 404, 'Not found');
      return;
    }
    try {
      await handlePage(ctx);
    } catch (error) {
      sendError(res, error);
    }
    return;
  }

  if (isApi) {
    sendJson(res, 404, { error: 'NOT_FOUND' });
    return;
  }
  sendJson(res, 405, { error: 'NOT_FOUND' });
}

const server = createServer((req, res) => {
  void onRequest(req, res).catch(() => {
    if (!res.headersSent) sendJson(res, 500, { error: 'SERVER_ERROR' });
  });
});

server.headersTimeout = 20000;
attachSocket(server);
startQueueLoop();

server.listen(env.port, '0.0.0.0', () => {
  process.stdout.write(`Due Coin listening on 0.0.0.0:${env.port}\n`);
});
