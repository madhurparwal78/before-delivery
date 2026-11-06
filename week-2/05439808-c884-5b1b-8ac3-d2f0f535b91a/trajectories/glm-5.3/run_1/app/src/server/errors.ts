// The one published error shape. Every error response in the app is built here.
import type { ServerResponse } from 'node:http';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export const errors = {
  internal: () => new ApiError(500, 'internal', 'Something went wrong.'),
  malformedJson: () => new ApiError(400, 'malformed_json', 'The request body is not valid JSON.'),
  payloadTooLarge: () => new ApiError(413, 'payload_too_large', 'The request body is too large.'),
  unsupportedMediaType: () => new ApiError(415, 'unsupported_media_type', 'Send JSON only.'),
  databaseUnavailable: () =>
    new ApiError(503, 'database_unavailable', 'The tide records are out of reach. Nothing was changed — try again in a moment.'),
  unauthenticated: () => new ApiError(401, 'unauthenticated', 'Sign in to do that.'),
  invalidCredentials: () => new ApiError(401, 'invalid_credentials', 'That email and password don’t match an account.'),
  invalidToken: () => new ApiError(400, 'invalid_token', 'This link is expired or already used.'),
  csrfFailed: () => new ApiError(403, 'csrf_failed', 'This page is out of date. Reload and try again.'),
  forbidden: () => new ApiError(403, 'forbidden', 'You may not do that.'),
  emailNotVerified: () => new ApiError(403, 'email_not_verified', 'Confirm your email to raid and join clans.'),
  notFound: () => new ApiError(404, 'not_found', 'We couldn’t find that. It may have moved, or it isn’t yours to see.'),
  rateLimited: (retryAfterSeconds: number) =>
    new ApiError(429, 'rate_limited', `Too many tries. Try again in ${retryAfterSeconds} s.`, {
      retryAfter: retryAfterSeconds,
    }),
  validation: (fieldErrors: Record<string, string>) =>
    new ApiError(422, 'validation_failed', 'Check the highlighted fields.', { errors: fieldErrors }),
  conflict: (code: string, message: string, extra: Record<string, unknown> = {}) =>
    new ApiError(409, code, message, extra),
};

export function sendError(res: ServerResponse, err: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const api = err instanceof ApiError ? err : errors.internal();
  const body: Record<string, unknown> = { error: api.code, message: api.message };
  for (const [k, v] of Object.entries(api.extra)) body[k] = v;
  if (api.status === 429 && typeof api.extra.retryAfter === 'number') {
    res.setHeader('Retry-After', String(api.extra.retryAfter));
  }
  respondJson(res, api.status, body);
}

export function respondJson(res: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body), 'utf-8');
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', data.length);
  res.end(data);
}
