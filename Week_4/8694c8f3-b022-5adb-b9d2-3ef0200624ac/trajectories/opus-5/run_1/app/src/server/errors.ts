import { COPY } from '../shared/domain.js';

/** The one error shape for the whole API. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  body(): { error: Record<string, unknown> } {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export function validation(fields: Record<string, string>, message?: string): ApiError {
  const first = Object.values(fields)[0] ?? 'Invalid request';
  return new ApiError(422, 'validation', message ?? first, { fields });
}

export function fieldError(field: string, message: string): ApiError {
  return validation({ [field]: message });
}

export const Err = {
  tooLarge: () => new ApiError(413, 'too_large', 'Request body is too large'),
  unsupportedMediaType: () => new ApiError(415, 'unsupported_media_type', 'Unsupported content type'),
  unauthenticated: () => new ApiError(401, 'unauthenticated', 'Sign in to continue'),
  notFound: () => new ApiError(404, 'not_found', 'Not found'),
  forbidden: () => new ApiError(403, 'forbidden', 'Your role may not do this'),
  storageUnavailable: () => new ApiError(503, 'storage_unavailable', COPY.storageBanner),
  collabOffline: () => new ApiError(503, 'collab_offline', COPY.collabBanner),
  badJson: () => new ApiError(422, 'validation', 'Request body must be a JSON object', { fields: { body: 'Request body must be a JSON object' } }),
};
