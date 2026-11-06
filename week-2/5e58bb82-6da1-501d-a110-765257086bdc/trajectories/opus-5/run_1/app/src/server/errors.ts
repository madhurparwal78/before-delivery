import type { ApiErrorBody } from '../shared/types.js';

/**
 * The one API error shape. Every error response is built here, so no raw error
 * text, SDK name or stack frame can reach a response.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Omit<ApiErrorBody, 'error' | 'message'>;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    extra: Omit<ApiErrorBody, 'error' | 'message'> = {},
    headers: Record<string, string> = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.headers = headers;
  }

  body(): ApiErrorBody {
    return { error: this.code, message: this.message, ...this.extra };
  }
}

export const STORAGE_UNAVAILABLE_MESSAGE = 'Storage is unavailable. Try again in a moment.';

export function storageUnavailable(): ApiError {
  return new ApiError(503, 'storage_unavailable', STORAGE_UNAVAILABLE_MESSAGE, {}, {
    'Retry-After': '30',
  });
}

export function notFound(): ApiError {
  return new ApiError(404, 'not_found', 'That resource does not exist.');
}

export function forbidden(): ApiError {
  return new ApiError(403, 'forbidden', 'This role may not do that.');
}

export function notMissionOwner(ownerName: string, missionName: string): ApiError {
  return new ApiError(
    403,
    'not_mission_owner',
    `Only ${ownerName} can do this for ${missionName}.`,
  );
}

export function unauthenticated(): ApiError {
  return new ApiError(401, 'unauthenticated', 'Sign in to continue.');
}

export function invalidIngestKey(): ApiError {
  return new ApiError(401, 'invalid_ingest_key', 'That ingest key is not valid.');
}

export function validation(errors: Record<string, string>): ApiError {
  return new ApiError(422, 'validation', 'Some fields need fixing.', { errors });
}

export function conflict(
  code: string,
  message: string,
  extra: Omit<ApiErrorBody, 'error' | 'message'> = {},
): ApiError {
  return new ApiError(409, code, message, extra);
}

export function illegalTransition(from: string, to: string, message: string): ApiError {
  return new ApiError(409, 'illegal_transition', message, { from, to });
}

export function payloadTooLarge(): ApiError {
  return new ApiError(413, 'payload_too_large', 'That request body is too large.');
}

export function unsupportedMediaType(): ApiError {
  return new ApiError(415, 'unsupported_media_type', 'Send this request as JSON.');
}

export function internal(): ApiError {
  return new ApiError(500, 'internal', 'Something went wrong on the server.');
}
