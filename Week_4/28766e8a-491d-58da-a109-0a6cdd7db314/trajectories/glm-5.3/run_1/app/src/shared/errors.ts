import type { Response } from '../server/http.js';

export type ErrorCode =
  | 'unauthenticated' | 'not_found' | 'forbidden_role' | 'save_unavailable'
  | 'shape_deleted' | 'connector_deleted' | 'layer_locked' | 'op_conflict'
  | 'already_member' | 'already_invited' | 'invite_closed' | 'owner_role'
  | 'already_resolved' | 'export_not_ready' | 'export_not_retryable'
  | 'email_taken' | 'bad_credentials' | 'too_large' | 'unsupported_media_type'
  | 'cross_origin' | 'invalid';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const NOT_FOUND_MESSAGE = 'Diagram not found.';

export function notFound(): ApiError {
  return new ApiError(404, 'not_found', NOT_FOUND_MESSAGE);
}

export function unauthenticated(): ApiError {
  return new ApiError(401, 'unauthenticated', 'Sign in to continue.');
}

export function forbiddenRole(): ApiError {
  return new ApiError(403, 'forbidden_role', 'You cannot edit this diagram.');
}

export function saveUnavailable(): ApiError {
  return new ApiError(503, 'save_unavailable', 'Saving is temporarily unavailable.');
}

export function invalid(fields?: Record<string, string>): ApiError {
  const message = fields
    ? Object.entries(fields)[0]?.[1] ?? 'Invalid request.'
    : 'Invalid request.';
  return new ApiError(422, 'invalid', message, fields);
}

export function errorBody(err: ApiError): Record<string, unknown> {
  const body: Record<string, unknown> = {
    error: { code: err.code, message: err.message },
  };
  if (err.fields && Object.keys(err.fields).length > 0) {
    (body['error'] as Record<string, unknown>)['fields'] = err.fields;
  }
  return body;
}

export function sendError(res: Response, err: ApiError): void {
  res.status(err.status).json(errorBody(err));
}
