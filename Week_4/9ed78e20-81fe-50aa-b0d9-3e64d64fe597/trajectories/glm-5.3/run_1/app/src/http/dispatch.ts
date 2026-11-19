import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../config.js';
import { ApiError, errors } from '../platform/errors.js';
import { withClient, testDatabase } from '../platform/db.js';
import { parseUrl, sendJson, clientAddress, parseCookies } from './plumbing.js';
import { sessionFromCookie, type Session } from './session.js';
import { rateLimitAndHeaders } from '../platform/rate-gate.js';
import type { BucketName } from '../platform/ratelimit.js';

export type RequestCtx = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  cookies: Record<string, string>;
  client: import('../platform/db.js').DbClient;
  session: Session | null;
  rateHeaders: Record<string, string>;
  setCookies: string[];
};

export type Handler = (ctx: RequestCtx) => Promise<void>;

const JSON_MAX = 100000;
const MULTIPART_MAX = 6000000;

export function jsonMaxBytes(): number {
  return JSON_MAX;
}

export function multipartMaxBytes(): number {
  return MULTIPART_MAX;
}

function isPublicAsset(path: string): boolean {
  return (
    path.startsWith('/assets/') ||
    path.startsWith('/media/samples/') ||
    path === '/robots.txt'
  );
}

function countedPublic(path: string): boolean {
  if (path === '/api/health' || path === '/api/ready') return false;
  if (isPublicAsset(path) && !path.startsWith('/media/samples/')) return false;
  return true;
}

export async function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
  routes: { public: Handler; console: Handler; candidate: Handler },
): Promise<void> {
  const { path, query } = parseUrl(req);
  const method = (req.method ?? 'GET').toUpperCase();

  // Never serve source files or credentials.
  if (
    path.includes('..') ||
    path === '/run.json' ||
    path === '/package.json' ||
    path === '/package-lock.json' ||
    path.startsWith('/src/') ||
    path.startsWith('/tsconfig') ||
    path === '/.env' ||
    path.startsWith('/dist/') ||
    path === '/THIRD_PARTY_NOTICES.md'
  ) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify({ error: 'not_found', message: 'Nothing is published at this address.' }));
    return;
  }

  const dbUp = await testDatabase();
  if (!dbUp) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify({ error: 'database_unavailable', message: 'The record is unavailable right now.' }));
    return;
  }

  try {
    await withClient(async (client) => {
      const cookies = parseCookies(req);
      let session: Session | null = null;
      const consolePath = path.startsWith('/console') || path.startsWith('/api/console');
      if (consolePath && cookies['open_record_session']) {
        session = await sessionFromCookie(client, cookies['open_record_session']);
      }

      const addr = clientAddress(req, config.trustForwardedFor);

      // Bucket selection.
      let bucket: BucketName | null = null;
      if (path.startsWith('/api/console')) {
        if (path === '/api/console/session' && method === 'POST') {
          bucket = 'signin';
        } else if (method !== 'GET' && method !== 'HEAD') {
          bucket = 'console';
        }
      } else if (
        path.startsWith('/api/track') ||
        path.startsWith('/api/careers') ||
        path.startsWith('/track/')
      ) {
        bucket = 'candidate';
      } else if (countedPublic(path)) {
        bucket = 'public';
      }

      let rateHeaders: Record<string, string> = {};
      let bucketKey = addr;
      if (bucket === 'console' && session) bucketKey = session.email;
      if (bucket) {
        const { headers } = await rateLimitAndHeaders(client, bucket, bucketKey, true);
        rateHeaders = headers;
      }

      const ctx: RequestCtx = {
        req,
        res,
        method,
        path,
        query,
        cookies,
        client,
        session,
        rateHeaders,
        setCookies: [],
      };

      // Origin check for state-changing console requests.
      if (path.startsWith('/api/console') && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
        const origin = req.headers.origin;
        if (origin) {
          const allowed = new URL(config.publicBaseUrl).origin;
          if (origin !== allowed) {
            throw errors.crossOrigin();
          }
        }
      }

      if (path.startsWith('/api/console') || path.startsWith('/console')) {
        await routes.console(ctx);
      } else if (path.startsWith('/api/careers') || path.startsWith('/api/track') || path.startsWith('/track/')) {
        await routes.candidate(ctx);
      } else {
        await routes.public(ctx);
      }
    });
  } catch (e) {
    handleError(res, e);
  }
}

export function handleError(res: ServerResponse, e: unknown, rateHeaders: Record<string, string> = {}): void {
  if (res.writableEnded) return;
  if (e instanceof ApiError) {
    const body: Record<string, unknown> = { error: e.code, message: e.message };
    if (e.fields) body.fields = e.fields;
    sendJson(res, e.status, body, { ...rateHeaders, ...(e.headers ?? {}) });
    return;
  }
  console.error('unhandled error:', e);
  sendJson(res, 500, { error: 'internal', message: 'Something went wrong on our side.' }, rateHeaders);
}
