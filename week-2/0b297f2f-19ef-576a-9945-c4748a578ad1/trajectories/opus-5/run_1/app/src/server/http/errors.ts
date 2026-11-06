import type { ApiErrorBody, Placement, RejectionReason } from '../../shared/types';

interface ApiErrorExtra {
  fields?: Record<string, string>;
  reason?: RejectionReason;
  claimedBy?: { id: string; name: string };
  placement?: Placement;
}

/** Every API error is produced here, in the one published error shape. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: ApiErrorExtra;

  constructor(status: number, code: string, message: string, extra: ApiErrorExtra = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  body(): ApiErrorBody {
    return { error: { code: this.code, message: this.message, ...this.extra } };
  }
}

export const errors = {
  bodyTooLarge: (): ApiError => new ApiError(413, 'body_too_large', 'Request body is too large.'),
  databaseUnavailable: (): ApiError =>
    new ApiError(503, 'database_unavailable', 'The database is unavailable.'),
  imageStoreUnavailable: (): ApiError =>
    new ApiError(503, 'image_store_unavailable', 'The image store is unavailable.'),
  unknownStaff: (): ApiError =>
    new ApiError(401, 'unknown_staff', 'Send a seeded staff id in X-Staff-Id.'),
  notFound: (): ApiError => new ApiError(404, 'not_found', 'Not found.'),
  forbidden: (): ApiError =>
    new ApiError(403, 'forbidden', 'Your role cannot take this action.'),
  readOnly: (): ApiError => new ApiError(405, 'read_only', 'Preview links are read-only.'),
  methodNotAllowed: (): ApiError => new ApiError(405, 'read_only', 'Method not allowed.'),
  validationFailed: (fields: Record<string, string>): ApiError =>
    new ApiError(422, 'validation_failed', 'Some fields need fixing.', { fields }),
  placementRejected: (reason: RejectionReason, message: string): ApiError =>
    new ApiError(422, 'placement_rejected', message, { reason }),
  unsupportedMediaType: (): ApiError =>
    new ApiError(415, 'unsupported_media_type', 'Use a JPEG or PNG photo.'),
  conflict: (code: string, message: string, extra: ApiErrorExtra = {}): ApiError =>
    new ApiError(409, code, message, extra),
  alreadyClaimed: (claimedBy: { id: string; name: string }): ApiError =>
    new ApiError(409, 'already_claimed', `${claimedBy.name} claimed this work first.`, {
      claimedBy,
    }),
  staleVersion: (placement: Placement): ApiError =>
    new ApiError(412, 'stale_version', 'That version is out of date.', { placement }),
  undoExpired: (): ApiError =>
    new ApiError(410, 'undo_expired', 'The undo window has closed.'),
  linkWithdrawn: (): ApiError =>
    new ApiError(410, 'link_withdrawn', 'This preview has been withdrawn.'),
};
