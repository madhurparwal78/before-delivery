// One error shape for every API error: {"error":"<code>"} plus the extra fields the brief allows.
export type ApiErrorCode =
  | 'invalid'
  | 'unauthenticated'
  | 'not_found'
  | 'forbidden'
  | 'conflict'
  | 'too_large'
  | 'unsupported_media_type'
  | 'cross_origin'
  | 'unavailable'
  | 'not_a_request'
  | 'too_many_attempts'
  | 'letter_id_conflict'
  | 'blob_id_conflict'
  | 'attachment_not_stored'
  | 'attachment_in_use'
  | 'contact_blocked'
  | 'request_not_accepted'
  | 'seal_change_unaccepted'
  | 'recipient_key_changed'
  | 'retract_window_closed'
  | 'not_sender'
  | 'stale_key'
  | 'username_taken'
  | 'username_cooldown'
  | 'same'
  | 'recovery_failed'
  | 'size_mismatch'
  | 'already_stored'
  | 'unsupported';

export function errorBody(code: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return extra ? { error: code, ...extra } : { error: code };
}
