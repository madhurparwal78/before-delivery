import type { ApiErrorBody, ClusterStatus } from '../shared/types.js';

/** The single error shape for the whole API. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;
  readonly headers: Record<string, string>;

  constructor(status: number, body: ApiErrorBody, headers: Record<string, string> = {}) {
    super(body.message);
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

function build(status: number, error: string, message: string, extra: Partial<ApiErrorBody> = {}): ApiError {
  return new ApiError(status, { error, message, ...extra });
}

export const errors = {
  unauthenticated: () => build(401, 'unauthenticated', 'Sign in to continue.'),
  invalidCredentials: () => build(401, 'invalid_credentials', 'Email or password is incorrect.'),
  crossOrigin: () => build(403, 'cross_origin', 'Cross-origin requests are not accepted.'),
  forbidden: () => build(403, 'forbidden', 'You do not have permission for this action.'),
  seatRequired: () => build(403, 'seat_required', 'You need a pro seat to make changes.'),
  readOnlyLink: () => build(403, 'read_only_link', 'This review link is view-only.'),
  notFound: () => build(404, 'not_found', 'Not found.'),
  illegalTransition: (from: ClusterStatus, to: ClusterStatus) =>
    build(409, 'illegal_transition', `A ${from} cluster cannot move to ${to}.`, { from, to }),
  clusterLocked: () => build(409, 'cluster_locked', 'This cluster is locked.'),
  clusterNotInReview: () => build(409, 'cluster_not_in_review', 'Review links need a cluster in review.'),
  alreadyInCluster: () => build(409, 'already_in_cluster', 'That reference is already in this cluster.'),
  noSeatsLeft: () => build(409, 'no_seats_left', 'No seats left on this plan.'),
  idempotencyConflict: () => build(409, 'idempotency_conflict', 'This key was used for a different request.'),
  idempotencyInProgress: () => build(409, 'idempotency_in_progress', 'A request with this key is still running.'),
  linkExpired: () => build(410, 'link_expired', 'This review link has expired.'),
  linkRevoked: () => build(410, 'link_revoked', 'This review link was revoked.'),
  linkInactive: () => build(410, 'link_inactive', 'This cluster is no longer in review.'),
  inviteUsed: () => build(410, 'invite_used', 'This invite has already been used.'),
  staleOrder: (version: number, entryIds: string[]) =>
    build(412, 'stale_order', 'The order changed.', { version, entryIds }),
  tooLarge: () => build(413, 'too_large', 'The request is larger than allowed.'),
  unsupportedMediaType: () => build(415, 'unsupported_media_type', 'This content type is not accepted.'),
  validation: (fields: Record<string, string>) =>
    build(422, 'validation', 'Check the highlighted fields.', { errors: fields }),
  rateLimited: (retryAfter: number) =>
    new ApiError(
      429,
      { error: 'rate_limited', message: 'Too many comments. Try again shortly.', retryAfter },
      { 'Retry-After': String(retryAfter) },
    ),
  storageUnavailable: () => build(503, 'storage_unavailable', 'Storage is unreachable.'),
  mailUnavailable: () => build(503, 'mail_unavailable', 'Mail is unreachable.'),
  billingUnavailable: () => build(503, 'billing_unavailable', 'Billing is unreachable.'),
};
