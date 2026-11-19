import { FIELD_MESSAGES } from '../../shared/copy';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function field(body: unknown, name: string): unknown {
  if (body === null || typeof body !== 'object') return undefined;
  return (body as Record<string, unknown>)[name];
}

export function stringField(body: unknown, name: string): string {
  const value = field(body, name);
  return typeof value === 'string' ? value : '';
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function nameErrors(name: string): Record<string, string> {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 80 ? {} : { name: FIELD_MESSAGES.name };
}

export function emailErrors(email: string): Record<string, string> {
  const trimmed = email.trim();
  return trimmed.length <= 254 && EMAIL_PATTERN.test(trimmed) ? {} : { email: FIELD_MESSAGES.email };
}

export function buyerFieldErrors(name: string, email: string): Record<string, string> {
  return { ...nameErrors(name), ...emailErrors(email) };
}

export function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (!value.every((item) => typeof item === 'string')) return undefined;
  return value as string[];
}
