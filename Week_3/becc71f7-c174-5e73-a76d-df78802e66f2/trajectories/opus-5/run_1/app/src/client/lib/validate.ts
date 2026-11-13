import { EMAIL_PATTERN } from '../../shared/validate.js';

/** The same shape the server accepts, so a form can show its own field message first. */
export function isValidEmailish(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && EMAIL_PATTERN.test(trimmed);
}

export function isValidNameish(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 80;
}
