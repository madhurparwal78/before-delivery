import { invalid } from './http.js';

export const EMAIL_MESSAGE = 'Enter an email address like name@example.com';

export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function text(body: Record<string, unknown>, key: string): string {
  const raw = body[key];
  return typeof raw === 'string' ? raw : '';
}

export function requireText(body: Record<string, unknown>, key: string, message: string): string {
  const value = text(body, key).trim();
  if (value === '') throw invalid({ [key]: message });
  return value;
}

export function optionalNumber(
  body: Record<string, unknown>,
  key: string,
  message: string,
): number | null | undefined {
  if (!(key in body)) return undefined;
  const raw = body[key];
  if (raw === null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw invalid({ [key]: message });
  return value;
}

export function optionalDate(
  body: Record<string, unknown>,
  key: string,
  message: string,
): string | null | undefined {
  if (!(key in body)) return undefined;
  const raw = body[key];
  if (raw === null || raw === '') return null;
  const value = String(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid({ [key]: message });
  return value;
}
