import { errors } from './errors.js';
import { fieldMessages } from '../shared/fields.js';
import { limits } from '../shared/limits.js';

export class FieldErrors {
  private readonly fields: Record<string, string> = {};

  add(field: string, message: string): void {
    if (this.fields[field] === undefined) {
      this.fields[field] = message;
    }
  }

  get isEmpty(): boolean {
    return Object.keys(this.fields).length === 0;
  }

  throwIfAny(): void {
    if (!this.isEmpty) {
      throw errors.validation(this.fields);
    }
  }
}

function codePoints(value: string): number {
  return Array.from(value).length;
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

const emailPattern = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const handlePattern = /^[a-z0-9-]{3,24}$/;

export function checkEmail(fields: FieldErrors, value: unknown, field = 'email'): string {
  const email = asString(value) ?? '';
  if (!emailPattern.test(email) || email.length > 254) {
    fields.add(field, fieldMessages.emailInvalid);
  }
  return email;
}

export function checkPassword(fields: FieldErrors, value: unknown): string {
  const password = asString(value) ?? '';
  if (password.length < 10) {
    fields.add('password', fieldMessages.passwordShort);
  }
  return password;
}

export function checkHandle(fields: FieldErrors, value: unknown): string {
  const handle = asString(value) ?? '';
  if (!handlePattern.test(handle)) {
    fields.add('handle', fieldMessages.handleShape);
  }
  return handle;
}

export function checkDisplayName(fields: FieldErrors, value: unknown, field = 'displayName'): string {
  const name = asString(value) ?? '';
  const length = codePoints(name);
  if (length < 1 || length > 60) {
    fields.add(field, fieldMessages.displayName);
  }
  return name;
}

export function checkTitle(fields: FieldErrors, value: unknown): string {
  const title = asString(value) ?? '';
  const length = codePoints(title);
  if (length < 1 || length > 80 || title.trim() === '') {
    fields.add('title', fieldMessages.title);
  }
  return title;
}

export function checkLongText(fields: FieldErrors, value: unknown, field: string): string {
  const text = asString(value) ?? '';
  if (codePoints(text) > 2000) {
    fields.add(field, fieldMessages.longText);
  }
  return text;
}

export function checkCommentBody(fields: FieldErrors, value: unknown): string {
  const body = asString(value) ?? '';
  const length = codePoints(body);
  if (length < 1 || length > 2000) {
    fields.add('body', fieldMessages.body);
  }
  return body;
}

export function checkQuery(fields: FieldErrors, value: string | null): string {
  const text = value ?? '';
  const length = codePoints(text);
  if (length < 1 || length > 100) {
    fields.add('q', fieldMessages.q);
  }
  return text;
}

export function checkLimit(value: string | null, fallback: number, max: number): number {
  if (value === null || value === '') {
    return fallback;
  }
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw errors.validation({ limit: fieldMessages.limit });
  }
  return Math.min(Number(value), max);
}

export function checkIdempotencyKey(value: string | undefined): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64) {
    throw errors.validation({ idempotencyKey: fieldMessages.idempotencyKey });
  }
  return value;
}

function checkInstant(fields: FieldErrors, value: unknown, field: string): Date | null {
  const text = asString(value);
  if (text === null) {
    fields.add(field, fieldMessages.expiresAtFuture);
    return null;
  }
  const instant = new Date(text);
  if (Number.isNaN(instant.getTime())) {
    fields.add(field, fieldMessages.expiresAtFuture);
    return null;
  }
  return instant;
}

export function checkExpiresAt(fields: FieldErrors, value: unknown, now: Date): Date | null {
  const instant = checkInstant(fields, value, 'expiresAt');
  if (instant === null) {
    return null;
  }
  if (instant.getTime() <= now.getTime()) {
    fields.add('expiresAt', fieldMessages.expiresAtFuture);
    return null;
  }
  if (instant.getTime() - now.getTime() > limits.reviewExpiryWindowMs) {
    fields.add('expiresAt', fieldMessages.expiresAtWindow);
    return null;
  }
  return instant;
}
