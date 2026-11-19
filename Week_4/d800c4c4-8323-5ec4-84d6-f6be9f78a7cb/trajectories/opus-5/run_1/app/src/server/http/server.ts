import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import * as copy from '../../shared/copy';
import { landingPath, screenForPath, signInPathFor } from '../../shared/screens';
import { pool } from '../repo/db';
import { recordActivity } from '../repo/users';
import * as fail from './errors';
import { ApiFailure } from './errors';
import {
  isCrossSiteWrite,
  JSON_BODY_LIMIT,
  MULTIPART_BODY_LIMIT,
  readBody,
  RequestContext,
  resolveSession,
  Router,
  runRoute,
  type Reply,
} from './pipeline';
import {
  cancelMembershipRoute,
  healthRoute,
  joinRoute,
  meRoute,
  memberListRoute,
  signInRoute,
  signOutRoute,
} from './routes/membership';
import {
  addItemRoute,
  declareClosureRoute,
  patchItemRoute,
  readCalendarRoute,
  readItemRoute,
  readSettingsRoute,
  removeClosureRoute,
  statusRoute,
  writeHoursRoute,
  writeSettingsRoute,
} from './routes/office';
import {
  boardRoute,
  cancelLoanRoute,
  checkoutRoute,
  hangRoute,
  listLoansRoute,
  photoRoute,
  readLoanRoute,
  reserveLoanRoute,
  takeDownRoute,
} from './routes/loans';
import { checkinRoute, finishRoute } from './routes/checkin';
import { cancelHoldRoute, listHoldsRoute, placeHoldRoute } from './routes/holds';
import {
  decideWaiverRoute,
  listFeesRoute,
  payFeeRoute,
  readFeeRoute,
  requestWaiverRoute,
} from './routes/fees';

const PUBLIC_DIR = path.resolve(__dirname, '../public');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

const router = new Router();
for (const route of [
  healthRoute,
  statusRoute,
  signInRoute,
  signOutRoute,
  meRoute,
  joinRoute,
  memberListRoute,
  cancelMembershipRoute,
  boardRoute,
  readItemRoute,
  addItemRoute,
  patchItemRoute,
  readSettingsRoute,
  writeSettingsRoute,
  readCalendarRoute,
  writeHoursRoute,
  declareClosureRoute,
  removeClosureRoute,
  listHoldsRoute,
  placeHoldRoute,
  cancelHoldRoute,
  listLoansRoute,
  readLoanRoute,
  reserveLoanRoute,
  cancelLoanRoute,
  checkoutRoute,
  hangRoute,
  takeDownRoute,
  checkinRoute,
  finishRoute,
  photoRoute,
  listFeesRoute,
  readFeeRoute,
  payFeeRoute,
  requestWaiverRoute,
  decideWaiverRoute,
]) {
  router.add(route as never);
}

function cookieHeader(name: string, value: string, maxAge: number): string {
  const base = `${name}=${value}; Path=/; HttpOnly; SameSite=Lax`;
  return maxAge > 0 ? `${base}; Max-Age=${maxAge}` : `${base}; Max-Age=0`;
}

function writeReply(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = {};
  if (reply.kind !== 'bytes' && reply.cookie) {
    headers['set-cookie'] = cookieHeader(reply.cookie.name, reply.cookie.value, reply.cookie.maxAge);
  }
  if (reply.kind === 'json') {
    const body = Buffer.from(JSON.stringify(reply.body), 'utf8');
    headers['content-type'] = 'application/json; charset=utf-8';
    headers['content-length'] = String(body.length);
    response.writeHead(reply.status, headers);
    response.end(body);
    return;
  }
  if (reply.kind === 'bytes') {
    response.writeHead(reply.status, {
      ...reply.headers,
      'content-length': String(reply.body.length),
    });
    response.end(reply.body);
    return;
  }
  response.writeHead(reply.status, headers);
  response.end();
}

function notFoundReply(): Reply {
  return { kind: 'json', status: 404, body: { error: copy.NOT_FOUND } };
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const method = (request.method ?? 'GET').toUpperCase();
  const now = new Date();

  if (isCrossSiteWrite(request)) {
    writeReply(response, { kind: 'json', status: 403, body: fail.crossSite().body });
    return;
  }

  const matched = router.match(method, url.pathname);
  if (!matched) {
    request.resume();
    writeReply(response, notFoundReply());
    return;
  }

  const limit = matched.route.body === 'multipart' ? MULTIPART_BODY_LIMIT : JSON_BODY_LIMIT;
  const { body, oversize } = await readBody(request, limit);
  const session = await resolveSession(request, now);
  const contentLength = Number(request.headers['content-length'] ?? '0');
  const hasBody = oversize || contentLength > 0 || request.headers['transfer-encoding'] === 'chunked';

  const ctx = new RequestContext(
    method,
    url.pathname,
    url.searchParams,
    matched.params,
    body,
    oversize,
    request.headers['content-type'] ?? '',
    hasBody,
    session,
    now,
  );

  let reply: Reply;
  try {
    reply = await runRoute(matched.route, ctx);
  } catch (error) {
    if (error instanceof ApiFailure) {
      reply = { kind: 'json', status: error.status, body: error.body };
    } else {
      process.stderr.write(`${String(error)}\n`);
      reply = { kind: 'json', status: 503, body: { error: copy.BILLING_DOWN_GENERAL } };
    }
  }
  await noteWriteActivity(ctx, reply.status);
  writeReply(response, reply);
}

async function noteWriteActivity(ctx: RequestContext, status: number): Promise<void> {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(ctx.method)) return;
  if (status === 401 || !ctx.session || ctx.session.ended) return;
  await recordActivity(pool, ctx.session.id);
}

function serveAsset(response: ServerResponse, filePath: string, status: number): void {
  const extension = path.extname(filePath);
  response.writeHead(status, {
    'content-type': MIME_TYPES[extension] ?? 'application/octet-stream',
    'content-length': String(statSync(filePath).size),
    'cache-control': extension === '.html' ? 'no-store' : 'public, max-age=3600',
  });
  createReadStream(filePath).pipe(response);
}

function plainNotFound(response: ServerResponse): void {
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('Not found.');
}

/** Only the built assets and the API are served; everything else answers 404. */
async function handleBrowser(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
    plainNotFound(response);
    return;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    plainNotFound(response);
    return;
  }
  if (decoded.includes('\0') || decoded.includes('..')) {
    plainNotFound(response);
    return;
  }

  if (decoded.startsWith('/assets/')) {
    const resolved = path.resolve(PUBLIC_DIR, `.${decoded}`);
    if (!resolved.startsWith(path.join(PUBLIC_DIR, 'assets')) || !existsSync(resolved)) {
      plainNotFound(response);
      return;
    }
    serveAsset(response, resolved, 200);
    return;
  }

  const screen = screenForPath(decoded);
  const indexPath = path.join(PUBLIC_DIR, 'index.html');

  if (screen.kind === 'not-found') {
    const lastSegment = decoded.slice(decoded.lastIndexOf('/') + 1);
    if (lastSegment.includes('.')) {
      plainNotFound(response);
      return;
    }
    serveAsset(response, indexPath, 404);
    return;
  }

  const session = await resolveSession(request, new Date());
  const signedIn = session !== null && !session.ended;
  if (signedIn && session) await recordActivity(pool, session.id);

  if (!signedIn && screen.kind !== 'pegboard' && screen.kind !== 'signin' && screen.kind !== 'join') {
    response.writeHead(302, { location: signInPathFor(decoded) });
    response.end();
    return;
  }
  if (signedIn && session && (screen.kind === 'signin' || screen.kind === 'join')) {
    response.writeHead(302, { location: landingPath(session.user.role) });
    response.end();
    return;
  }
  serveAsset(response, indexPath, 200);
}

export function startHttpServer(port: number): void {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const task = url.pathname.startsWith('/api')
      ? handleApi(request, response, url)
      : handleBrowser(request, response, url);
    void task.catch((error: unknown) => {
      process.stderr.write(`${String(error)}\n`);
      if (!response.headersSent) {
        response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ status: 'starting' }));
      } else {
        response.end();
      }
    });
  });
  server.listen(port, '0.0.0.0');
}
