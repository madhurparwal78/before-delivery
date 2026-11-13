// Every API error is built through this one shared shape.
export type ErrorCode =
  | 'link_lapsed' | 'link_used' | 'link_unknown' | 'claim_unknown' | 'not_found'
  | 'not_a_photo' | 'too_large' | 'photo_count' | 'request_too_large'
  | 'carrier_unavailable' | 'carrier_timeout' | 'carrier_malformed'
  | 'storage_unavailable' | 'mail_unavailable' | 'database_unavailable'
  | 'part_withdrawn' | 'reference_locked' | 'wrong_state' | 'claim_closed'
  | 'link_withdrawn' | 'share_unknown' | 'rate_limited' | 'read_only'
  | 'cross_origin' | 'unauthenticated' | 'bad_credentials' | 'not_paid'
  | 'already_paid' | 'idempotency_conflict' | 'billing_unavailable'
  | 'validation_failed' | 'edition_date_taken' | 'edition_code_taken'
  | 'file_too_large' | 'bad_header' | 'missing_field';

export interface ApiError {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
  state?: string;
  headers?: Record<string, string>;
}

/** The published English copy for every code. Owner screens use these as the
 * owner copy; operator screens use operator copy where one is published. */
const OWNER_MESSAGES: Record<string, string> = {
  link_lapsed: "This confirmation link has lapsed. Start your claim again to get a new one.",
  link_used: "This confirmation link has already been used.",
  link_unknown: "We couldn't find that confirmation link.",
  claim_unknown: "We couldn't find that claim.",
  not_a_photo: "The file isn't a JPEG, PNG or WebP photo.",
  too_large: "The file is larger than 8 MB.",
  photo_count: "Add between 1 and 4 photos.",
  request_too_large: "Those photos are too large to send together.",
  carrier_unavailable: "The carrier isn't answering right now. Try the estimate again later.",
  carrier_timeout: "The carrier is taking too long to answer. Try the estimate again in a minute.",
  carrier_malformed: "The carrier sent an answer we can't read. Try the estimate again later.",
  storage_unavailable: "We can't store photos right now, so nothing was saved. Please try again in a few minutes.",
  mail_unavailable: "We can't send email right now, so nothing was saved. Please try again in a few minutes.",
  database_unavailable: "We can't reach our claim records right now, so nothing was saved. Please try again in a few minutes.",
  part_withdrawn: "Part is no longer available to claim.",
  not_found: "We couldn't find a claim with that reference and email.",
  reference_locked: "This reference is locked after too many wrong tries. Try again later.",
  wrong_state: "This claim hasn't been confirmed yet. Use the link in the email we sent.",
  claim_closed: "This claim is closed, so its link no longer works.",
  link_withdrawn: "This link has been withdrawn. Ask Holmgarth Aftercare for a new one.",
  share_unknown: "We couldn't find that link.",
  rate_limited: "Too many requests. Please wait a moment.",
  read_only: "This link is read-only.",
  cross_origin: "Cross-origin requests are not accepted.",
  unauthenticated: "Sign in to continue.",
  bad_credentials: "That email and password don't match.",
  not_paid: "Record the owner's payment before dispatch.",
  already_paid: "This claim is already paid.",
  idempotency_conflict: "That request was already used for a different action.",
  billing_unavailable: "Billing isn't answering. Nothing was charged or changed.",
  validation_failed: "Some fields need attention.",
  edition_date_taken: "An edition already starts on that date.",
  edition_code_taken: "That edition code is already used.",
  file_too_large: "The file is larger than 2,000,000 bytes.",
  bad_header: "The file's first line must be the published header.",
  missing_field: "A required field is missing.",
};

const OPERATOR_MESSAGES: Record<string, string> = {
  wrong_state: "This claim is {state}, so that can't be done now.",
  part_withdrawn: "Part {number} has been withdrawn.",
  not_found: "No claim with that reference.",
  carrier_unavailable: "The carrier isn't answering. No quote was made.",
  carrier_timeout: "The carrier took too long to answer. No quote was made.",
  carrier_malformed: "The carrier's answer couldn't be read. No quote was made.",
  storage_unavailable: "File storage isn't answering. Nothing was changed.",
  mail_unavailable: "Email isn't answering. Nothing was erased.",
  database_unavailable: "The claim records aren't answering. Nothing was changed.",
  billing_unavailable: "Billing isn't answering. Nothing was charged or changed.",
  idempotency_conflict: "That request was already used for a different action.",
  already_paid: "This claim is already paid.",
  not_paid: "Record the owner's payment before dispatch.",
  bad_credentials: "That email and password don't match.",
  unauthenticated: "Sign in to continue.",
  edition_date_taken: "An edition already starts on that date.",
  edition_code_taken: "That edition code is already used.",
  file_too_large: "The file is larger than 2,000,000 bytes.",
  bad_header: "The file's first line must be the published header.",
  rate_limited: "Too many requests. Please wait a moment.",
  validation_failed: "Some fields need attention.",
  cross_origin: "Cross-origin requests are not accepted.",
  read_only: "This link is read-only.",
};

export interface ErrorContext {
  state?: string;
  number?: string;
  photoFile?: string;
  field?: string;
  kind?: string;
}

export function operatorMessage(code: string, ctx: ErrorContext): string {
  const tpl = OPERATOR_MESSAGES[code];
  if (tpl === undefined) return OWNER_MESSAGES[code] ?? 'Request failed.';
  return tpl
    .replace('{state}', ctx.state ?? '')
    .replace('{number}', ctx.number ?? '');
}

export function apiError(opts: {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
  state?: string;
  headers?: Record<string, string>;
}): ApiError {
  return { ...opts };
}

/** Not-found bodies are byte-equal on an endpoint: built once per endpoint. */
export function notFoundError(message: string): ApiError {
  return apiError({ status: 404, code: 'not_found', message });
}

export function buildErrorBody(err: ApiError): { error: { code: string; message: string; fields?: Record<string, string>; state?: string } } {
  const body: { error: { code: string; message: string; fields?: Record<string, string>; state?: string } } = {
    error: { code: err.code, message: err.message },
  };
  if (err.fields && Object.keys(err.fields).length > 0) body.error.fields = err.fields;
  if (err.state !== undefined) body.error.state = err.state;
  return body;
}
