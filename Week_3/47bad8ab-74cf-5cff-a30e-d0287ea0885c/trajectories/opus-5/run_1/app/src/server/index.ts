import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config';
import { connectAndMigrate } from './db';
import { gameAccess } from './games/service';
import { startRecordRetries } from './games/records';
import { currentPlayer, sendError, sendJson } from './http';
import { handleUpgrade, resumePausesAfterBoot } from './live';
import { seedLibrary } from './puzzles';
import { storage } from './storage';
import type { RouteContext } from './routes/context';
import { getHistory, getRecord } from './routes/history';
import { postSeed, postSession } from './routes/grading';
import {
  getGame,
  getGameOps,
  getLink,
  postGameOps,
  postGames,
  postLinkJoin,
  postLinkOff,
  postLinkReplace,
  postRaceStart,
  postTeam,
} from './routes/games';
import { getMe, getSettings, postPlayers, putSettings } from './routes/players';
import { getOriginal, getPuzzle, getPuzzles, postPuzzles } from './routes/puzzles';

type Handler = (context: RouteContext) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
}

const UUID = '([0-9a-f-]{36})';

const routes: Route[] = [
  {
    method: 'GET',
    pattern: /^\/api\/health$/,
    handler: async ({ res }) => {
      const ok = await storage.reachable();
      sendJson(res, 200, { status: ok ? 'ok' : 'unavailable' });
    },
  },
  {
    method: 'GET',
    pattern: /^\/api\/config$/,
    handler: async ({ res }) => {
      sendJson(res, 200, {
        heartbeat_ms: config.heartbeatMs,
        presence_grace_ms: config.presenceGraceMs,
        upload_max_bytes: config.uploadMaxBytes,
        max_grid: config.maxGrid,
        max_players: config.maxPlayers,
        live_rate: config.liveRate,
        toast_ms: config.toastMs,
        replay_step_ms: config.replayStepMs,
      });
    },
  },
  { method: 'POST', pattern: /^\/api\/players$/, handler: postPlayers },
  { method: 'GET', pattern: /^\/api\/players\/me$/, handler: getMe },
  { method: 'GET', pattern: /^\/api\/players\/me\/settings$/, handler: getSettings },
  { method: 'PUT', pattern: /^\/api\/players\/me\/settings$/, handler: putSettings },
  { method: 'GET', pattern: /^\/api\/puzzles$/, handler: getPuzzles },
  { method: 'POST', pattern: /^\/api\/puzzles$/, handler: postPuzzles },
  { method: 'GET', pattern: new RegExp(`^/api/puzzles/${UUID}$`), handler: getPuzzle },
  { method: 'GET', pattern: new RegExp(`^/api/puzzles/${UUID}/original$`), handler: getOriginal },
  { method: 'POST', pattern: /^\/api\/games$/, handler: postGames },
  { method: 'GET', pattern: new RegExp(`^/api/games/${UUID}$`), handler: getGame },
  { method: 'GET', pattern: new RegExp(`^/api/games/${UUID}/ops$`), handler: getGameOps },
  { method: 'POST', pattern: new RegExp(`^/api/games/${UUID}/ops$`), handler: postGameOps },
  { method: 'POST', pattern: new RegExp(`^/api/games/${UUID}/link/off$`), handler: postLinkOff },
  {
    method: 'POST',
    pattern: new RegExp(`^/api/games/${UUID}/link/replace$`),
    handler: postLinkReplace,
  },
  { method: 'POST', pattern: new RegExp(`^/api/games/${UUID}/team$`), handler: postTeam },
  { method: 'POST', pattern: new RegExp(`^/api/games/${UUID}/race/start$`), handler: postRaceStart },
  { method: 'GET', pattern: /^\/api\/links\/([a-z0-9]{12})$/, handler: getLink },
  { method: 'POST', pattern: /^\/api\/links\/([a-z0-9]{12})\/join$/, handler: postLinkJoin },
  { method: 'GET', pattern: /^\/api\/history$/, handler: getHistory },
  { method: 'GET', pattern: new RegExp(`^/api/history/${UUID}/record$`), handler: getRecord },
];

if (config.grading) {
  routes.push(
    { method: 'POST', pattern: /^\/api\/grading\/seed$/, handler: postSeed },
    { method: 'POST', pattern: /^\/api\/grading\/session$/, handler: postSession },
  );
}

const CLIENT_DIR = fileURLToPath(new URL('./client/', import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const PAGE_PATHS = [
  /^\/$/,
  /^\/puzzles$/,
  /^\/upload$/,
  /^\/history$/,
  /^\/build$/,
  /^\/games\/[0-9a-f-]{36}$/,
  /^\/g\/[a-z0-9]{12}$/,
];

async function serveFile(res: ServerResponse, path: string): Promise<boolean> {
  try {
    const body =
      extname(path) === '.html'
        ? Buffer.from(
            (await readFile(path, 'utf8')).replace('__OVERLAP_PUBLIC_URL__', config.publicUrl),
            'utf8',
          )
        : await readFile(path);
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': extname(path) === '.html' ? 'no-store' : 'public, max-age=3600',
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

async function serveClient(pathname: string, res: ServerResponse): Promise<void> {
  if (pathname.includes('..')) {
    notFound(res);
    return;
  }
  if (extname(pathname) !== '') {
    const file = join(CLIENT_DIR, normalize(pathname));
    if (!file.startsWith(CLIENT_DIR) || !(await serveFile(res, file))) notFound(res);
    return;
  }
  if (!PAGE_PATHS.some((pattern) => pattern.test(pathname))) {
    const served = await serveFile(res, join(CLIENT_DIR, 'index.html'));
    if (!served) notFound(res);
    return;
  }
  if (!(await serveFile(res, join(CLIENT_DIR, 'index.html')))) notFound(res);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    for (const route of routes) {
      const match = route.pattern.exec(url.pathname);
      if (!match) continue;
      if (route.method !== req.method) continue;
      try {
        await route.handler({ req, res, url, params: match.slice(1) });
      } catch (error) {
        sendError(res, error);
      }
      return;
    }
    sendJson(res, 404, { error: 'not_found', message: 'No such route.' });
    return;
  }
  await serveClient(url.pathname, res);
}

const server = createServer((req, res) => {
  void handle(req, res).catch((error: unknown) => sendError(res, error));
});

server.on('upgrade', (req, socket, head) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const match = new RegExp(`^/api/games/${UUID}/live$`).exec(url.pathname);
    const reject = (status: number, text: string): void => {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (!match) {
      reject(404, 'Not Found');
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      const host = req.headers.host ?? '';
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = '';
      }
      if (originHost !== host) {
        reject(403, 'Forbidden');
        return;
      }
    }
    const player = await currentPlayer(req);
    if (!player) {
      reject(401, 'Unauthorized');
      return;
    }
    try {
      const state = await gameAccess(match[1], player.id);
      handleUpgrade(req, socket, head, state, player.id);
    } catch {
      reject(404, 'Not Found');
    }
  })();
});

async function boot(): Promise<void> {
  await connectAndMigrate();
  await seedLibrary();
  try {
    await storage.ensureBucket();
  } catch {
    process.stderr.write('object storage is unreachable at boot; continuing\n');
  }
  await resumePausesAfterBoot();
  startRecordRetries();
}

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`overlap listening on ${config.port}\n`);
});

void boot();
