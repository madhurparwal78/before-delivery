import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';

import { ERROR_MESSAGES } from '../shared/copy';
import type { Role } from '../shared/types';
import { sessionUser } from './auth';
import { config } from './config';
import { applySchema, dbReady, pool } from './db';
import { AppError } from './errors';
import { checkOrigin, type Ctx, parseCookies, sendJson } from './http';
import { addConnection, replayFor, type Viewer } from './live';
import { isOrganizerRole, loadTournament, roleFor } from './domain/tournaments';
import * as authRoutes from './routes/auth';
import * as fileRoutes from './routes/files';
import * as gradingRoutes from './routes/grading';
import * as matchRoutes from './routes/matches';
import * as shareRoutes from './routes/share';
import * as tournamentRoutes from './routes/tournaments';
import { ensureBucket, storageReachable } from './storage';
import { startDeadlineLoop } from './timers';

type Handler = (ctx: Ctx) => Promise<void>;
type BodyKind = 'none' | 'json' | 'roster' | 'logo';

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
  body: BodyKind;
}

const routes: Route[] = [];

const add = (method: string, path: string, handler: Handler, body: BodyKind = 'json'): void => {
  routes.push({ method, parts: path.split('/').filter((part) => part !== ''), handler, body });
};

add('GET', '/api/health', async (ctx) => {
  if (!dbReady()) {
    sendJson(ctx.res, 503, { status: 'starting' });
    return;
  }
  try {
    await pool.query('select 1');
  } catch {
    sendJson(ctx.res, 503, { status: 'starting' });
    return;
  }
  sendJson(ctx.res, 200, { status: (await storageReachable()) ? 'ok' : 'unavailable' });
}, 'none');

add('GET', '/api/config', tournamentRoutes.getConfig, 'none');
add('POST', '/api/auth/signup', authRoutes.signUp);
add('POST', '/api/auth/signin', authRoutes.signIn);
add('POST', '/api/auth/signout', authRoutes.signOut, 'none');
add('GET', '/api/me', authRoutes.me, 'none');

add('GET', '/api/tournaments', tournamentRoutes.listTournaments, 'none');
add('POST', '/api/tournaments', tournamentRoutes.createTournament);
add('GET', '/api/tournaments/:id', tournamentRoutes.getTournament, 'none');
add('PATCH', '/api/tournaments/:id', tournamentRoutes.patchTournament);
add('DELETE', '/api/tournaments/:id', tournamentRoutes.deleteTournament, 'none');
add('POST', '/api/tournaments/:id/co-organizers', tournamentRoutes.addCoOrganizer);
add('DELETE', '/api/tournaments/:id/co-organizers/:username', tournamentRoutes.removeCoOrganizer, 'none');
add('GET', '/api/tournaments/:id/entrants', tournamentRoutes.listEntrants, 'none');
add('POST', '/api/tournaments/:id/entrants', tournamentRoutes.addEntrant);
add('PATCH', '/api/entrants/:id', tournamentRoutes.patchEntrant);
add('DELETE', '/api/entrants/:id', tournamentRoutes.deleteEntrant, 'none');
add('PUT', '/api/tournaments/:id/seeding', tournamentRoutes.putSeeding);
add('GET', '/api/tournaments/:id/preview', tournamentRoutes.getPreview, 'none');
add('POST', '/api/tournaments/:id/roster', fileRoutes.uploadRoster, 'roster');
add('GET', '/api/tournaments/:id/roster', fileRoutes.downloadRoster, 'none');
add('POST', '/api/tournaments/:id/logo', fileRoutes.uploadLogo, 'logo');
add('GET', '/api/tournaments/:id/logo', fileRoutes.getLogo, 'none');
add('POST', '/api/tournaments/:id/checkin/open', tournamentRoutes.openCheckin);
add('POST', '/api/tournaments/:id/checkin/close', tournamentRoutes.closeCheckinRoute, 'none');
add('POST', '/api/tournaments/:id/draft', tournamentRoutes.backToDraft, 'none');
add('POST', '/api/tournaments/:id/checkin', tournamentRoutes.playerCheckin, 'none');
add('PUT', '/api/entrants/:id/checkin', tournamentRoutes.organizerCheckin);
add('POST', '/api/tournaments/:id/start', tournamentRoutes.startTournamentRoute, 'none');
add('POST', '/api/tournaments/:id/rounds', tournamentRoutes.nextSwissRound, 'none');
add('GET', '/api/tournaments/:id/matches', tournamentRoutes.listMatches, 'none');
add('GET', '/api/tournaments/:id/standings', tournamentRoutes.getStandings, 'none');
add('GET', '/api/tournaments/:id/me', tournamentRoutes.myEntrant, 'none');
add('GET', '/api/tournaments/:id/disputes', tournamentRoutes.listDisputes, 'none');
add('POST', '/api/tournaments/:id/share/rotate', tournamentRoutes.rotateShare, 'none');

add('POST', '/api/matches/:id/call', matchRoutes.postCall);
add('POST', '/api/matches/:id/report', matchRoutes.postReport);
add('POST', '/api/matches/:id/confirm', matchRoutes.postConfirm);
add('POST', '/api/matches/:id/dispute', matchRoutes.postDispute);
add('POST', '/api/matches/:id/result', matchRoutes.postResult);
add('POST', '/api/matches/:id/resolve', matchRoutes.postResolve);
add('POST', '/api/matches/:id/edit-preview', matchRoutes.postEditPreview);
add('POST', '/api/matches/:id/edit', matchRoutes.postEdit);

add('GET', '/api/share/:code', shareRoutes.getShare, 'none');
add('GET', '/api/share/:code/logo', fileRoutes.getShareLogo, 'none');
add('GET', '/api/users/:username/history', shareRoutes.getHistory, 'none');

if (config.grading) {
  add('POST', '/api/grading/seed', gradingRoutes.seed);
  add('POST', '/api/grading/session', gradingRoutes.gradingSession);
  add('POST', '/api/grading/clock', gradingRoutes.gradingClock);
}

const matchRoute = (method: string, pathname: string): { route: Route; params: Record<string, string> } | null => {
  const parts = pathname.split('/').filter((part) => part !== '');
  for (const route of routes) {
    if (route.parts.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let hit = true;
    for (let index = 0; index < route.parts.length; index += 1) {
      const expected = route.parts[index] as string;
      const actual = parts[index] as string;
      if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
      else if (expected !== actual) {
        hit = false;
        break;
      }
    }
    if (!hit) continue;
    if (route.method !== method) continue;
    return { route, params };
  }
  return null;
};

const PUBLIC_DIR = join(__dirname, '..', '..', 'public');

const ASSET_TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.html': 'text/html; charset=utf-8',
};

const sendAsset = (res: ServerResponse, file: string): boolean => {
  const resolved = normalize(file);
  if (!resolved.startsWith(PUBLIC_DIR) || !existsSync(resolved) || !statSync(resolved).isFile()) return false;
  const type = ASSET_TYPES[extname(resolved)];
  if (type === undefined) return false;
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
  createReadStream(resolved).pipe(res);
  return true;
};

const sendShell = (res: ServerResponse, status: number): void => {
  const body = readFileSync(join(PUBLIC_DIR, 'index.html'));
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-cache',
  });
  res.end(body);
};

const sendPlain = (res: ServerResponse, status: number, text: string): void => {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
};

const bodyLimit = (kind: BodyKind): { limit: number; forFile: boolean } => {
  if (kind === 'roster') return { limit: config.rosterMaxBytes, forFile: true };
  if (kind === 'logo') return { limit: config.logoMaxBytes, forFile: true };
  return { limit: 65536, forFile: false };
};

const handleApi = async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> => {
  const method = req.method ?? 'GET';
  if (url.pathname.startsWith('/api/share/') && method !== 'GET') {
    throw new AppError('read_only', ERROR_MESSAGES.readOnly);
  }
  if (method !== 'GET' && method !== 'HEAD') checkOrigin(req);

  const found = matchRoute(method, url.pathname);
  if (found === null) throw new AppError('not_found', ERROR_MESSAGES.notFoundTournament);

  const { limit, forFile } = bodyLimit(found.route.body);
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit + (forFile ? 65536 : 0)) {
    req.resume();
    throw new AppError(
      'too_large',
      forFile ? ERROR_MESSAGES.fileTooLarge(limit) : ERROR_MESSAGES.bodyTooLarge(limit),
    );
  }

  const cookies = parseCookies(req);
  const sessionId = cookies.cupfold_session ?? null;
  const user = sessionId === null ? null : await sessionUser(pool, sessionId);
  const ctx: Ctx = {
    req,
    res,
    url,
    method,
    params: found.params,
    userId: user?.id ?? null,
    username: user?.username ?? null,
    sessionId,
  };
  await found.route.handler(ctx);
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((error: unknown) => {
      if (error instanceof AppError) {
        sendJson(res, error.status, error.body());
        return;
      }
      process.stderr.write(`request failed: ${String(error)}\n`);
      sendJson(res, 500, { error: 'wrong_state', message: 'Something went wrong.' });
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendPlain(res, 404, 'Not found');
    return;
  }

  if (url.pathname === '/') {
    sendShell(res, 200);
    return;
  }
  const lastSegment = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
  if (lastSegment.includes('.')) {
    if (!sendAsset(res, join(PUBLIC_DIR, url.pathname))) sendPlain(res, 404, 'Not found');
    return;
  }
  sendShell(res, 200);
});

const sockets = new WebSocketServer({ noServer: true });

const viewerFor = async (url: URL, req: IncomingMessage): Promise<{ viewer: Viewer; after: number } | null> => {
  const parts = url.pathname.split('/').filter((part) => part !== '');
  if (parts.length !== 4 || parts[0] !== 'api' || parts[1] !== 'tournaments' || parts[3] !== 'live') return null;
  const tournamentId = parts[2] as string;
  const tournament = await loadTournament(pool, tournamentId);
  if (tournament === null) return null;
  const after = Number(url.searchParams.get('after') ?? '0');
  const shareCode = url.searchParams.get('share');

  if (shareCode !== null) {
    if (tournament.share_code !== shareCode || tournament.state === 'draft') return null;
    return {
      viewer: { tournamentId, role: 'viewer', spectator: true, shareCode },
      after: Number.isFinite(after) ? after : 0,
    };
  }

  const cookies = parseCookies(req);
  const sessionId = cookies.cupfold_session ?? null;
  const user = sessionId === null ? null : await sessionUser(pool, sessionId);
  if (user === null) return null;
  const role: Role = await roleFor(pool, tournament, user.id);
  if (tournament.state === 'draft' && !isOrganizerRole(role)) return null;
  return {
    viewer: { tournamentId, role, spectator: false, shareCode: null },
    after: Number.isFinite(after) ? after : 0,
  };
};

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== 'null') {
    try {
      if (new URL(origin).host !== req.headers.host) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
    } catch {
      socket.destroy();
      return;
    }
  }
  viewerFor(url, req)
    .then((resolved) => {
      if (resolved === null) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }
      sockets.handleUpgrade(req, socket, head, (ws) => {
        addConnection(ws, resolved.viewer);
        if (resolved.after > 0) {
          void replayFor(pool, resolved.viewer.tournamentId, resolved.after, resolved.viewer).then((missed) => {
            for (const message of missed) ws.send(JSON.stringify(message));
          });
        }
      });
    })
    .catch(() => socket.destroy());
});

const boot = async (): Promise<void> => {
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`cupfold listening on ${config.port}\n`);
  });
  await applySchema();
  await ensureBucket();
  startDeadlineLoop();
};

void boot();
