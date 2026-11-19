// The one error model. Every API failure goes through `fail`, and the
// precedence ladder is applied by `guard` in server/http.ts before the
// endpoint runs.

export type ErrorCode =
  | 'cross_origin'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'invalid_json'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'invalid_code'
  | 'enrollment_not_active'
  | 'enrollment_closed'
  | 'already_enrolled'
  | 'cohort_full'
  | 'payment_declined'
  | 'billing_unavailable'
  | 'memo_storage_unavailable'
  | 'mail_unavailable'
  | 'illegal_transition'
  | 'entry_id_conflict'
  | 'cohort_not_started'
  | 'cohort_closed'
  | 'memo_exists'
  | 'sign_conflict'
  | 'sign_overlap'
  | 'cohort_name_taken'
  | 'cohort_not_running'
  | 'refund_window_closed'
  | 'not_refundable'
  | 'reality_check_id_conflict'
  | 'range_not_satisfiable';

export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(String(body['error'] ?? status));
    this.status = status;
    this.body = body;
  }
}

export function fail(status: number, body: Record<string, unknown>): ApiError {
  return new ApiError(status, body);
}

export function notFound(): ApiError {
  return fail(404, { error: 'not_found' });
}

export function unauthenticated(): ApiError {
  return fail(401, { error: 'unauthenticated' });
}

export function forbidden(): ApiError {
  return fail(403, { error: 'forbidden' });
}

export function illegalTransition(from: string, to: string): ApiError {
  return fail(409, { error: 'illegal_transition', from, to });
}

export function validation(errors: Record<string, string>): ApiError {
  return fail(422, { errors });
}

export const BILLING_UNAVAILABLE = 503;
export const MEMO_STORAGE_UNAVAILABLE = 503;
export const MAIL_UNAVAILABLE = 503;

export function billingUnavailable(): ApiError {
  return fail(503, { error: 'billing_unavailable' });
}

export function memoStorageUnavailable(): ApiError {
  return fail(503, { error: 'memo_storage_unavailable' });
}

export function mailUnavailable(): ApiError {
  return fail(503, { error: 'mail_unavailable' });
}

export function paymentDeclined(): ApiError {
  return fail(402, { error: 'payment_declined' });
}

export const MESSAGES = {
  enrollmentName: 'Tell us your name in 1 to 80 characters.',
  email: 'Use an email address like name@example.com.',
  homeTz: 'Choose a time zone from the list.',
  bedtime: 'Choose a bedtime between 20:00 and 23:59.',
  cohortName: 'Name the cohort in 1 to 80 characters.',
  startsOn: 'Use a date like 2026-11-02.',
  priceCents: 'Use a price from $1.00 to $1,000.00.',
  seats: 'Use 1 to 50 seats.',
  entryId: 'Use the entry id created on this device.',
  title: 'Keep the title to 120 characters or fewer.',
  textRequired: 'Write at least one word.',
  textLength: 'Keep the dream text to 20,000 characters or fewer.',
  dreamsRecalled: 'Use a whole number from 0 to 20.',
  technique: 'Choose none, mild or ssild.',
  techniqueMinutes: 'Use a whole number of minutes from 0 to 180.',
  techniqueUnlock: 'Technique practice unlocks on night 8.',
  lucid: 'Use true or false.',
  wbtb: 'Use true or false.',
  shared: 'Use true or false.',
  durationMs: 'Send the recording length in milliseconds.',
  memoEmpty: 'The recording is empty.',
  memoSignature: "The recording doesn't match its audio type.",
  range: 'Select between 1 and 200 characters of this entry.',
  category: 'Choose inner awareness, action, form or context.',
  checkId: 'Use the check id created on this device.',
} as const;
