import type { Card } from '../shared/types.ts';

/** The one error shape: every refusal the API sends is built here and matches the error catalogue. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
    readonly headers: Record<string, string> = {},
  ) {
    super(String(body['error']));
  }
}

const plain = (status: number, error: string): ApiError => new ApiError(status, { error });

export const signedOut = (): ApiError => plain(401, 'signed_out');
export const invalidCredentials = (): ApiError => plain(401, 'invalid_credentials');
export const forbidden = (): ApiError => plain(403, 'forbidden');
export const crossOrigin = (): ApiError => plain(403, 'cross_origin');
export const notFound = (): ApiError => plain(404, 'not_found');
export const methodNotAllowed = (allow: string[]): ApiError =>
  new ApiError(405, { error: 'method_not_allowed' }, { Allow: allow.join(', ') });
export const stale = (card: Card, changedBy: string, change: 'moved' | 'edited'): ApiError =>
  new ApiError(409, { error: 'stale', card, changedBy: { displayName: changedBy }, change });
export const invalidTransition = (from: string, to: string): ApiError =>
  new ApiError(409, { error: 'invalid_transition', from, to });
export const conflict = (
  code: 'archived' | 'last_admin' | 'already_member' | 'no_change' | 'email_taken' | 'idempotency_conflict',
): ApiError => plain(409, code);
export const tooLarge = (): ApiError => plain(413, 'too_large');
export const unsupportedMediaType = (): ApiError => plain(415, 'unsupported_media_type');
export const validation = (fields: Record<string, string>): ApiError =>
  new ApiError(422, { error: 'validation', fields });
export const internal = (): ApiError => plain(500, 'internal');
export const storageUnavailable = (): ApiError => plain(503, 'storage_unavailable');
