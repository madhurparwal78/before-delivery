import type { Role } from '../shared/types.js';

export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(`api_error_${status}`);
    this.status = status;
    this.body = body;
  }
}

const simple = (status: number, code: string): ApiError => new ApiError(status, { error: code });

export const notFound = (): ApiError => simple(404, 'not_found');
export const passwordRequired = (): ApiError => simple(403, 'password_required');
export const crossOrigin = (): ApiError => simple(403, 'cross_origin');
export const bodyTooLarge = (): ApiError => simple(413, 'body_too_large');
export const signInRequired = (): ApiError => simple(401, 'sign_in_required');
export const forbidden = (): ApiError => simple(403, 'forbidden');
export const fileTooLarge = (): ApiError => simple(413, 'file_too_large');
export const unsupportedType = (): ApiError => simple(415, 'unsupported_type');
export const storageUnavailable = (): ApiError => simple(503, 'storage_unavailable');
export const mailUnavailable = (): ApiError => simple(503, 'mail_unavailable');
export const notHeld = (): ApiError => new ApiError(409, { error: 'not_held' });
export const notPublished = (): ApiError => new ApiError(409, { error: 'not_published' });
export const inviteExpired = (): ApiError => new ApiError(410, { error: 'invite_expired' });
export const wrongCredentials = (): ApiError => new ApiError(401, { error: 'wrong_credentials' });
export const unconfirmed = (): ApiError => new ApiError(403, { error: 'unconfirmed' });

export function validation(fields: Record<string, string>): ApiError {
  return new ApiError(422, { errors: fields });
}

export function conflict(sectionId: string, position: number, version: number, movedBy: string): ApiError {
  return new ApiError(409, {
    error: 'conflict',
    post: { section_id: sectionId, position, version },
    moved_by: movedBy,
  });
}

export function outOfRangePosition(max: number): ApiError {
  return validation({ position: `Position must be between 1 and ${max}.` });
}

export const sortLocksOrder = (label: string): ApiError =>
  validation({ position: `Order is set by ${label}. Choose By hand to reorder.` });

export const groupBlocksMoving = (): ApiError =>
  validation({ position: 'Moving is off while posts are grouped by author.' });

export function missingPermission(role: Role): never {
  throw forbidden();
}
