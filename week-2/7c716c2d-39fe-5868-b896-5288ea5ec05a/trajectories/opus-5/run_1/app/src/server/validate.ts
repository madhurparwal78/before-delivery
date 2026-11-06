import { ApiError } from './errors.js';
import { codePointLength, isBlank, isStorableText } from './domain/text.js';

const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function uuidOrNotFound(value: string | undefined): string {
  if (value === undefined || !uuidPattern.test(value)) throw new ApiError('not_found');
  return value;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

export function integerOrNotFound(value: string | undefined, min: number, max: number): number {
  if (value === undefined || !/^\d+$/.test(value)) throw new ApiError('not_found');
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new ApiError('not_found');
  return parsed;
}

export function messageIdOrNotFound(value: string | undefined): number {
  if (value === undefined || !/^\d{1,18}$/.test(value)) throw new ApiError('not_found');
  return Number(value);
}

export type TextRule = { field: string; min: number; max: number; message: string; blankMessage?: string };

/** Text fields are judged on code points and refused when they cannot be stored. */
export function textField(body: Record<string, unknown>, name: string, rule: TextRule): string {
  const value = body[name];
  if (typeof value !== 'string' || !isStorableText(value)) {
    throw new ApiError('validation', { fields: { [rule.field]: rule.message }, message: rule.message });
  }
  if (rule.min > 0 && isBlank(value)) {
    const message = rule.blankMessage ?? rule.message;
    throw new ApiError('validation', { fields: { [rule.field]: message }, message });
  }
  const length = codePointLength(value);
  if (length < rule.min || length > rule.max) {
    throw new ApiError('validation', { fields: { [rule.field]: rule.message }, message: rule.message });
  }
  return value;
}

export function emailField(body: Record<string, unknown>, name = 'email'): string {
  const value = body[name];
  if (
    typeof value !== 'string' ||
    !isStorableText(value) ||
    codePointLength(value) > 254 ||
    !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value)
  ) {
    throw new ApiError('validation', {
      fields: { [name]: 'Enter an email address.' },
      message: 'Enter an email address.',
    });
  }
  return value;
}

export function passwordField(body: Record<string, unknown>, name: string, field = name): string {
  const value = body[name];
  if (typeof value !== 'string' || codePointLength(value) < 8 || codePointLength(value) > 128) {
    throw new ApiError('validation', {
      fields: { [field]: 'Use 8 to 128 characters.' },
      message: 'Use 8 to 128 characters.',
    });
  }
  return value;
}
