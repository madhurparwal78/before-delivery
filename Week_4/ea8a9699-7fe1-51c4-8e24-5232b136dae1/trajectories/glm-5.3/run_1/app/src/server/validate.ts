// Validation: the one place the API's field rules are decided.

export type FieldErrors = Record<string, string>;

export function validEmail(email: unknown, errors: FieldErrors, field = 'email'): string {
  const v = asString(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    errors[field] = 'Enter a valid email address.';
    return v;
  }
  return v;
}

export function emailTaken(errors: FieldErrors, field = 'email'): void {
  errors[field] = 'That email already has an account.';
}

export function passwordForNewAccount(password: unknown, errors: FieldErrors): string {
  const v = asString(password);
  if (utf16Length(v) < 10) errors.password = 'Use at least 10 characters.';
  return v;
}

export function passwordForSignIn(password: unknown, errors: FieldErrors): string {
  const v = asString(password);
  if (!v) errors.password = 'Enter your password.';
  return v;
}

export function validHandle(handle: unknown, errors: FieldErrors, field = 'handle'): string {
  const v = asString(handle);
  if (!/^[a-z0-9-]{3,24}$/.test(v)) {
    errors[field] = 'Use 3 to 24 lowercase letters, digits or hyphens.';
    return v;
  }
  return v;
}

export function handleTaken(errors: FieldErrors, field = 'handle'): void {
  errors[field] = 'That handle is taken.';
}

export function nameField(value: unknown, errors: FieldErrors, field: string): string {
  const v = asString(value);
  if (codePoints(v) < 1 || codePoints(v) > 60) errors[field] = 'Enter 1 to 60 characters.';
  return v;
}

export function titleField(value: unknown, errors: FieldErrors, field = 'title'): string {
  const v = typeof value === 'string' ? value : '';
  if (codePoints(v) < 1 || codePoints(v) > 80 || v.trim().length === 0) {
    errors[field] = 'Enter a title of 1 to 80 characters.';
  }
  return v;
}

export function textField(value: unknown, errors: FieldErrors, field: string, message = 'Use at most 2000 characters.'): string {
  const v = asString(value);
  if (codePoints(v) > 2000) errors[field] = message;
  return v;
}

export function queryField(value: unknown, errors: FieldErrors, field = 'q'): string {
  const v = asString(value);
  if (codePoints(v) < 1 || codePoints(v) > 100) errors[field] = 'Enter 1 to 100 characters.';
  return v;
}

export function commentBody(value: unknown, errors: FieldErrors, field = 'body'): string {
  const v = asString(value);
  if (codePoints(v) < 1 || codePoints(v) > 2000) {
    errors[field] = field === 'body' ? 'Write a comment of 1 to 2000 characters.' : 'Write a comment of 1 to 2000 characters.';
  }
  return v;
}

export function limitField(value: unknown, errors: FieldErrors, field = 'limit'): number | null {
  const raw = asString(value);
  if (raw === '') return null;
  if (!/^\d+$/.test(raw)) {
    errors[field] = 'Use a whole number of 1 or more.';
    return null;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    errors[field] = 'Use a whole number of 1 or more.';
    return null;
  }
  return n;
}

export function positionField(value: unknown, itemCount: number, errors: FieldErrors): number {
  const n = typeof value === 'number' ? value : Number(asString(value));
  if (!Number.isInteger(n) || n < 1 || n > itemCount) {
    errors.toPosition = `Choose a position from 1 to ${itemCount}.`;
    return 1;
  }
  return n;
}

export function frameIndexField(value: unknown, totalFrames: number, errors: FieldErrors): number {
  const n = typeof value === 'number' ? value : Number(asString(value));
  if (!Number.isInteger(n) || n < 0 || n > totalFrames - 1) {
    errors.frameIndex = `Choose a frame from 0 to ${totalFrames - 1}.`;
    return 0;
  }
  return n;
}

export function frameRateField(value: unknown, errors: FieldErrors): number {
  const n = typeof value === 'number' ? value : Number(asString(value));
  if (n !== 24 && n !== 25 && n !== 30) {
    errors.frameRate = 'Choose 24, 25 or 30 frames per second.';
    return 25;
  }
  return n;
}

export function durationField(value: unknown, errors: FieldErrors): number {
  const n = typeof value === 'number' ? value : Number(asString(value));
  if (!Number.isInteger(n) || n < 1 || n > 3_600_000) {
    errors.durationMs = 'Enter a duration from 1 to 3600000 milliseconds.';
    return 2000;
  }
  return n;
}

export function idempotencyKeyField(value: unknown, errors: FieldErrors): string {
  const v = asString(value);
  if (utf16Length(v) < 1 || utf16Length(v) > 64) errors.idempotencyKey = 'Send an Idempotency-Key of 1 to 64 characters.';
  return v;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function codePoints(s: string): number {
  return [...s].length;
}

export function utf16Length(s: string): number {
  return s.length;
}
