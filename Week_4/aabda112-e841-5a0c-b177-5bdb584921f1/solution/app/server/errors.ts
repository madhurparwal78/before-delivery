import { ERROR_COPY, ERROR_STATUS, type ApiErrorBody, type ErrorCode } from '../shared/errors.js';

/** The one error type handlers throw. `message` is already the published copy with its placeholders filled. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly field?: string;

  constructor(code: ErrorCode, message?: string, field?: string) {
    super(message ?? ERROR_COPY[code]);
    this.code = code;
    this.field = field;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }

  body(): ApiErrorBody {
    return { error: this.code, message: this.message, ...(this.field ? { field: this.field } : {}) };
  }
}

export const notFound = () => new AppError('not_found');
export const forbidden = () => new AppError('forbidden');

/** 422 `validation_failed` with the published copy: `<Field label> is required.` / `is not valid.` */
export function invalid(field: string, label: string, missing = false): AppError {
  return new AppError('validation_failed', `${label} ${missing ? 'is required' : 'is not valid'}.`, field);
}

/** Field labels for `validation_failed` (brief: Field rule for 422). Any other key labels itself. */
const FIELD_LABEL: Record<string, string> = {
  patientId: 'Patient',
  vetId: 'Vet',
  reason: 'Reason',
  kennel: 'Kennel',
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
};

export function labelFor(field: string, context?: 'ward-note'): string {
  if (context === 'ward-note' && field === 'text') return 'Note';
  const last = field.split('.');
  if (last[0] === 'treatments' && last.length === 3) {
    return ({ name: 'Treatment', firstAt: 'First dose', intervalHours: 'Every (hours)', count: 'Doses' } as Record<string, string>)[last[2]] ?? field;
  }
  return FIELD_LABEL[field] ?? field;
}

export function isMissing(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}
