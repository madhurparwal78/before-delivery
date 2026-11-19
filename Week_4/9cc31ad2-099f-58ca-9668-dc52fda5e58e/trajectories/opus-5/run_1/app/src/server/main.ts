import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import type { Lane } from '../shared/catalogue.js';
import { CLIENT_ROUTES, routes } from './api.js';
import { config } from './config.js';
import { waitForDatabase } from './db.js';
import { ApiError } from './errors.js';
import {
  BodyTooLarge,
  MAX_BODY_BYTES,
  type RequestContext,
  checkBoundary,
  matchRoute,
  readBody,
  readCookie,
  sendError,
} from './http.js';
import { handleConnection, handleDisconnection, setLobbyInput } from './lobbies.js';
import { playerBySession } from './players.js';
import { addConnection, isConnected, removeConnection } from './pushes.js';
import { startHeldSweeper } from './verify.js';

const CLIENT_DIR = fileURLToPath(new URL('../../client', import.meta.url));

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

async function serveFile(res: ServerResponse, path: string, cacheable: boolean): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': cacheable ? 'public, max-age=31536000, immutable' : 'no-store',
    });
    createReadStream(path).pipe(res);
    return true;
  } catch {
    return false;
  }
}

async function serveClient(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (pathname.startsWith('/assets/') || pathname === '/favicon.ico') {
    const relative = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    if (await serveFile(res, join(CLIENT_DIR, relative), pathname.startsWith('/assets/'))) return;
  }
  if (req.method === 'GET' && CLIENT_ROUTES.some((route) => route.test(pathname))) {
    if (await serveFile(res, join(CLIENT_DIR, 'index.html'), false)) return;
  }
  sendError(res, new ApiError(404, 'NOT_FOUND', 'Not found.'));
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const matched = matchRoute(routes, req.method ?? 'GET', url.pathname);
  if (!matched) {
    await serveClient(req, res, url.pathname);
    return;
  }
  try {
    checkBoundary(req);
  } catch (error) {
    sendError(res, error as ApiError);
    req.resume();
    return;
  }
  let rawBody: Buffer;
  try {
    rawBody = await readBody(req, matched.route.maxBodyBytes ?? MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLarge) {
      sendError(res, new ApiError(413, 'PAYLOAD_TOO_LARGE', 'That request body is too large.'));
      return;
    }
    throw error;
  }
  const sessionId = readCookie(req, 'kerb_session');
  const player = sessionId === null ? null : await playerBySession(sessionId);
  const ctx: RequestContext = {
    req,
    res,
    url,
    params: matched.params,
    rawBody,
    playerId: player?.player_id ?? null,
    sessionId: player === null ? null : sessionId,
  };
  try {
    await matched.route.handler(ctx);
  } catch (error) {
    if (error instanceof ApiError) {
      sendError(res, error);
      return;
    }
    console.error('request failed', url.pathname, error);
    sendError(res, new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong.'));
  }
}

function readLane(value: unknown): Lane {
  return value === 'left' || value === 'right' ? value : 'middle';
}

async function start(): Promise<void> {
  await waitForDatabase();
  startHeldSweeper();

  const server = createServer((req, res) => {
    void handle(req, res).catch((error) => {
      console.error('unhandled request error', error);
      if (!res.headersSent) {
        sendError(res, new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong.'));
      }
    });
  });

  const sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/v1/ws') {
      socket.destroy();
      return;
    }
    const sessionId = readCookie(req, 'kerb_session');
    void (async () => {
      const player = sessionId === null ? null : await playerBySession(sessionId);
      if (!player) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      sockets.handleUpgrade(req, socket, head, (ws) => {
        const playerId = player.player_id;
        addConnection(playerId, ws);
        handleConnection(playerId);
        ws.on('message', (data) => {
          let message: Record<string, unknown>;
          try {
            message = JSON.parse(data.toString()) as Record<string, unknown>;
          } catch {
            return;
          }
          if (message.type === 'keys') {
            setLobbyInput(playerId, {
              throttle: message.throttle === 1 ? 1 : 0,
              brake: message.brake === 1 ? 1 : 0,
              drift: message.drift === 1 ? 1 : 0,
              lane: readLane(message.lane),
            });
          }
        });
        ws.on('close', () => {
          removeConnection(playerId, ws);
          if (!isConnected(playerId)) handleDisconnection(playerId);
        });
      });
    })();
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`kerbline listening on ${config.port}`);
  });
}

void start();
