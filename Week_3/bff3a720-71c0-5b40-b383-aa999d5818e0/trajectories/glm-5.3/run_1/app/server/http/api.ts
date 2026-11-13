import type { Ctx, Router } from './router.js';
import { sendError, sendJson, parseCookies } from './router.js';
import { ApiError, unauthenticated } from './errors.js';
import { readBody, JSON_MAX_BYTES } from './body.js';

export async function handleApi(ctxParams: {
  req: import('http').IncomingMessage;
  res: import('http').ServerResponse;
  router: Router;
  sessionLookup: (token: string) => Promise<{ id: string } | null>;
}): Promise<boolean> {
  const { req, res, router, sessionLookup } = ctxParams;
  const url = new URL(req.url ?? '/', 'http://local');
  if (!url.pathname.startsWith('/api/')) return false;

  const ctx: Ctx = {
    req,
    res,
    method: req.method ?? 'GET',
    path: url.pathname,
    query: url.searchParams,
    params: {},
    body: undefined,
    rawBody: Buffer.alloc(0),
    cookies: parseCookies(req.headers.cookie),
    memberId: null,
  };

  try {
    const matched = router.match(ctx.method, ctx.path);
    if (!matched) throw new ApiError(404, 'not_found');

    if (matched.route.json && (ctx.method === 'POST' || ctx.method === 'PATCH' || ctx.method === 'PUT' || ctx.method === 'DELETE')) {
      ctx.rawBody = await readBody(req, res, JSON_MAX_BYTES);
      const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim();
      if (contentType !== 'application/json') throw new ApiError(415, 'unsupported_media_type');
      if (ctx.rawBody.length > 0) {
        try {
          ctx.body = JSON.parse(ctx.rawBody.toString('utf8'));
        } catch {
          throw new ApiError(422, 'validation_failed', 'Check the highlighted fields.', { body: 'Send a JSON object.' });
        }
      }
    }

    const sessionToken = ctx.cookies['ls_session'];
    if (sessionToken) {
      const member = await sessionLookup(sessionToken);
      if (member) ctx.memberId = member.id;
    }

    if (matched.route.needsMember && ctx.memberId === null) throw unauthenticated();

    ctx.params = matched.params;
    try {
      const result = await matched.route.handler(ctx);
      if (result === null || res.writableEnded) return true;
      if (typeof result === 'object' && result !== null && 'status' in result && 'payload' in result) {
        const r = result as { status: number; payload: unknown; headers?: Record<string, string> };
        if (r.status === 204) {
          res.writeHead(204);
          res.end();
          return true;
        }
        sendJson(res, r.status, r.payload, r.headers ?? {});
        return true;
      }
      if (!res.writableEnded) sendJson(res, 200, result ?? {});
      return true;
    } catch (e) {
      if (!res.headersSent) sendError(res, e);
      else if (!res.writableEnded) res.end();
      return true;
    }
  } catch (e) {
    sendError(res, e);
    return true;
  }
}
