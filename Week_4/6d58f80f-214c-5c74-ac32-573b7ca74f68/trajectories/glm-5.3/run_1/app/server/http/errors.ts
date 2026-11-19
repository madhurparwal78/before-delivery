export type ApiErrorCode =
  | 'too_large' | 'unsupported_media_type' | 'cross_origin' | 'unauthenticated'
  | 'not_found' | 'forbidden' | 'idempotency_key_reused' | 'validation'
  | 'storage_unavailable' | 'directory_unavailable' | 'locked' | 'already_locked' | 'not_locked'
  | 'grant_exists' | 'grant_ended' | 'handover_open' | 'handover_accepted' | 'handover_declined'
  | 'handover_lapsed' | 'policy_exists' | 'policy_started' | 'upload_started' | 'upload_uploading'
  | 'upload_paused' | 'upload_confirmed' | 'upload_cancelled' | 'upload_abandoned' | 'parts_missing'
  | 'link_expired' | 'invalid_credentials' | 'conflict';

export const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  too_large: 413,
  unsupported_media_type: 415,
  cross_origin: 403,
  unauthenticated: 401,
  not_found: 404,
  forbidden: 403,
  idempotency_key_reused: 409,
  validation: 422,
  storage_unavailable: 503,
  directory_unavailable: 503,
  locked: 409,
  already_locked: 409,
  not_locked: 409,
  grant_exists: 409,
  grant_ended: 409,
  handover_open: 409,
  handover_accepted: 409,
  handover_declined: 409,
  handover_lapsed: 409,
  policy_exists: 409,
  policy_started: 409,
  upload_started: 409,
  upload_uploading: 409,
  upload_paused: 409,
  upload_confirmed: 409,
  upload_cancelled: 409,
  upload_abandoned: 409,
  parts_missing: 409,
  link_expired: 410,
  invalid_credentials: 401,
  conflict: 409,
};
