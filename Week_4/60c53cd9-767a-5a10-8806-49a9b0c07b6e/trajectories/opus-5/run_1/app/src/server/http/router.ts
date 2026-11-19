/** The one request pipeline: body limits, origin, routing and the error shape. */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError } from '../errors';
import { SearchUnavailable } from '../search/client';
import { StorageUnavailable } from '../storage/s3';
import { hasSignature, type ImageKind } from '../assets/image';
import * as publicRoutes from '../routes/public';
import * as accountRoutes from '../routes/accounts';
import * as holdRoutes from '../routes/holds';
import * as consoleRoutes from '../routes/console';
import { sendAppShell, sendSharedPage, sendStatic } from './pages';
import {
  assertSameOrigin,
  makeWire,
  PHOTO_BODY_LIMIT,
  readBody,
  readJsonBody,
  sendApiError,
  sendJson,
  sendText,
  type JsonBody,
  type Wire,
} from './wire';

type BodyKind = 'none' | 'json' | 'photo';

interface Route {
  method: string;
  pattern: RegExp;
  body: BodyKind;
  run: (wire: Wire, parameters: string[], body: JsonBody | Buffer | null) => Promise<void> | void;
}

function json(
  method: string,
  pattern: RegExp,
  run: (wire: Wire, parameters: string[], body: JsonBody) => Promise<void> | void,
): Route {
  return { method, pattern, body: 'json', run: (wire, parameters, body) => run(wire, parameters, body as JsonBody) };
}

function plain(
  method: string,
  pattern: RegExp,
  run: (wire: Wire, parameters: string[]) => Promise<void> | void,
): Route {
  return { method, pattern, body: 'none', run: (wire, parameters) => run(wire, parameters) };
}

const ROUTES: Route[] = [
  plain('GET', /^\/api\/health$/, (wire) => publicRoutes.health(wire)),
  plain('GET', /^\/api\/tower$/, (wire) => publicRoutes.tower(wire)),
  plain('GET', /^\/api\/search$/, (wire) => publicRoutes.search(wire)),
  plain('GET', /^\/api\/units\/([^/]+)$/, (wire, p) => publicRoutes.unit(wire, p[0])),
  plain('GET', /^\/media\/(.+)$/, (wire, p) => publicRoutes.media(wire, p[0])),
  plain('GET', /^\/api\/shared\/([^/]+)$/, (wire, p) => publicRoutes.sharedHold(wire, p[0])),

  json('POST', /^\/api\/accounts$/, (wire, _p, body) => accountRoutes.createAccount(wire, body)),
  json('POST', /^\/api\/session$/, (wire, _p, body) => accountRoutes.openSession(wire, body)),
  plain('GET', /^\/api\/session$/, (wire) => accountRoutes.readSession(wire)),
  plain('DELETE', /^\/api\/session$/, (wire) => accountRoutes.closeSession(wire)),

  plain('GET', /^\/api\/holds$/, (wire) => holdRoutes.listHolds(wire)),
  json('POST', /^\/api\/holds$/, (wire, _p, body) => holdRoutes.createHold(wire, body)),
  plain('GET', /^\/api\/holds\/([^/]+)$/, (wire, p) => holdRoutes.readHold(wire, p[0])),
  json('POST', /^\/api\/holds\/([^/]+)\/release$/, (wire, p) => holdRoutes.release(wire, p[0])),
  json('POST', /^\/api\/holds\/([^/]+)\/share$/, (wire, p) => holdRoutes.share(wire, p[0])),
  plain('DELETE', /^\/api\/holds\/([^/]+)\/share$/, (wire, p) => holdRoutes.revokeShare(wire, p[0])),

  plain('GET', /^\/api\/console\/units$/, (wire) => consoleRoutes.listUnits(wire)),
  plain('GET', /^\/api\/console\/units\/([^/]+)\/prices$/, (wire, p) => consoleRoutes.listPriceVersions(wire, p[0])),
  plain('GET', /^\/api\/console\/holds$/, (wire) => consoleRoutes.listActiveHolds(wire)),
  json('POST', /^\/api\/console\/bands\/([^/]+)\/release$/, (wire, p) => consoleRoutes.releaseFloorBand(wire, p[0])),
  json('PUT', /^\/api\/console\/units\/([^/]+)\/price$/, (wire, p, body) => consoleRoutes.setPrice(wire, p[0], body)),
  {
    method: 'PUT',
    pattern: /^\/api\/console\/units\/([^/]+)\/view-photo$/,
    body: 'photo',
    run: (wire, parameters, body) => consoleRoutes.uploadViewPhoto(wire, parameters[0], body as Buffer),
  },
  json('POST', /^\/api\/console\/units\/([^/]+)\/withdraw$/, (wire, p) => consoleRoutes.withdraw(wire, p[0])),
  json('POST', /^\/api\/console\/holds\/([^/]+)\/convert$/, (wire, p) => consoleRoutes.convert(wire, p[0])),
];

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const PAGE_TITLES: { pattern: RegExp; title: string }[] = [
  { pattern: /^\/$/, title: 'Highwater · Orrin & Vale Developments' },
  { pattern: /^\/finder$/, title: 'Find your home · Highwater' },
  { pattern: /^\/holds\/[^/]+$/, title: 'Your hold · Highwater' },
  { pattern: /^\/console$/, title: 'Sales console · Highwater' },
];

function photoKindFromContentType(wire: Wire): ImageKind {
  const type = (wire.request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'image/png') return 'png';
  if (type === 'image/jpeg') return 'jpeg';
  throw new ApiError('unsupported_image');
}

async function readRouteBody(wire: Wire, kind: BodyKind): Promise<JsonBody | Buffer | null> {
  if (kind === 'json') return readJsonBody(wire);
  if (kind === 'photo') {
    const body = await readBody(wire, PHOTO_BODY_LIMIT);
    const declared = photoKindFromContentType(wire);
    if (!hasSignature(body, declared)) throw new ApiError('unsupported_image');
    return body;
  }
  return null;
}

export async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const wire = makeWire(request, response);
  try {
    if (WRITE_METHODS.has(wire.method) && /^\/api\/shared\//.test(wire.pathname)) {
      publicRoutes.sharedWrite(wire);
      return;
    }

    const route = ROUTES.find((candidate) => candidate.method === wire.method && candidate.pattern.test(wire.pathname));
    if (route) {
      const match = route.pattern.exec(wire.pathname);
      const parameters = match ? match.slice(1) : [];
      const body = await readRouteBody(wire, route.body);
      assertSameOrigin(wire);
      await route.run(wire, parameters, body);
      return;
    }

    if (wire.pathname.startsWith('/api/') || wire.pathname.startsWith('/media/')) {
      throw new ApiError('not_found');
    }

    if (wire.method === 'GET' || wire.method === 'HEAD') {
      const shared = /^\/shared\/([^/]+)$/.exec(wire.pathname);
      if (shared) {
        await sendSharedPage(wire, shared[1]);
        return;
      }
      const page = PAGE_TITLES.find((candidate) => candidate.pattern.test(wire.pathname));
      if (page) {
        sendAppShell(wire, page.title);
        return;
      }
      if (await sendStatic(wire, wire.pathname)) return;
    }

    sendText(wire, 404, 'Not found', 'text/plain; charset=utf-8');
  } catch (error) {
    if (error instanceof ApiError) {
      sendApiError(wire, error);
      return;
    }
    if (error instanceof SearchUnavailable) {
      sendApiError(wire, new ApiError('search_unavailable'));
      return;
    }
    if (error instanceof StorageUnavailable) {
      sendApiError(wire, new ApiError('storage_unavailable'));
      return;
    }
    process.stderr.write(`request failed: ${error instanceof Error ? error.stack : String(error)}\n`);
    if (!response.headersSent) sendJson(wire, 500, { error: { code: 'invalid', message: 'Check the highlighted fields.' } });
  }
}
