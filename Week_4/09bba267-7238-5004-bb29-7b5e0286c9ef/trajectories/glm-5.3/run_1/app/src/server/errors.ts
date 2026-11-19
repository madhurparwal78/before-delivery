export type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type FieldErrors = Record<string, string>;

/** The one error shape every endpoint answers with. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Json,
  ) {
    super(code);
  }

  static validation(fields: FieldErrors): ApiError {
    return new ApiError(422, 'validation', { error: 'validation', fields });
  }

  static notFound(): ApiError {
    return new ApiError(404, 'not_found', { error: 'not_found' });
  }

  static unauthorized(): ApiError {
    return new ApiError(401, 'unauthorized', { error: 'unauthorized' });
  }

  static state(status: number, code: string, extra: Json = null): ApiError {
    return new ApiError(status, code, { error: code, ...(extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {}) });
  }
}

export const VALIDATION_MESSAGES = {
  name: 'Enter your full name.',
  email: 'Enter an email address like name@example.com.',
  seatIdsRange: 'Choose between 1 and 8 different seats that are on sale for this performance.',
  seatLimit: 'You can hold up to 8 seats for a performance.',
  newSeatId: 'Choose a different seat that is on sale for this performance.',
  ticketIds: 'Choose one or more different tickets from this order.',
  idempotencyKey: 'Send an Idempotency-Key header of 1 to 100 visible characters.',
} as const;

export function isBlank(value: unknown): value is string {
  return typeof value !== 'string' || value.trim().length === 0;
}

export function validateNameEmail(body: Record<string, unknown>): FieldErrors {
  const fields: FieldErrors = {};
  const name = typeof body.name === 'string' ? body.name : '';
  const email = typeof body.email === 'string' ? body.email : '';
  if (name.trim().length < 1 || name.trim().length > 80) {
    fields.name = VALIDATION_MESSAGES.name;
  }
  if (!emailLooksValid(email)) {
    fields.email = VALIDATION_MESSAGES.email;
  }
  return fields;
}

export function emailLooksValid(email: string): boolean {
  if (email.length > 254) return false;
  const at = email.indexOf('@');
  if (at < 1) return false;
  if (email.indexOf('@', at + 1) !== -1) return false;
  const domain = email.slice(at + 1);
  if (domain.length === 0) return false;
  return domain.includes('.');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
