// The Gambit Hall server: request ids, structured logs, routing.
import http from 'node:http';
import crypto from 'node:crypto';
import pool, { query } from '../lib/db.mjs';
import { migrate } from '../lib/db.mjs';
import { seed } from '../lib/seed.mjs';
import { parseFen } from '../lib/chess.mjs';
import { HttpError, err, json, authMember } from './api-helpers.mjs';
import {
  apiRegister, apiLogin, apiLogout, apiGetProfile, apiPatchProfile, apiAvatar,
  apiGetGame, apiLegalMoves, apiPlayMove, apiComputerGame, apiFromFen, handlePage,
} from './api.mjs';
import {
  apiDrawOffer, apiDrawResponse, apiClaim, apiTakeback, apiTakebackResponse,
  apiResign, apiRematch, apiGetRecord, apiImportRecord, apiGetChat, apiPostChat,
  apiListChallenges, apiCreateChallenge, apiAcceptChallenge, apiDeclineChallenge, apiListClubs, apiGetClub,
  apiListMembers, apiGetMember, apiMemberGames, apiLeaderboard, apiNotifications,
  apiMarkRead, apiBlock, apiUnblock, apiVoidGame,
} from './api2.mjs';
import { serveStatic, mediaHandler } from './static.mjs';
import { renderPage } from '../ssr/pages.mjs';

const PORT = process.env.APP_PUBLIC_PORT || '4173';

const routes = [];
function route(method, pattern, handler) {
  const names = [];
  const rx = new RegExp('^' + pattern.replace(/\{(\w+)\}/g, (_, name) => {
    names.push(name);
    return '([^/]+)';
  }) + '$');
  routes.push({ method, rx, names, handler });
}

// health
route('GET', '/api/health', async (req, res) => {
  await query('SELECT 1');
  json(res, 200, { status: 'ok' });
});

// auth
route('POST', '/api/auth/register', apiRegister);
route('POST', '/api/auth/login', apiLogin);
route('POST', '/api/auth/logout', apiLogout);

// profile
route('GET', '/api/profile', apiGetProfile);
route('PATCH', '/api/profile', apiPatchProfile);
route('PUT', '/api/profile/avatar', (req, res) => apiAvatar(req, res, null));
route('PUT', '/api/members/{username}/avatar', (req, res, username) => apiAvatar(req, res, username));
route('PATCH', '/api/members/{username}/profile', async (req, res, username) => {
  // preferences: only the member themself
  const member = await authMember(req);
  if (!member) err(401, 'Sign in to do that.');
  if (member.username.toLowerCase() !== decodeURIComponent(username).toLowerCase()) {
    err(403, 'That is not your profile to change.');
  }
  return apiPatchProfile(req, res);
});

// games
route('GET', '/api/games/{game_id}', apiGetGame);
route('POST', '/api/games/{game_id}/moves', apiPlayMove);
route('GET', '/api/games/{game_id}/legal-moves', apiLegalMoves);
route('POST', '/api/games/from-fen', apiFromFen);
route('POST', '/api/games/import', apiImportRecord);
route('GET', '/api/games/{game_id}/record', apiGetRecord);
route('POST', '/api/games/{game_id}/draw-offer', apiDrawOffer);
route('POST', '/api/games/{game_id}/draw-response', apiDrawResponse);
route('POST', '/api/games/{game_id}/claim', apiClaim);
route('POST', '/api/games/{game_id}/takeback', apiTakeback);
route('POST', '/api/games/{game_id}/takeback-response', apiTakebackResponse);
route('POST', '/api/games/{game_id}/resign', apiResign);
route('POST', '/api/games/{game_id}/rematch', apiRematch);
route('GET', '/api/games/{game_id}/chat', apiGetChat);
route('POST', '/api/games/{game_id}/chat', apiPostChat);
route('POST', '/api/computer-games', apiComputerGame);

// challenges
route('GET', '/api/challenges', apiListChallenges);
route('POST', '/api/challenges', apiCreateChallenge);
route('POST', '/api/challenges/{challenge_id}/accept', apiAcceptChallenge);
route('POST', '/api/challenges/{challenge_id}/decline', apiDeclineChallenge);

// clubs
route('GET', '/api/clubs', apiListClubs);
route('GET', '/api/clubs/{club_slug}', apiGetClub);

// members & leaderboard
route('GET', '/api/members', apiListMembers);
route('GET', '/api/members/{username}', apiGetMember);
route('GET', '/api/members/{username}/games', apiMemberGames);
route('GET', '/api/leaderboard', apiLeaderboard);

// notifications
route('GET', '/api/notifications', apiNotifications);
route('POST', '/api/notifications/{notification_id}/read', apiMarkRead);

// blocks
route('POST', '/api/blocks', apiBlock);
route('DELETE', '/api/blocks/{username}', apiUnblock);

// admin
route('POST', '/api/admin/games/{game_id}/void', apiVoidGame);

function logRequestLine(requestId, req, status, startedAt, extra = {}) {
  const line = {
    ts: new Date().toISOString(),
    request_id: requestId,
    method: req.method,
    path: req.url.split('?')[0],
    status,
    ms: Math.round(performance.now() - startedAt),
    ...extra,
  };
  process.stdout.write(JSON.stringify(line) + '\n');
}

async function handleApi(req, res, pathname) {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = pathname.match(r.rx);
    if (!m) continue;
    const params = {};
    r.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
    await r.handler(req, res, ...r.names.map(n => params[n]));
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const startedAt = performance.now();
  const requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', requestId);
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  let status = 500;
  try {
    if (pathname.startsWith('/api')) {
      try {
        const handled = await handleApi(req, res, pathname);
        if (!handled) { status = 404; err(404, 'That address is not here.'); }
      } catch (e) {
        if (e instanceof HttpError) {
          status = e.status;
          if (!res.headersSent) json(res, e.status, { error: e.message });
        } else {
          status = 500;
          if (!res.headersSent) json(res, 500, { error: 'Something went wrong on our side.' });
          process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), request_id: requestId, level: 'error', message: e.message, stack: e.stack?.split('\n').slice(0, 3).join(' | ') }) + '\n');
        }
      }
    } else if (await mediaHandler(req, res, pathname)) {
      status = res.statusCode;
    } else if (serveStatic(req, res, pathname)) {
      status = 200;
    } else {
      // pages
      const handled = await handlePage(req, res, pathname);
      if (!handled) {
        status = 404;
        const member = await authMember(req);
        const html = await renderPage('/not-found', { member, req });
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } else {
        status = res.statusCode;
      }
    }
  } catch (e) {
    status = 500;
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('Something went wrong on our side.');
    }
    process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), request_id: requestId, level: 'error', message: e.message }) + '\n');
  } finally {
    logRequestLine(requestId, req, res.statusCode || status, startedAt);
  }
});

async function start() {
  await migrate();
  await seed();
  server.listen(Number(PORT), '0.0.0.0', () => {
    process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), event: 'listening', port: Number(PORT), url: process.env.APP_PUBLIC_URL }) + '\n');
  });
}

// graceful shutdown
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}

start().catch(e => {
  process.stderr.write(`Failed to start: ${e.message}\n`);
  process.exit(1);
});
