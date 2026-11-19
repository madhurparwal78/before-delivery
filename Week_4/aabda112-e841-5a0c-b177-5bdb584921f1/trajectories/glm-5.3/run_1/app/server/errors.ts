// One error shape, one status map, one order. See the brief's Business rules.
export type ApiError = { status: number; body: { error: string; message: string; field?: string } };

const MESSAGES: Record<string, string> = {
  unauthenticated: 'Sign in to continue.',
  not_found: "We couldn't find that.",
  forbidden: 'Your role cannot do that.',
  invalid_credentials: 'Email or password is not right.',
  slot_taken: 'That slot was just taken. Pick another time.',
  outside_hours: 'Appointments must be between 08:00 and 18:00.',
  invalid_transition: 'This appointment is <Status> and cannot be changed that way.',
  too_early: 'That appointment has not started yet.',
  undo_expired: 'Undo is no longer available.',
  stale_paragraph: '<Name> changed this paragraph first. Your text is kept below as a draft.',
  paragraph_too_long: 'Keep each paragraph under 5,000 characters.',
  already_given: '<Patient>, <Treatment> was already given.',
  not_due: '<Patient>, <Treatment> is not due yet.',
  already_skipped: '<Patient>, <Treatment> was skipped.',
  not_closed: '<Patient>, <Treatment> is not given or skipped.',
  kennel_taken: 'Kennel <Kennel> is already occupied.',
  insufficient_stock: 'Only <N> of <Item> in stock.',
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
  file_too_large: 'That file is larger than <UPLOAD_MAX_MB> MB.',
  payload_too_large: 'That request is too large.',
  storage_unavailable: 'File storage is unavailable.',
  storage_unavailable_upload: 'File storage is unavailable. Your file was not saved.',
  database_unavailable: 'The clinic database is unavailable. Try again shortly.',
  validation_failed: '<Field label> is required.',
};

export const STATUSES: Record<string, number> = {
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
  storage_unavailable_upload: 503,
  database_unavailable: 503,
};

export function t(code: string, subs: Record<string, string | number> = {}): ApiError {
  let msg = MESSAGES[code] ?? code;
  const field = subs.field !== undefined ? String(subs.field) : undefined;
  for (const [k, v] of Object.entries(subs)) {
    msg = msg.replaceAll(`<${k}>`, String(v));
  }
  const status = STATUSES[code] ?? 400;
  const body: { error: string; message: string; field?: string } = { error: code, message: msg };
  if (status === 422 && field !== undefined) body.field = field;
  return { status, body };
}

const TREATMENT_FIELD_LABELS: Record<string, string> = {
  name: 'Treatment',
  firstAt: 'First dose',
  intervalHours: 'Every (hours)',
  count: 'Doses',
};

export const FIELD_LABELS: Record<string, string> = {
  patientId: 'Patient',
  vetId: 'Vet',
  reason: 'Reason',
  kennel: 'Kennel',
  text: 'Note',
  grams: 'Weight in grams',
  vaccine: 'Vaccine',
  dueDate: 'Due date',
  email: 'Email',
  name: 'Name',
  role: 'Role',
  stockItemId: 'Stock item',
  quantity: 'Quantity',
  discountPercent: 'Discount percent',
  delta: 'Quantity',
  batch: 'Batch',
  expiresOn: 'Expires on',
  date: 'Day',
  minutes: 'minutes',
  start: 'start',
  pence: 'pence',
  lines: 'lines',
  password: 'password',
  ownerName: 'Your name',
  ownerEmail: 'Email',
  petName: 'Pet name',
  species: 'Species',
  file: 'file',
  kind: 'kind',
  now: 'now',
};

export function fieldLabel(path: string): string {
  if (TREATMENT_FIELD_LABELS[path]) return TREATMENT_FIELD_LABELS[path];
  const m = path.match(/^treatments\.(\d+)\.(name|firstAt|intervalHours|count)$/);
  if (m) return TREATMENT_FIELD_LABELS[m[2]];
  return FIELD_LABELS[path] ?? path;
}

export function validationError(field: string, message?: string): ApiError {
  const msg = message ?? `${fieldLabel(field)} is required.`;
  return { status: 422, body: { error: 'validation_failed', message: msg, field } };
}

export const notValid = (field: string): ApiError =>
  validationError(field, `${fieldLabel(field)} is not valid.`);
