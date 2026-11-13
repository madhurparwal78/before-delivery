import type { IncomingMessage, ServerResponse } from 'node:http';

export type Send = (body: unknown, status?: number, headers?: Record<string, string>) => void;

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  cookies: Record<string, string>;
  send: Send;
  json: unknown;
  rawBody: Buffer;
  params: Record<string, string>;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function errorBody(code: string, message: string, fields?: Record<string, string>): { error: { code: string; message: string; fields?: Record<string, string> } } {
  const error: { code: string; message: string; fields?: Record<string, string> } = { code, message };
  if (fields) error.fields = fields;
  return { error };
}

export const ERRORS = {
  tooLarge: () => new HttpError(413, 'too_large', 'The request body is too large.'),
  unsupportedMedia: () => new HttpError(415, 'unsupported_media_type', 'The request content type is not supported.'),
  unauthenticated: () => new HttpError(401, 'unauthenticated', 'Sign in to continue.'),
  invalidIdentity: () => new HttpError(401, 'invalid_identity', 'This help window could not confirm who you are. Reopen it from the game.'),
  changeRefused: () => new HttpError(403, 'change_refused', 'This request cannot be accepted.'),
  notFound: () => new HttpError(404, 'not_found', "There's nothing here."),
  forbidden: () => new HttpError(403, 'forbidden', 'You may not do that.'),
  invalidCredentials: () => new HttpError(401, 'invalid_credentials', "That email and password don't match."),
  validation: (fields: Record<string, string>) => new HttpError(422, 'validation', 'Some fields need attention.', fields),
  idempotencyMismatch: () => new HttpError(422, 'idempotency_mismatch', 'Send again from the form.'),
  idempotencyInProgress: () => new HttpError(409, 'idempotency_in_progress', 'That send is still being processed.'),
  threadClosed: () => new HttpError(409, 'thread_closed', 'This thread is closed. It reopens when the player writes again.'),
  notAnswered: () => new HttpError(409, 'not_answered', 'Answer the player before closing.'),
  alreadyClosed: () => new HttpError(409, 'already_closed', 'This thread is already closed.'),
  rateLimited: (retryAfter: number) => new HttpError(429, 'rate_limited', "You're writing faster than the inbox can read.", { retry_after: String(retryAfter) }),
  refreshReused: () => new HttpError(401, 'refresh_reused', 'Your session ended. Sign in again.'),
  nonceSeen: () => new HttpError(409, 'nonce_seen', 'This delivery was already accepted.'),
  badSignature: () => new HttpError(401, 'bad_signature', 'The signature did not verify.'),
  staleTimestamp: () => new HttpError(401, 'stale_timestamp', 'The timestamp is outside the 300 s window.'),
  notAttached: () => new HttpError(409, 'not_attached', 'That attachment is not ready to read.'),
};
