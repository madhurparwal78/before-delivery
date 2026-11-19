/**
 * The one order every API request follows, exactly as published.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { App } from '../app.ts';
import { ApiError, fail } from './errors.ts';
import { Ctx, type Router } from './context.ts';
import { sendApiError } from './respond.ts';
import {
  contentTypeOf,
  JSON_BODY_LIMIT,
  parseJsonObject,
  parseMultipart,
  PHOTOGRAPH_FILE_LIMIT,
  readBody,
  SIZE_MESSAGES,
  WORKBOOK_FILE_LIMIT,
} from './request.ts';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The other parts of a photograph request may total the JSON body limit. */
const PHOTOGRAPH_BODY_LIMIT = PHOTOGRAPH_FILE_LIMIT + JSON_BODY_LIMIT;
const WORKBOOK_BODY_LIMIT = WORKBOOK_FILE_LIMIT + JSON_BODY_LIMIT;

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin || origin === 'null') return true;
  const host = request.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function handleApi(
  app: App,
  router: Router,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const ctx = new Ctx(app, request, response, url);
  try {
    // 1. Unknown route, or a method this address does not take.
    const matched = router.match(ctx.method, url.pathname);
    if (Array.isArray(matched)) {
      request.resume();
      throw matched.length > 0 ? fail.methodNotAllowed(allowHeader(matched)) : fail.notFound();
    }
    const { route, params } = matched;
    Object.assign(ctx.params, params);

    // 2. A body or file over its published size limit, before it is parsed and
    // before authentication. A file limit is counted on the file alone, so the
    // parts are split here and kept for step 8.
    let raw = Buffer.alloc(0);
    const fileLimit =
      route.body === 'photograph'
        ? { body: PHOTOGRAPH_BODY_LIMIT, file: PHOTOGRAPH_FILE_LIMIT, message: SIZE_MESSAGES.photograph }
        : route.body === 'workbook'
          ? { body: WORKBOOK_BODY_LIMIT, file: WORKBOOK_FILE_LIMIT, message: SIZE_MESSAGES.workbook }
          : null;

    if (fileLimit) {
      raw = await readBody(request, fileLimit.body, fileLimit.message);
      if (contentTypeOf(request) === 'multipart/form-data') {
        ctx.multipart = parseMultipart(request, raw, fileLimit.file, fileLimit.message);
      }
    } else {
      raw = await readBody(request, JSON_BODY_LIMIT, SIZE_MESSAGES.json);
    }

    // 3. A state-changing request from a foreign origin.
    if (STATE_CHANGING.has(ctx.method) && !sameOrigin(request)) throw fail.foreignOrigin();

    // The desk is read here so a per-desk limit can be counted, but it is only
    // enforced at step 5.
    await ctx.resolveSession();

    // 4. Rate limits.
    if (route.rateLimit) await route.rateLimit(ctx);

    // 5. Authentication.
    if (route.auth === 'required' && !ctx.desk) ctx.authFailure();

    // 6. Unknown resource, or an ended private page.
    if (route.resolve) await route.resolve(ctx);

    // 7 and 8. Content type, then the body itself.
    if (route.body === 'json') {
      if (raw.length > 0 && contentTypeOf(request) !== 'application/json') {
        throw fail.unsupportedMediaType();
      }
      ctx.body = parseJsonObject(raw);
    } else if (fileLimit && ctx.multipart === null) {
      throw fail.unsupportedMediaType();
    }

    // 9 to 11. Field validation, then state, then a stale edit.
    await route.handle(ctx);
  } catch (error) {
    if (error instanceof ApiError) {
      sendApiError(response, error);
      return;
    }
    process.stderr.write(`request failed: ${String(error)}\n`);
    sendApiError(
      response,
      new ApiError(500, 'conflict', 'Something went wrong on the desk.'),
    );
  }
}

function allowHeader(methods: readonly string[]): string {
  const order = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  return [...methods].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(', ');
}
