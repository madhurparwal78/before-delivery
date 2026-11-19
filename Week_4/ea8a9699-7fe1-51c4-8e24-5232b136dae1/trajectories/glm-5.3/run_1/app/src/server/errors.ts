import type { ClusterStatus } from '../shared/types.js';

export type ErrorCode =
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'cross_origin'
  | 'forbidden'
  | 'seat_required'
  | 'read_only_link'
  | 'not_found'
  | 'illegal_transition'
  | 'cluster_locked'
  | 'cluster_not_in_review'
  | 'already_in_cluster'
  | 'no_seats_left'
  | 'idempotency_conflict'
  | 'idempotency_in_progress'
  | 'link_expired'
  | 'link_revoked'
  | 'link_inactive'
  | 'invite_used'
  | 'stale_order'
  | 'too_large'
  | 'unsupported_media_type'
  | 'validation'
  | 'rate_limited'
  | 'storage_unavailable'
  | 'mail_unavailable'
  | 'billing_unavailable';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly body: Record<string, unknown>;

  constructor(status: number, code: ErrorCode, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = { error: code, message, ...(extra ?? {}) };
  }
}

export function unauthenticated(): ApiError {
  return new ApiError(401, 'unauthenticated', 'Sign in to continue.');
}

export function invalidCredentials(): ApiError {
  return new ApiError(401, 'invalid_credentials', 'Email or password is incorrect.');
}

export function crossOrigin(): ApiError {
  return new ApiError(403, 'cross_origin', 'Cross-origin requests are not accepted.');
}

export function forbidden(): ApiError {
  return new ApiError(403, 'forbidden', 'You do not have permission for this action.');
}

export function seatRequired(): ApiError {
  return new ApiError(403, 'seat_required', 'You need a pro seat to make changes.');
}

export function readOnlyLink(): ApiError {
  return new ApiError(403, 'read_only_link', 'This review link is view-only.');
}

export function notFound(): ApiError {
  return new ApiError(404, 'not_found', 'Not found.');
}

export function illegalTransition(from: ClusterStatus, to: ClusterStatus): ApiError {
  return new ApiError(409, 'illegal_transition', `This cluster is ${from} and cannot move to ${to}.`, { from, to });
}

export function clusterLocked(): ApiError {
  return new ApiError(409, 'cluster_locked', 'This cluster is locked.');
}

export function clusterNotInReview(): ApiError {
  return new ApiError(409, 'cluster_not_in_review', 'Review links need a cluster in review.');
}

export function alreadyInCluster(): ApiError {
  return new ApiError(409, 'already_in_cluster', 'That reference is already in this cluster.');
}

export function noSeatsLeft(): ApiError {
  return new ApiError(409, 'no_seats_left', 'No seats left on this plan.');
}

export function idempotencyConflict(): ApiError {
  return new ApiError(409, 'idempotency_conflict', 'This key was used for a different request.');
}

export function idempotencyInProgress(): ApiError {
  return new ApiError(409, 'idempotency_in_progress', 'A request with this key is still running.');
}

export function linkExpired(): ApiError {
  return new ApiError(410, 'link_expired', 'This review link has expired.');
}

export function linkRevoked(): ApiError {
  return new ApiError(410, 'link_revoked', 'This review link was revoked.');
}

export function linkInactive(): ApiError {
  return new ApiError(410, 'link_inactive', 'This review link is inactive.');
}

export function inviteUsed(): ApiError {
  return new ApiError(410, 'invite_used', 'This invite has already been used.');
}

export function staleOrder(version: number, entryIds: string[]): ApiError {
  return new ApiError(412, 'stale_order', 'The order changed.', { version, entryIds });
}

export function tooLarge(): ApiError {
  return new ApiError(413, 'too_large', 'The request is larger than allowed.');
}

export function unsupportedMediaType(): ApiError {
  return new ApiError(415, 'unsupported_media_type', 'This content type is not accepted.');
}

export function validation(errors: Record<string, string>): ApiError {
  return new ApiError(422, 'validation', 'Check the highlighted fields.', { errors });
}

export function rateLimited(retryAfter: number): ApiError {
  return new ApiError(429, 'rate_limited', 'Too many comments. Try again shortly.', { retryAfter });
}

export function storageUnavailable(): ApiError {
  return new ApiError(503, 'storage_unavailable', 'Storage is unreachable.');
}

export function mailUnavailable(): ApiError {
  return new ApiError(503, 'mail_unavailable', 'Mail is unreachable.');
}

export function billingUnavailable(): ApiError {
  return new ApiError(503, 'billing_unavailable', 'Billing is unreachable.');
}
