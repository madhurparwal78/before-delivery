import type { Response } from 'express';
import { ApiError, ValidationError } from './errors.js';

/** The single error shape: `{"errors":{...}}` for validation, `{"error","message"}` otherwise. */
export function sendError(res: Response, err: unknown): void {
  if (err instanceof ValidationError) {
    res.status(err.status).json(err.body);
    return;
  }
  if (err instanceof ApiError) {
    res.status(err.status).json(err.body);
    return;
  }
  if (isPayloadTooLarge(err)) {
    res.status(413).json({ error: 'payload_too_large', message: 'The request is too large.' });
    return;
  }
  console.error('unhandled error', err);
  res.status(500).json({ error: 'internal', message: 'Something went wrong.' });
}

function isPayloadTooLarge(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    (err as { type?: unknown }).type === 'entity.too.large'
  );
}

export function sessionCookie(token: string, clear = false): string {
  const parts = [
    `tempoline_session=${clear ? '' : token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (clear) parts.push('Max-Age=0');
  else parts.push('Max-Age=15552000');
  return parts.join('; ');
}