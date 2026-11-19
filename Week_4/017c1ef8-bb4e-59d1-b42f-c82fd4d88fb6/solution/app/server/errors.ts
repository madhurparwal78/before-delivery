interface ErrorBody {
  error: string;
  [key: string]: unknown;
}

/** The one error shape: every failure carries a status and a JSON body with an `error` string. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(body.error);
  }
}

export const unauthenticated = () => new HttpError(401, { error: 'unauthenticated' });
export const notFound = () => new HttpError(404, { error: 'not_found' });
export const forbidden = (code: string) => new HttpError(403, { error: code });
export const conflict = (code: string, extra: Record<string, unknown> = {}) => new HttpError(409, { error: code, ...extra });
export const validation = (fields: Record<string, string>) => new HttpError(422, { error: 'validation', fields });
export const unprocessable = (code: string, extra: Record<string, unknown> = {}) => new HttpError(422, { error: code, ...extra });
export const tooManyRequests = (code: string, extra: Record<string, unknown> = {}) => new HttpError(429, { error: code, ...extra });
export const storageUnavailable = () => new HttpError(503, { error: 'storage_unavailable' });
export const crossOrigin = () => new HttpError(403, { error: 'cross_origin' });
const payloadTooLarge = () => new HttpError(413, { error: 'payload_too_large' });
export const unsupportedMediaType = () => new HttpError(415, { error: 'unsupported_media_type' });
export const malformedJson = () => new HttpError(400, { error: 'malformed_json' });
const badRequest = () => new HttpError(400, { error: 'bad_request' });
const internal = () => new HttpError(500, { error: 'internal' });

/** PostgreSQL error code for text that holds a NUL byte: an id, handle or text that carries one names nothing. */
const NUL_BYTE_IN_TEXT = '22021';

/** Maps anything thrown while serving a request to the one error shape. */
export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code: unknown }).code : undefined;
  if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') return payloadTooLarge();
  if (code === 'FST_ERR_CTP_INVALID_CONTENT_LENGTH') return badRequest();
  if (code === NUL_BYTE_IN_TEXT || code === 'FST_ERR_BAD_URL' || code === 'FST_ERR_MAX_PARAM_LENGTH') return notFound();
  return internal();
}
