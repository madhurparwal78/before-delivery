import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import { loadClockOffset } from './clock.js';
import { config, JSON_BODY_LIMIT } from './config.js';
import { applySchema, connectWithRetry } from './db.js';
import {
  ApiError,
  parseJsonBody,
  readBody,
  sendError,
  setSecurityHeaders,
  type RequestContext,
} from './http.js';
import { addConnection } from './hub.js';
import {
  getAccountKeys,
  getLookup,
  getMe,
  patchSettings,
  patchUsername,
  postAccount,
  postRecover,
  putProfile,
} from './routes/accounts.js';
import { deleteBlock, getBlocks, putBlock } from './routes/blocks.js';
import { getBlobContent, postBlob, putBlobContent } from './routes/blobs.js';
import {
  acceptConversation,
  deleteConversation,
  getConversation,
  getConversations,
  getLetters,
  postConversation,
  postRead,
  putMute,
  putSeal,
} from './routes/conversations.js';
import { getClock, getDump, postClock } from './routes/grading.js';
import {
  getInbox,
  getLetter,
  postInboxAck,
  postLetterRoute,
  postRetract,
} from './routes/letters.js';
import { getAvailability, getConfig, getHealth } from './routes/meta.js';
import { accountIdForRequest, readSessionToken } from './session.js';
import { serveStatic } from './static.js';
import { ensureBucket, StorageUnavailable } from './storage.js';
import { startSweep } from './sweep.js';

type Handler = (ctx: RequestContext) => Promise<void>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  session: boolean;
  /** Raw routes read their own body; everything else is JSON. */
  raw?: boolean;
}

function route(
  method: string,
  pattern: string,
  handler: Handler,
  options: { session?: boolean; raw?: boolean } = {},
): Route {
  return {
    method,
    segments: pattern.split('/').slice(1),
    handler,
    session: options.session !== false,
    raw: options.raw === true,
  };
}

const routes: Route[] = [
  route('GET', '/api/health', getHealth, { session: false }),
  route('GET', '/api/config', getConfig, { session: false }),
  route('GET', '/api/usernames/:username/availability', getAvailability, { session: false }),
  route('POST', '/api/accounts', postAccount, { session: false }),
  route('POST', '/api/recover', postRecover, { session: false }),
  route('GET', '/api/me', getMe),
  route('PUT', '/api/me/profile', putProfile),
  route('PATCH', '/api/me/settings', patchSettings),
  route('PATCH', '/api/me/username', patchUsername),
  route('GET', '/api/lookup', getLookup),
  route('GET', '/api/accounts/:id/keys', getAccountKeys),
  route('POST', '/api/conversations', postConversation),
  route('GET', '/api/conversations', getConversations),
  route('GET', '/api/conversations/:id', getConversation),
  route('POST', '/api/conversations/:id/accept', acceptConversation),
  route('DELETE', '/api/conversations/:id', deleteConversation),
  route('POST', '/api/conversations/:id/read', postRead),
  route('PUT', '/api/conversations/:id/mute', putMute),
  route('GET', '/api/conversations/:id/letters', getLetters),
  route('PUT', '/api/contacts/:account_id/seal', putSeal),
  route('POST', '/api/letters', postLetterRoute),
  route('GET', '/api/letters/:id', getLetter),
  route('POST', '/api/letters/:id/retract', postRetract),
  route('GET', '/api/inbox', getInbox),
  route('POST', '/api/inbox/ack', postInboxAck),
  route('POST', '/api/blobs', postBlob),
  route('PUT', '/api/blobs/:id/content', putBlobContent, { raw: true }),
  route('GET', '/api/blobs/:id', getBlobContent),
  route('GET', '/api/blocks', getBlocks),
  route('PUT', '/api/blocks/:account_id', putBlock),
  route('DELETE', '/api/blocks/:account_id', deleteBlock),
];

if (config.grading) {
  routes.push(
    route('GET', '/api/grading/dump', getDump, { session: false }),
    route('GET', '/api/grading/clock', getClock, { session: false }),
    route('POST', '/api/grading/clock', postClock, { session: false }),
  );
}

function matchRoute(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  const parts = pathname.split('/').slice(1);
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < parts.length; i += 1) {
      const segment = candidate.segments[i] as string;
      const value = parts[i] as string;
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(value);
      } else if (segment !== value) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: candidate, params };
  }
  return null;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function crossOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return false;
  try {
    return new URL(origin).host !== req.headers.host;
  } catch {
    return true;
  }
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  match: { route: Route; params: Record<string, string> },
): Promise<void> {
  const method = req.method ?? 'GET';
  const declared = Number.parseInt(req.headers['content-length'] ?? '0', 10);
  const contentType = req.headers['content-type'] ?? '';

  if (!match.route.raw) {
    if (Number.isInteger(declared) && declared > JSON_BODY_LIMIT) {
      throw new ApiError(413, 'too_large');
    }
    if (declared > 0 && !contentType.includes('application/json')) {
      throw new ApiError(415, 'unsupported_media_type');
    }
  }
  if (STATE_CHANGING.has(method) && crossOrigin(req)) {
    throw new ApiError(403, 'cross_origin');
  }

  let accountId = '';
  if (match.route.session) {
    const found = await accountIdForRequest(req);
    if (found === null) throw new ApiError(401, 'unauthenticated');
    accountId = found;
  }

  const rawBody = match.route.raw ? Buffer.alloc(0) : await readBody(req, JSON_BODY_LIMIT);
  const ctx: RequestContext = {
    req,
    res,
    method,
    url,
    params: match.params,
    body: match.route.raw ? {} : parseJsonBody(rawBody),
    rawBody,
    accountId,
  };
  await match.route.handler(ctx);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  setSecurityHeaders(res);

  const match = matchRoute(req.method ?? 'GET', url.pathname);
  if (match === null) {
    if (url.pathname.startsWith('/api/') || url.pathname === '/ws') {
      sendError(res, new ApiError(404, 'not_found'));
      return;
    }
    void serveStatic(res, url.pathname);
    return;
  }

  handleApi(req, res, url, match).catch((error: unknown) => {
    if (error instanceof ApiError) {
      sendError(res, error);
      return;
    }
    if (error instanceof StorageUnavailable) {
      sendError(res, new ApiError(503, 'storage_unavailable'));
      return;
    }
    process.stderr.write(`request failed: ${String(error)}\n`);
    sendError(res, new ApiError(500, 'server_error'));
  });
});

const sockets = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  void accountIdForRequest(req).then((accountId) => {
    const token = readSessionToken(req);
    if (accountId === null || token === null) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      addConnection(accountId, token, ws);
    });
  });
});

async function main(): Promise<void> {
  await connectWithRetry();
  await applySchema();
  await loadClockOffset();
  try {
    await ensureBucket();
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    process.stderr.write('object storage is unreachable; letters still go through\n');
  }
  startSweep();
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`airfold listening on ${config.port}\n`);
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`airfold failed to start: ${String(error)}\n`);
  process.exit(1);
});
