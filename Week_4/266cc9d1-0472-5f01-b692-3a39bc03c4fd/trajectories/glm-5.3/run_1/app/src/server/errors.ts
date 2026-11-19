/**
 * The one API error shape and the one precedence order. Every error the API
 * produces goes through `apiError`.
 */

export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: FieldErrors;
  from?: string;
  action?: string;

  constructor(status: number, code: string, message: string, extra?: { fields?: FieldErrors; from?: string; action?: string }) {
    super(message);
    this.status = status;
    this.code = code;
    if (extra?.fields) this.fields = extra.fields;
    if (extra?.from) this.from = extra.from;
    if (extra?.action) this.action = extra.action;
  }

  body(): Record<string, unknown> {
    const err: Record<string, unknown> = { code: this.code, message: this.message };
    if (this.fields) err.fields = this.fields;
    if (this.from) err.from = this.from;
    if (this.action) err.action = this.action;
    return { error: err };
  }
}

export function notFound(message = 'Not found.'): ApiError {
  return new ApiError(404, 'not_found', message);
}
export function unauthenticated(): ApiError {
  return new ApiError(401, 'unauthenticated', 'Sign in to continue.');
}
export function forbidden(message = 'You may not do that.'): ApiError {
  return new ApiError(403, 'forbidden', message);
}
export function crossOrigin(): ApiError {
  return new ApiError(403, 'cross_origin', 'Requests from other origins are not allowed.');
}
export function payloadTooLarge(): ApiError {
  return new ApiError(413, 'payload_too_large', 'The request body is too large.');
}
export function unsupportedMediaType(): ApiError {
  return new ApiError(415, 'unsupported_media_type', 'The request body must be JSON.');
}
export function validationFailed(fields: FieldErrors): ApiError {
  return new ApiError(422, 'validation_failed', 'Some fields need attention.', { fields });
}
export function storageUnavailable(): ApiError {
  return new ApiError(503, 'storage_unavailable', 'Tile storage is unreachable.');
}
export function illegalTransition(from: string, action: string): ApiError {
  return new ApiError(409, 'illegal_transition', `Cannot ${action} a ${from} findings set.`, { from, action });
}
export function setNotDraft(): ApiError {
  return new ApiError(409, 'set_not_draft', 'Only a draft findings set can be changed.');
}
export function openSetExists(): ApiError {
  return new ApiError(409, 'open_set_exists', 'This corridor already has a findings set that is not closed.');
}
export function coarserTerrain(): ApiError {
  return new ApiError(409, 'coarser_terrain', 'A finer terrain level is already stored for this finding.');
}
export function assetRejected(): ApiError {
  return new ApiError(409, 'asset_rejected', 'This asset was rejected and cannot take more files.');
}
export function fileAlreadyStored(): ApiError {
  return new ApiError(409, 'file_already_stored', 'This file is already stored with different bytes.');
}
export function checksumMismatch(field: 'size_bytes' | 'sha256', message: string): ApiError {
  return new ApiError(422, 'checksum_mismatch', 'The uploaded bytes did not match the declaration.', { fields: { [field]: message } });
}
export function invalidCzml(): ApiError {
  return new ApiError(422, 'invalid_czml', 'The flight track has no position samples with an epoch and availability.');
}
export function rangeNotSatisfiable(): ApiError {
  return new ApiError(416, 'range_not_satisfiable', 'The requested byte range is outside this file.');
}
export function idempotencyConflict(): ApiError {
  return new ApiError(409, 'idempotency_conflict', 'This Idempotency-Key was used with a different request body.');
}
export function linkNotFound(): ApiError {
  return new ApiError(404, 'link_not_found', 'This review link does not exist.');
}
export function linkRevoked(): ApiError {
  return new ApiError(410, 'link_revoked', 'This review link has been withdrawn. Ask your survey contractor for a new one.');
}
export function linkExpired(): ApiError {
  return new ApiError(410, 'link_expired', 'This review link has expired. Ask your survey contractor for a new one.');
}
export function reviewClosed(): ApiError {
  return new ApiError(409, 'review_closed', 'Decisions for this revision are final.');
}
export function linkNotLive(): ApiError {
  return new ApiError(409, 'link_not_live', 'This review link is not live.');
}
export function invalidAccessCode(): ApiError {
  return new ApiError(401, 'invalid_access_code', 'That access code is not recognised.');
}
