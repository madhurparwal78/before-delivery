export type ErrorCode =
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'code_invalid'
  | 'cross_origin'
  | 'not_found'
  | 'payload_too_large'
  | 'file_too_large'
  | 'idempotency_key_required'
  | 'request_in_progress'
  | 'idempotency_conflict'
  | 'invalid_state'
  | 'quote_locked'
  | 'quote_empty'
  | 'model_missing'
  | 'measurement_pending'
  | 'unit_unconfirmed'
  | 'stills_missing'
  | 'look_dev_unpaid'
  | 'finals_not_ready'
  | 'invoice_not_payable'
  | 'email_taken'
  | 'slug_taken'
  | 'file_type_mismatch'
  | 'gltf_malformed'
  | 'validation_failed'
  | 'too_many_requests'
  | 'card_declined'
  | 'billing_unavailable'
  | 'storage_unavailable'
  | 'email_unavailable'
  | 'content_unavailable'
  | 'search_unavailable'
  | 'documents_unavailable';

export interface FieldErrors {
  [field: string]: string;
}

export const MESSAGES: Record<ErrorCode, string> = {
  unauthenticated: 'Sign in to continue.',
  invalid_credentials: 'That password is wrong.',
  code_invalid: 'That code is wrong or has expired.',
  cross_origin: 'Requests must come from this site.',
  not_found: 'We couldn\'t find that page',
  payload_too_large: 'That request is too large.',
  file_too_large: 'That file is over the size limit for its type.',
  idempotency_key_required: 'Send an Idempotency-Key header.',
  request_in_progress: 'That request is still being processed. Try again in a moment.',
  idempotency_conflict: 'That request key was already used for a different request.',
  invalid_state: 'This engagement can\'t do that at its current stage.',
  quote_locked: 'The quote is locked because the deposit is paid.',
  quote_empty: 'Add at least one shot before paying the deposit.',
  model_missing: 'Upload your product\'s GLB file before paying the deposit.',
  measurement_pending: 'Your model is still being measured. Try again in a moment.',
  unit_unconfirmed: 'Confirm the export unit of your model before paying the deposit.',
  stills_missing: 'Post a still for every shot before sending for review.',
  look_dev_unpaid: 'The look-dev invoice must be paid before final stills go out.',
  finals_not_ready: 'The final stills aren\'t ready for review yet.',
  invoice_not_payable: 'This invoice can\'t be paid right now.',
  email_taken: 'That email already has a Gloamwork account. Sign in instead.',
  slug_taken: 'That slug is already used by another case study.',
  file_type_mismatch: 'That file isn\'t what its name says. Upload a .glb, .step, .stp or .pdf file that matches its extension.',
  gltf_malformed: 'That GLB file couldn\'t be read. Re-export it as binary glTF 2.0 and upload it again.',
  validation_failed: 'Check the highlighted fields.',
  too_many_requests: 'Too many codes were requested. Try again in a few minutes.',
  card_declined: 'Your card was declined. Nothing has been charged. Try another card.',
  billing_unavailable: 'Billing is offline right now. Nothing has been charged. Please try again in a few minutes.',
  storage_unavailable: 'File storage is offline right now. Your file was not saved. Please try again in a few minutes.',
  email_unavailable: 'Email is offline right now. Nothing has been charged. Please try again in a few minutes.',
  content_unavailable: 'Studio content is offline right now. Please try again in a few minutes.',
  search_unavailable: 'Search is offline right now. Please try again in a few minutes.',
  documents_unavailable: 'Documents are offline right now. Payments still go through, and receipts and invoices will be emailed once documents are back.',
};

export const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  invalid_credentials: 401,
  code_invalid: 401,
  cross_origin: 403,
  not_found: 404,
  payload_too_large: 413,
  file_too_large: 413,
  idempotency_key_required: 400,
  request_in_progress: 409,
  idempotency_conflict: 409,
  invalid_state: 409,
  quote_locked: 409,
  quote_empty: 409,
  model_missing: 409,
  measurement_pending: 409,
  unit_unconfirmed: 409,
  stills_missing: 409,
  look_dev_unpaid: 409,
  finals_not_ready: 409,
  invoice_not_payable: 409,
  email_taken: 409,
  slug_taken: 409,
  file_type_mismatch: 422,
  gltf_malformed: 422,
  validation_failed: 422,
  too_many_requests: 429,
  card_declined: 402,
  billing_unavailable: 503,
  storage_unavailable: 503,
  email_unavailable: 503,
  content_unavailable: 503,
  search_unavailable: 503,
  documents_unavailable: 503,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: FieldErrors;
  readonly headers?: Record<string, string>;

  constructor(code: ErrorCode, fields?: FieldErrors, headers?: Record<string, string>) {
    super(MESSAGES[code]);
    this.code = code;
    this.status = STATUS[code];
    this.fields = fields;
    this.headers = headers;
  }
}

export function errorBody(error: ApiError): Record<string, unknown> {
  const body: Record<string, unknown> = { error: error.code, message: MESSAGES[error.code] };
  if (error.fields) {
    body.fields = error.fields;
  }
  return body;
}

/** The copy for measurement failure, used in intake rows and live regions. */
export const MEASUREMENT_FAILED_COPY = 'That GLB couldn\'t be measured. Re-export it as binary glTF 2.0 and upload it again.';
export const MEASURING_DELAYED_BANNER = 'Measuring is delayed. Your files are stored safely and will be measured when the queue is back.';
export const DOCUMENTS_BANNER = 'Documents are offline right now. Payments still go through, and receipts and invoices will be emailed once documents are back.';
