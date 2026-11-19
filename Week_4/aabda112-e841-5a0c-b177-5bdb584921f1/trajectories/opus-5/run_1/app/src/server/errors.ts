import { settings } from './config';

export type ErrorCode =
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'not_found'
  | 'forbidden'
  | 'slot_taken'
  | 'outside_hours'
  | 'invalid_transition'
  | 'too_early'
  | 'undo_expired'
  | 'stale_paragraph'
  | 'paragraph_too_long'
  | 'already_given'
  | 'not_due'
  | 'already_skipped'
  | 'not_closed'
  | 'kennel_taken'
  | 'insufficient_stock'
  | 'invoice_not_draft'
  | 'invoice_exists'
  | 'no_lines'
  | 'invoice_not_issued'
  | 'invoice_closed'
  | 'invoice_has_payments'
  | 'payment_too_large'
  | 'idempotency_key_reused'
  | 'duplicate_vaccination'
  | 'email_taken'
  | 'own_access'
  | 'weak_password'
  | 'out_of_window'
  | 'rate_limited'
  | 'unsupported_type'
  | 'file_too_large'
  | 'payload_too_large'
  | 'storage_unavailable'
  | 'database_unavailable'
  | 'validation_failed';

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  invalid_credentials: 401,
  forbidden: 403,
  not_found: 404,
  slot_taken: 409,
  invalid_transition: 409,
  too_early: 409,
  undo_expired: 409,
  stale_paragraph: 409,
  already_given: 409,
  not_due: 409,
  already_skipped: 409,
  not_closed: 409,
  kennel_taken: 409,
  insufficient_stock: 409,
  invoice_not_draft: 409,
  invoice_exists: 409,
  invoice_not_issued: 409,
  invoice_closed: 409,
  invoice_has_payments: 409,
  idempotency_key_reused: 409,
  duplicate_vaccination: 409,
  email_taken: 409,
  own_access: 409,
  payload_too_large: 413,
  validation_failed: 422,
  outside_hours: 422,
  paragraph_too_long: 422,
  payment_too_large: 422,
  no_lines: 422,
  weak_password: 422,
  out_of_window: 422,
  unsupported_type: 422,
  file_too_large: 422,
  rate_limited: 429,
  storage_unavailable: 503,
  database_unavailable: 503,
};

const FIXED_COPY: Partial<Record<ErrorCode, string>> = {
  unauthenticated: 'Sign in to continue.',
  not_found: "We couldn't find that.",
  forbidden: 'Your role cannot do that.',
  invalid_credentials: 'Email or password is not right.',
  slot_taken: 'That slot was just taken. Pick another time.',
  outside_hours: 'Appointments must be between 08:00 and 18:00.',
  too_early: 'That appointment has not started yet.',
  undo_expired: 'Undo is no longer available.',
  paragraph_too_long: 'Keep each paragraph under 5,000 characters.',
  invoice_not_draft: 'Only a draft invoice can be changed.',
  invoice_exists: 'This consult already has an invoice.',
  no_lines: 'Add at least one line before issuing.',
  invoice_not_issued: 'Issue the invoice before taking payment.',
  invoice_closed: 'This invoice is closed.',
  invoice_has_payments: 'An invoice with payments cannot be voided.',
  payment_too_large: 'Payment is more than the balance due.',
  idempotency_key_reused: 'That key was already used for a different request.',
  duplicate_vaccination: 'That vaccination is already recorded.',
  email_taken: 'That email already has access.',
  own_access: 'You cannot change your own access.',
  weak_password: 'Use at least 10 characters.',
  out_of_window: 'That time is not available for online booking.',
  rate_limited: 'Too many booking attempts. Try again in a minute.',
  unsupported_type: 'Only JPEG, PNG or PDF files are allowed.',
  payload_too_large: 'That request is too large.',
  database_unavailable: 'The clinic database is unavailable. Try again shortly.',
};

export type ErrorDetail = {
  status?: string;
  name?: string;
  patient?: string;
  treatment?: string;
  kennel?: string;
  quantity?: number;
  item?: string;
  label?: string;
  shape?: 'missing' | 'invalid';
  copy?: string;
};

export function errorMessage(code: ErrorCode, detail: ErrorDetail = {}): string {
  if (detail.copy) return detail.copy;
  const fixed = FIXED_COPY[code];
  if (fixed) return fixed;
  switch (code) {
    case 'invalid_transition':
      return `This appointment is ${detail.status ?? 'Booked'} and cannot be changed that way.`;
    case 'stale_paragraph':
      return `${detail.name ?? 'Someone'} changed this paragraph first. Your text is kept below as a draft.`;
    case 'already_given':
      return `${detail.patient}, ${detail.treatment} was already given.`;
    case 'not_due':
      return `${detail.patient}, ${detail.treatment} is not due yet.`;
    case 'already_skipped':
      return `${detail.patient}, ${detail.treatment} was skipped.`;
    case 'not_closed':
      return `${detail.patient}, ${detail.treatment} is not given or skipped.`;
    case 'kennel_taken':
      return `Kennel ${detail.kennel} is already occupied.`;
    case 'insufficient_stock':
      return `Only ${detail.quantity} of ${detail.item} in stock.`;
    case 'file_too_large':
      return `That file is larger than ${settings.uploadMaxMb} MB.`;
    case 'storage_unavailable':
      return 'File storage is unavailable.';
    case 'validation_failed':
      return detail.shape === 'invalid'
        ? `${detail.label} is not valid.`
        : `${detail.label} is required.`;
    default:
      return 'Something went wrong.';
  }
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly field?: string;
  readonly copy: string;

  constructor(code: ErrorCode, options: ErrorDetail & { field?: string } = {}) {
    const copy = errorMessage(code, options);
    super(copy);
    this.code = code;
    this.copy = copy;
    this.field = options.field;
  }

  get status(): number {
    return STATUS[this.code];
  }

  get body(): { error: string; message: string; field?: string } {
    const body: { error: string; message: string; field?: string } = {
      error: this.code,
      message: this.copy,
    };
    if (this.status === 422) body.field = this.field ?? 'body';
    return body;
  }
}

const FIELD_LABELS: Record<string, string> = {
  patientId: 'Patient',
  vetId: 'Vet',
  reason: 'Reason',
  kennel: 'Kennel',
  name: 'Name',
  firstAt: 'First dose',
  intervalHours: 'Every (hours)',
  count: 'Doses',
  text: 'Note',
  grams: 'Weight in grams',
  vaccine: 'Vaccine',
  dueDate: 'Due date',
  email: 'Email',
  role: 'Role',
  stockItemId: 'Stock item',
  quantity: 'Quantity',
  discountPercent: 'Discount percent',
  delta: 'Quantity',
  batch: 'Batch',
  expiresOn: 'Expires on',
  date: 'Day',
};

export function fieldLabel(field: string): string {
  if (/^treatments\.\d+\.name$/.test(field)) return 'Treatment';
  const last = field.split('.').pop() ?? field;
  return FIELD_LABELS[last] ?? field;
}

export function invalid(field: string, shape: 'missing' | 'invalid' = 'invalid'): AppError {
  return new AppError('validation_failed', { field, label: fieldLabel(field), shape });
}

export function missing(field: string): AppError {
  return invalid(field, 'missing');
}
