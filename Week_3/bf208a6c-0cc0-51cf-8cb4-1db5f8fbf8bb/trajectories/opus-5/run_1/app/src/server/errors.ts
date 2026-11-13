import type { ServiceName } from '../shared/types';

export type ErrorBody = Record<string, unknown>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(`api_error_${status}`);
  }
}

export const crossOrigin = (): ApiError => new ApiError(403, { error: 'cross_origin' });
export const bodyTooLarge = (): ApiError => new ApiError(413, { error: 'body_too_large' });
export const notFound = (): ApiError => new ApiError(404, { error: 'not_found' });
export const passwordRequired = (): ApiError => new ApiError(403, { error: 'password_required' });
export const signInRequired = (): ApiError => new ApiError(401, { error: 'sign_in_required' });
export const forbidden = (): ApiError => new ApiError(403, { error: 'forbidden' });
export const wrongCredentials = (): ApiError => new ApiError(401, { error: 'wrong_credentials' });
export const unconfirmed = (): ApiError => new ApiError(403, { error: 'unconfirmed' });
export const inviteExpired = (): ApiError => new ApiError(410, { error: 'invite_expired' });
export const notHeld = (): ApiError => new ApiError(409, { error: 'not_held' });
export const notPublished = (): ApiError => new ApiError(409, { error: 'not_published' });
export const moveConflict = (post: { section_id: string; position: number | null; version: number }, movedBy: string): ApiError =>
  new ApiError(409, { error: 'conflict', post, moved_by: movedBy });
export const fileTooLarge = (): ApiError => new ApiError(413, { error: 'file_too_large' });
export const unsupportedType = (): ApiError => new ApiError(415, { error: 'unsupported_type' });
export const invalid = (errors: Record<string, string>): ApiError => new ApiError(422, { errors });
export const serviceUnavailable = (service: Extract<ServiceName, 'storage' | 'mail'>): ApiError =>
  new ApiError(503, { error: service === 'storage' ? 'storage_unavailable' : 'mail_unavailable' });
