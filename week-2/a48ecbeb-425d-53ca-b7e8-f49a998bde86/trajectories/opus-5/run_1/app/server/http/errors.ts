import { apiMessages } from '../../shared/copy.js';

export interface ApiErrorBody {
  error: string;
  message: string;
  [extra: string]: unknown;
}

/** The only error type the API throws, and the only shape it serialises to. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  body(): ApiErrorBody {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export function validationError(fields: Record<string, string>): ApiError {
  return new ApiError(422, 'validation', apiMessages.validation, { fields });
}

export function conflict(
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): ApiError {
  return new ApiError(409, code, message, extra);
}

export const notFound = (): ApiError => new ApiError(404, 'not_found', apiMessages.notFound);
export const forbidden = (): ApiError => new ApiError(403, 'forbidden', apiMessages.forbidden);
export const unauthenticated = (): ApiError =>
  new ApiError(401, 'unauthenticated', apiMessages.unauthenticated);
export const crossOrigin = (): ApiError => new ApiError(403, 'cross_origin', apiMessages.crossOrigin);
export const tooLarge = (): ApiError => new ApiError(413, 'too_large', apiMessages.tooLarge);
export const unsupportedType = (): ApiError =>
  new ApiError(415, 'unsupported_type', apiMessages.unsupportedType);

export const storeUnavailable = (): ApiError =>
  new ApiError(503, 'store_unavailable', apiMessages.storeUnavailable);
export const accountsUnavailable = (): ApiError =>
  new ApiError(503, 'accounts_unavailable', apiMessages.accountsUnavailable);
export const filesUnavailable = (message: string = apiMessages.filesUnavailable): ApiError =>
  new ApiError(503, 'files_unavailable', message);
export const billingUnavailable = (message: string): ApiError =>
  new ApiError(503, 'billing_unavailable', message);
