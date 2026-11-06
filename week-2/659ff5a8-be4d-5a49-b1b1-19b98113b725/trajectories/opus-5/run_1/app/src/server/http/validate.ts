import { apiError } from './errors';

export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  add(field: string, message: string): void {
    if (!(field in this.fields)) this.fields[field] = message;
  }

  get empty(): boolean {
    return Object.keys(this.fields).length === 0;
  }

  throwIfAny(): void {
    if (!this.empty) throw apiError.validation(this.fields);
  }
}

export function readString(
  body: Record<string, unknown>,
  field: string,
  rules: { min: number; max: number; label: string },
  errors: FieldErrors,
): string {
  return checkString(body[field], field, rules, errors);
}

export function checkString(
  raw: unknown,
  field: string,
  rules: { min: number; max: number; label: string },
  errors: FieldErrors,
): string {
  if (typeof raw !== 'string') {
    errors.add(field, `${rules.label} is required.`);
    return '';
  }
  const value = raw.trim();
  if (value.length < rules.min || value.length > rules.max) {
    errors.add(
      field,
      `${rules.label} must be ${rules.min} to ${rules.max} characters.`,
    );
  }
  return value;
}

export function readInteger(
  body: Record<string, unknown>,
  field: string,
  rules: { min: number; max: number; label: string },
  errors: FieldErrors,
): number {
  const raw = body[field];
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < rules.min || value > rules.max) {
    errors.add(field, `${rules.label} must be a whole number from ${rules.min} to ${rules.max}.`);
    return rules.min;
  }
  return value;
}

export function readEmail(
  body: Record<string, unknown>,
  field: string,
  errors: FieldErrors,
): string {
  return checkEmail(body[field], field, errors);
}

export function checkEmail(raw: unknown, field: string, errors: FieldErrors): string {
  if (typeof raw !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim())) {
    errors.add(field, 'Enter a valid email address.');
    return '';
  }
  return raw.trim();
}

export function readDate(
  body: Record<string, unknown>,
  field: string,
  label: string,
  errors: FieldErrors,
): string {
  const raw = body[field];
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    errors.add(field, `${label} must be a date like 2026-08-16.`);
    return '';
  }
  const [year, month, day] = raw.split('-').map((part) => Number.parseInt(part, 10)) as [
    number,
    number,
    number,
  ];
  const asDate = new Date(Date.UTC(year, month - 1, day));
  if (
    asDate.getUTCFullYear() !== year ||
    asDate.getUTCMonth() + 1 !== month ||
    asDate.getUTCDate() !== day
  ) {
    errors.add(field, `${label} is not a real date.`);
  }
  return raw;
}

export function readStringArray(
  body: Record<string, unknown>,
  field: string,
  rules: { min: number; max: number; itemMin: number; itemMax: number; label: string },
  errors: FieldErrors,
): string[] {
  const raw = body[field];
  if (!Array.isArray(raw)) {
    errors.add(field, `${rules.label} is required.`);
    return [];
  }
  const values = raw.map((item) => (typeof item === 'string' ? item.trim() : ''));
  if (values.length < rules.min || values.length > rules.max) {
    errors.add(field, `${rules.label} must have ${rules.min} to ${rules.max} entries.`);
  }
  if (values.some((value) => value.length < rules.itemMin || value.length > rules.itemMax)) {
    errors.add(
      field,
      `Each ${rules.label.toLowerCase()} entry must be ${rules.itemMin} to ${rules.itemMax} characters.`,
    );
  }
  if (new Set(values).size !== values.length) {
    errors.add(field, `${rules.label} must be unique.`);
  }
  return values;
}
