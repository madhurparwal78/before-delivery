import { NOT_WRITABLE, type FieldErrors } from '../errors.ts';

export const WRITABLE_FIELDS = {
  project: ['slug', 'title', 'credit_type', 'credit_line', 'role', 'blurb', 'tags', 'visibility', 'position', 'thresholds'],
  enquiryTriage: ['triage_notes', 'fit_score', 'rate_floor_cents'],
  transition: ['to'],
  proposal: ['producer_name', 'producer_email', 'project_title', 'scope', 'fee_cents', 'production_month'],
  milestonePreview: ['fee_cents'],
  month: ['capacity'],
  settings: ['time_zone'],
  session: ['email', 'password'],
  listeningLink: ['label', 'expires_at'],
  deposit: ['payer_name', 'amount_cents'],
  empty: [],
} as const satisfies Record<string, readonly string[]>;

/** Every key a body carries that the endpoint does not list is reported, in the body's own order. */
export function unwritableKeyErrors(body: Record<string, unknown>, allowed: readonly string[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) errors[key] = NOT_WRITABLE;
  }
  return errors;
}

export function isJsonInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}
