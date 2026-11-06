export type ErrorCode =
  | 'cross_origin'
  | 'unsupported_media_type'
  | 'too_large'
  | 'unauthenticated'
  | 'not_found'
  | 'forbidden'
  | 'already_shared'
  | 'share_ended'
  | 'not_open'
  | 'not_resolved'
  | 'conflict'
  | 'invalid'
  | 'invalid_credentials'
  | 'storage_unavailable'
  | 'not_joined';

/** The single error shape for HTTP responses and socket error frames. */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: ErrorCode, fields?: Record<string, string>) {
    super(code);
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields;
  }

  body(): { error: ErrorCode; fields?: Record<string, string> } {
    return this.fields ? { error: this.code, fields: this.fields } : { error: this.code };
  }
}

export const crossOrigin = (): AppError => new AppError(403, 'cross_origin');
export const unsupportedMediaType = (): AppError => new AppError(415, 'unsupported_media_type');
export const tooLarge = (): AppError => new AppError(413, 'too_large');
export const unauthenticated = (): AppError => new AppError(401, 'unauthenticated');
export const notFound = (): AppError => new AppError(404, 'not_found');
export const forbidden = (): AppError => new AppError(403, 'forbidden');
export const conflict = (code: ErrorCode): AppError => new AppError(409, code);
export const invalid = (fields: Record<string, string>): AppError => new AppError(422, 'invalid', fields);
export const invalidFrame = (): AppError => new AppError(422, 'invalid');
export const storageUnavailable = (): AppError => new AppError(503, 'storage_unavailable');

/** Socket error codes are the HTTP codes narrowed to the set the socket uses. */
export function socketCode(error: AppError): string {
  switch (error.code) {
    case 'not_found':
      return 'not_found';
    case 'forbidden':
    case 'cross_origin':
      return 'forbidden';
    case 'already_shared':
    case 'share_ended':
    case 'not_open':
    case 'not_resolved':
    case 'conflict':
      return 'conflict';
    case 'too_large':
      return 'too_large';
    case 'not_joined':
      return 'not_joined';
    default:
      return 'invalid';
  }
}
