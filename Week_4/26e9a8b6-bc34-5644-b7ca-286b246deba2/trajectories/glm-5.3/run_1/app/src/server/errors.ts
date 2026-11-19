// One error shape and one precedence for every API error.

export interface ApiError {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

export function apiError(status: number, body: Record<string, unknown>, headers?: Record<string, string>): ApiError {
  return { status, body, headers };
}

export const errors = {
  notFound: (): ApiError => apiError(404, { error: 'not_found' }),
  notSignedIn: (): ApiError => apiError(401, { error: 'not_signed_in' }),
  withdrawn: (): ApiError => apiError(410, { error: 'withdrawn' }),
  forbidden: (): ApiError => apiError(403, { error: 'forbidden' }),
  unconfirmed: (): ApiError => apiError(403, { error: 'unconfirmed' }),
  methodNotAllowed: (allow: string[]): ApiError =>
    apiError(405, { error: 'method_not_allowed' }, { Allow: allow.join(', ') }),
  unsupportedMediaType: (): ApiError => apiError(415, { error: 'unsupported_media_type' }),
  bodyTooLarge: (limit: number): ApiError => apiError(413, { error: 'body_too_large', limit }),
  tooDeep: (): ApiError => apiError(422, { error: 'too_deep' }),
  tooLong: (field: string, limit: number): ApiError => apiError(422, { error: 'too_long', field, limit }),
  tooMany: (field: string, limit: number): ApiError => apiError(422, { error: 'too_many', field, limit }),
  invalid: (field: string): ApiError => apiError(422, { error: 'invalid', field }),
  rateLimited: (retryAfter: number): ApiError =>
    apiError(429, { error: 'rate_limited', retry_after: retryAfter }, { 'Retry-After': String(Math.ceil(retryAfter)) }),
  editConflict: (field: string, yours: unknown, theirs: { value: unknown; revision: number; by: string }): ApiError =>
    apiError(409, { error: 'edit_conflict', field, yours, theirs }),
  versionConflict: (current: number, fields: string[]): ApiError =>
    apiError(409, { error: 'version_conflict', current, fields }),
  illegalTransition: (from: string, to: string): ApiError =>
    apiError(409, { error: 'illegal_transition', from, to }),
  alreadyAnswered: (): ApiError => apiError(409, { error: 'already_answered' }),
  alreadyInCollection: (): ApiError => apiError(409, { error: 'already_in_collection' }),
  emailTaken: (): ApiError => apiError(409, { error: 'email_taken' }),
  badCredentials: (): ApiError => apiError(401, { error: 'bad_credentials' }),
  tokenInvalid: (): ApiError => apiError(410, { error: 'token_invalid' }),
  alreadyConfirmed: (): ApiError => apiError(409, { error: 'already_confirmed' }),
  mailUnavailable: (): ApiError => apiError(503, { error: 'mail_unavailable' }),
  storageUnavailable: (): ApiError => apiError(503, { error: 'storage_unavailable' }),
  modelTooLarge: (limit: number): ApiError => apiError(413, { error: 'model_too_large', limit }),
  notGlb: (): ApiError => apiError(422, { error: 'not_glb' }),
  externalUri: (): ApiError => apiError(422, { error: 'external_uri' }),
  tooManyParts: (count: number, limit: number): ApiError =>
    apiError(422, { error: 'too_many_parts', count, limit }),
  queryTooLong: (limit: number): ApiError => apiError(422, { error: 'query_too_long', limit }),
  tooManyTags: (limit: number): ApiError => apiError(422, { error: 'too_many_tags', limit }),
  searchTimeout: (): ApiError => apiError(503, { error: 'search_timeout' }),
  publishChecks: {
    noVersion: (): ApiError => apiError(422, { error: 'no_version' }),
    modelNotStored: (): ApiError => apiError(422, { error: 'model_not_stored' }),
    unboundParts: (parts: string[]): ApiError => apiError(422, { error: 'unbound_parts', parts }),
    scaleUnconfirmed: (): ApiError => apiError(422, { error: 'scale_unconfirmed' }),
  },
};

export function isApiError(value: unknown): value is ApiError {
  return typeof value === 'object' && value !== null && 'status' in value && 'body' in value;
}
