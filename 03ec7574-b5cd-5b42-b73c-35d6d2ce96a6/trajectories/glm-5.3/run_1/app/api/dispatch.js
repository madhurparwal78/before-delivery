import { ApiError, errors, envelope } from '../lib/http.js';
import { newRequestId, sha256Hex } from '../lib/core.js';
import { withClient, isReady } from '../lib/db.js';
import { resolveCredential } from '../lib/session.js';
import {
  readBody, parseCookies, jsonContentTypeOk, requireCredential, requireAppIdHeader, isDbError,
} from './pipeline.js';
import { validateIdempotencyKey } from './idempotency.js';
import { coreRoutes } from './routes-core.js';
import { moneyRoutes } from './routes-money.js';
import { adminRoutes } from './routes-admin.js';

export const ALL_ROUTES = [...coreRoutes, ...moneyRoutes, ...adminRoutes];

export async function handleApi(req, res, pathname, query) {
  const requestId = newRequestId();
  let rawBody = Buffer.alloc(0);
  let body = {};

  const sendJson = (status, bodyString, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(bodyString);
  };
  const sendRaw = (status, text, headers = {}) => {
    res.writeHead(status, headers);
    res.end(text);
  };
  const fail = (err, extra = {}) => {
    const e = err instanceof ApiError ? err : new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    sendJson(e.status, envelope(false, null, e, requestId), extra);
  };
  const send = (status, data, headers = {}) => {
    sendJson(status, envelope(true, data, null, requestId), headers);
  };
  const sendErr = (status, errorObj, headers = {}) => {
    sendJson(status, envelope(false, null, { code: errorObj.code, message: errorObj.message, details: errorObj.details }, requestId), headers);
  };

  try {
    const read = await readBody(req);
    rawBody = read.buffer;
    if (read.tooLarge) throw errors.payloadTooLarge();
    const hasBody = rawBody.length > 0;
    if (hasBody && !jsonContentTypeOk(req)) throw errors.unsupportedMedia();
    if (hasBody) {
      let parsed;
      try {
        parsed = JSON.parse(rawBody.toString('utf8'));
      } catch {
        throw errors.malformedJson();
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw errors.validation('body', 'Send a JSON object');
      }
      body = parsed;
    }

    if (req.method === 'GET' && pathname === '/api/health') {
      try {
        await withClient((client) => client.query('SELECT 1'));
        sendRaw(200, '{"status":"ok"}', { 'Content-Type': 'application/json; charset=utf-8' });
      } catch {
        sendRaw(503, JSON.stringify({ status: isReady() ? 'unavailable' : 'starting' }),
          { 'Content-Type': 'application/json; charset=utf-8' });
      }
      return;
    }

    const route = ALL_ROUTES.find((r) => r.method === req.method && r.pattern.test(pathname));
    if (!route) throw new ApiError(404, 'NOT_FOUND', 'No such route.');
    const params = pathname.match(route.pattern).slice(1);

    let ctx = null;
    if (route.auth !== 'public') {
      const appId = requireAppIdHeader(req);
      const cookies = parseCookies(req);
      const token = requireCredential(req, cookies);
      ctx = await withClient(async (client) => {
        const c = await resolveCredential(client, token);
        const { rows: [org] } = await client.query(
          'SELECT app_id FROM organizations WHERE id = $1', [c.organization_id]);
        c.orgAppId = org ? org.app_id : null;
        return c;
      });
      ctx.token = token;
      ctx.tokenHash = sha256Hex(token);
      if (appId !== ctx.orgAppId) throw errors.appIdMismatch();
      if (!passesRole(ctx, route.auth)) throw errors.forbiddenRole();
      ctx.idempotencyKey = route.idempotent
        ? validateIdempotencyKey(req.headers['idempotency-key'])
        : null;
    }

    await route.handler(ctx, {
      req: { pathname }, params, query, body, rawBody,
      send, sendRaw, sendErr, requestId,
      setCookie: (v) => res.setHeader('Set-Cookie', v),
      clearCookie: (n) => res.setHeader('Set-Cookie', `${n}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`),
    });
  } catch (err) {
    if (isDbError(err)) {
      fail(errors.databaseUnavailable());
      return;
    }
    fail(err);
  }
}

function passesRole(ctx, spec) {
  if (spec === 'public' || spec === 'any' || spec === 'readers') return true;
  if (spec === 'members') return ctx.kind === 'member';
  if (Array.isArray(spec)) {
    const role = ctx.kind === 'api_key' ? ctx.apiKey.role : ctx.member.role;
    return spec.includes(role);
  }
  return false;
}
