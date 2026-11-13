import type { IncomingMessage, ServerResponse } from 'node:http';
import { serverNow } from '../clock.js';
import { databaseIsReady } from '../db/readiness.js';
import { databaseUnavailable } from '../errors.js';
import { assertSameOrigin, requestUrl } from '../http/request.js';
import { sendError, sendJson } from '../http/respond.js';
import { serveClient } from '../http/assets.js';
import type { Ctx } from './context.js';
import { login, logout, me, signup } from './authRoutes.js';
import {
  deleteQuestionImage,
  getDeck,
  getDecks,
  patchDeck,
  postDeck,
  postQuestion,
  postQuestionImage,
  putQuestion,
  removeQuestion,
} from './deckRoutes.js';
import { getHostRoom, getNight, getNights, getTime, postRoom, postRoomCommand } from './roomRoutes.js';
import { getPlayerState, postAnswer, postJoin, postRejoin } from './playerRoutes.js';
import { getPoll, getStream } from './liveRoutes.js';

interface Route {
  method: string;
  segments: string[];
  handle: (ctx: Ctx) => Promise<void> | void;
}

function route(method: string, path: string, handle: Route['handle']): Route {
  return { method, segments: path.split('/').filter((part) => part.length > 0), handle };
}

const routes: Route[] = [
  route('GET', '/api/health', (ctx) => sendJson(ctx.res, 200, { status: 'ok' })),
  route('GET', '/api/time', getTime),
  route('POST', '/api/auth/signup', signup),
  route('POST', '/api/auth/login', login),
  route('POST', '/api/auth/logout', logout),
  route('GET', '/api/auth/me', me),
  route('GET', '/api/decks', getDecks),
  route('POST', '/api/decks', postDeck),
  route('GET', '/api/decks/:deckId', getDeck),
  route('PATCH', '/api/decks/:deckId', patchDeck),
  route('POST', '/api/decks/:deckId/questions', postQuestion),
  route('PUT', '/api/decks/:deckId/questions/:questionId', putQuestion),
  route('DELETE', '/api/decks/:deckId/questions/:questionId', removeQuestion),
  route('POST', '/api/decks/:deckId/questions/:questionId/image', postQuestionImage),
  route('DELETE', '/api/decks/:deckId/questions/:questionId/image', deleteQuestionImage),
  route('POST', '/api/rooms/join', postJoin),
  route('POST', '/api/rooms/rejoin', postRejoin),
  route('POST', '/api/rooms', postRoom),
  route('GET', '/api/rooms/:roomId/host', getHostRoom),
  route('POST', '/api/rooms/:roomId/commands', postRoomCommand),
  route('GET', '/api/rooms/:roomId/state', getPlayerState),
  route('POST', '/api/rooms/:roomId/answers', postAnswer),
  route('GET', '/api/rooms/:roomId/stream', getStream),
  route('GET', '/api/rooms/:roomId/poll', getPoll),
  route('GET', '/api/nights', getNights),
  route('GET', '/api/nights/:roomId', getNight),
];

function match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  const parts = pathname.split('/').filter((part) => part.length > 0);
  for (const candidate of routes) {
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < candidate.segments.length; index += 1) {
      const segment = candidate.segments[index] as string;
      const value = parts[index] as string;
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(value);
      } else if (segment !== value) {
        matched = false;
        break;
      }
    }
    if (matched && candidate.method === method) return { route: candidate, params };
  }
  return null;
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const receivedAt = serverNow();
  try {
    const url = requestUrl(req);
    assertSameOrigin(req);
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/health' && !databaseIsReady()) {
      throw databaseUnavailable();
    }
    const found = match(req.method ?? 'GET', url.pathname);
    if (found) {
      await found.route.handle({ req, res, url, params: found.params, receivedAt });
      return;
    }
    if (req.method === 'GET' && (await serveClient(url.pathname, res))) return;
    sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    sendError(res, error);
  }
}
