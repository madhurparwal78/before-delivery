import type { ApiError } from '../../shared/types.js';

/** Every API error is built here, including the 500. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { fields?: Record<string, string>; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = options.fields;
    this.headers = options.headers;
  }

  body(): ApiError {
    const error: ApiError['error'] = { code: this.code, message: this.message };
    if (this.fields !== undefined) error.fields = this.fields;
    return { error };
  }
}

export function validationFailed(fields: Record<string, string>): HttpError {
  return new HttpError(422, 'validation_failed', 'Check the highlighted fields.', { fields });
}

export const internalError = (): HttpError =>
  new HttpError(500, 'internal_error', 'Something went wrong. Try again.');

export const notFound = (thing: string): HttpError =>
  new HttpError(404, thing === '' ? 'not_found' : `${thing}_not_found`, 'Not found.');

export const unauthenticated = (): HttpError =>
  new HttpError(401, 'unauthenticated', 'Sign in to continue.');

export const payloadTooLarge = (): HttpError =>
  new HttpError(413, 'payload_too_large', 'That request is too large.');

export const unsupportedMediaType = (): HttpError =>
  new HttpError(415, 'unsupported_media_type', 'Send this request as JSON.');

export const crossSiteRequest = (): HttpError =>
  new HttpError(403, 'cross_site_request', 'This request did not come from Skinout.');

export const storageUnavailable = (): HttpError =>
  new HttpError(503, 'storage_unavailable', 'Storage is unavailable. Try again later.');

export const printingUnavailable = (): HttpError =>
  new HttpError(503, 'printing_unavailable', 'Printing is unavailable. Try again later.');

export const conflict = (code: string, message: string): HttpError =>
  new HttpError(409, code, message);
