import http from 'node:http';
import type { HealthShape } from '../shared/api';
import { config } from './config';
import { connectPostgres, isPostgresUp } from './db';
import { endRoomsForOutage, sweepRooms } from './duels';
import { ApiError } from './errors';
import { loadGame } from './games';
import {
  appOrigin,
  assertSameOrigin,
  parseCookies,
  readJsonBody,
  Router,
  sendApiError,
  sendJson,
  type RequestContext,
} from './http';
import { isMailpitUp, probeMailpit } from './mail';
import { currentPlayer } from './players';
import { registerAuthRoutes } from './routes/auth';
import { registerDuelRoutes } from './routes/duels';
import { registerGradingRoutes } from './routes/grading';
import { registerPlayRoutes } from './routes/play';
import { attachSocketServer } from './socket';
import { sendAsset, sendShell } from './static';
import { connectValkey, isValkeyUp, startValkey } from './valkey';

const router = new Router();

router.get('/api/health', (context) => {
  const down: HealthShape['down'] = [];
  if (!isPostgresUp()) down.push('postgres');
  if (!isValkeyUp()) down.push('valkey');
  if (!isMailpitUp()) down.push('mailpit');
  const body: HealthShape = down.length === 0 ? { status: 'ok' } : { status: 'degraded', down };
  sendJson(context.res, 200, body);
});

registerAuthRoutes(router);
registerPlayRoutes(router);
registerDuelRoutes(router);
if (config.gradingRoutes) registerGradingRoutes(router);

const PAGE_ROUTES: RegExp[] = [
  /^\/$/,
  /^\/daily$/,
  /^\/duel$/,
  /^\/duel\/[^/]+$/,
  /^\/leaderboard$/,
  /^\/leaderboard\/[^/]+$/,
  /^\/profile$/,
  /^\/signin$/,
  /^\/signup$/,
  /^\/reset$/,
  /^\/reset\/[^/]+$/,
  /^\/verify\/[^/]+$/,
];

const PLAY_ROUTE = /^\/play\/([^/]+)$/;

async function documentStatus(
  pathname: string,
  context: Pick<RequestContext, 'cookies'>,
): Promise<number> {
  const play = PLAY_ROUTE.exec(pathname);
  if (play) {
    const player = await currentPlayer(context as RequestContext).catch(() => null);
    if (!player) return 200;
    try {
      await loadGame(play[1] as string, player.id);
      return 200;
    } catch {
      return 404;
    }
  }
  return PAGE_ROUTES.some((pattern) => pattern.test(pathname)) ? 200 : 404;
}

const server = http.createServer((req, res) => {
  void handle(req, res);
});

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const origin = appOrigin(req);
  const url = new URL(req.url ?? '/', origin);
  const method = req.method ?? 'GET';
  const context: RequestContext = {
    req,
    res,
    method,
    pathname: url.pathname,
    query: url.searchParams,
    params: {},
    origin,
    cookies: parseCookies(req.headers.cookie),
    body: undefined,
  };

  try {
    assertSameOrigin(req, origin);
    if (url.pathname.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') context.body = await readJsonBody(req);
      const matched = router.match(method, url.pathname);
      if (!matched) throw new ApiError('NOT_FOUND');
      context.params = matched.params;
      await matched.handler(context);
      return;
    }
    if (method !== 'GET' && method !== 'HEAD') throw new ApiError('NOT_FOUND');
    if (await sendAsset(res, url.pathname)) return;
    await sendShell(res, await documentStatus(url.pathname, context));
  } catch (cause) {
    if (res.headersSent) {
      res.end();
      return;
    }
    const error = cause instanceof ApiError ? cause : new ApiError('INTERNAL');
    if (url.pathname.startsWith('/api/')) sendApiError(res, error);
    else await sendShell(res, 500).catch(() => res.end());
  }
}

attachSocketServer(server);

function watchDependencies(): void {
  const tick = async (): Promise<void> => {
    await connectPostgres();
    await connectValkey();
    await probeMailpit();
    sweepRooms();
    if (!isValkeyUp()) endRoomsForOutage();
  };
  void tick();
  setInterval(() => void tick(), 3000);
}

startValkey();
watchDependencies();
server.listen(config.port, '0.0.0.0');
