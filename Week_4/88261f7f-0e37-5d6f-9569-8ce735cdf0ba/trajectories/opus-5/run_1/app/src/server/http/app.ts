import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { pool } from '../db';
import { Role } from '../domain/roles';
import { ApiError, errorTexts, failure } from './errors';
import {
  Access,
  collectBody,
  MAX_JSON_BYTES,
  readJsonBody,
  RequestContext,
  Reply,
  Router,
} from './router';
import { loadSession, parseCookies, SESSION_COOKIE, SessionUser } from './session';
import { servePage, serveStatic } from './pages';

export const router = new Router();

function requestOrigin(req: IncomingMessage): string {
  const host = req.headers.host ?? `127.0.0.1`;
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
  return `${proto}://${host}`;
}

export function originOf(req: IncomingMessage): string {
  return requestOrigin(req);
}

function isSameOriginOrAbsent(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return true;
  return origin === requestOrigin(req);
}

function allowedByRole(access: Access, user: SessionUser | null): boolean {
  if (access === 'public') return true;
  if (!user) return false;
  if (access === 'signedIn') return true;
  return (access as Role[]).includes(user.role);
}

function writeReply(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    ...(reply.headers ?? {}),
  };
  if (reply.json !== undefined) {
    const payload = Buffer.from(JSON.stringify(reply.json), 'utf8');
    headers['content-type'] = 'application/json; charset=utf-8';
    headers['content-length'] = String(payload.length);
    res.writeHead(reply.status, headers);
    res.end(payload);
    return;
  }
  if (reply.body !== undefined) {
    headers['content-type'] = reply.contentType ?? 'application/octet-stream';
    headers['content-length'] = String(reply.body.length);
    res.writeHead(reply.status, headers);
    res.end(reply.body);
    return;
  }
  res.writeHead(reply.status, headers);
  res.end();
}

function writeError(res: ServerResponse, error: ApiError): void {
  writeReply(res, { status: error.status, json: error.body });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', requestOrigin(req));
  const method = req.method ?? 'GET';

  if (method !== 'GET' && method !== 'HEAD' && !isSameOriginOrAbsent(req)) {
    writeError(res, failure(404, errorTexts.notFound));
    return;
  }

  const matched = router.match(method, url.pathname);
  if (!matched) {
    if (method === 'GET' || method === 'HEAD') {
      const served = await serveStatic(url.pathname, res);
      if (served) return;
      const page = await servePage(req, res, url);
      if (page) return;
    }
    writeError(res, failure(404, errorTexts.notFound));
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const user = await loadSession(pool, cookies[SESSION_COOKIE]);

  if (matched.route.access !== 'public' && !user) {
    writeError(res, failure(401, errorTexts.notSignedIn));
    return;
  }
  if (!allowedByRole(matched.route.access, user)) {
    writeError(res, failure(404, errorTexts.notFound));
    return;
  }

  let rawBody = Buffer.alloc(0);
  let body: Record<string, unknown> = {};
  if (matched.route.bodyMode === 'json') {
    rawBody = await collectBody(req, MAX_JSON_BYTES, failure(413, errorTexts.tooLarge));
    body = readJsonBody(rawBody, req.headers['content-type']);
  }

  const ctx: RequestContext = {
    req,
    res,
    url,
    params: matched.params,
    user,
    body,
    rawBody,
  };
  const reply = await matched.route.handler(ctx);
  if (reply.status === 0) return;
  writeReply(res, reply);
}

export function createApp(): Server {
  return createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof ApiError) {
        writeError(res, error);
        return;
      }
      process.stderr.write(`${String(error)}\n`);
      writeError(res, failure(500, 'Something went wrong.'));
    });
  });
}
