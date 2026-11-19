const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F\u2028\u2029]/;
const MULTILINE_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/;
const ADDRESS_FORBIDDEN = /[\s<>,;"()]/;

export function isSingleLine(value: string): boolean {
  return !CONTROL_CHARACTERS.test(value);
}

export function isMultiLine(value: string): boolean {
  return !MULTILINE_FORBIDDEN.test(value);
}

export function isBareAddress(value: string): boolean {
  if (value.length === 0 || value.length > 254) return false;
  if (ADDRESS_FORBIDDEN.test(value)) return false;
  if (CONTROL_CHARACTERS.test(value)) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const local = parts[0] as string;
  const domain = parts[1] as string;
  if (local.length === 0) return false;
  if (!domain.includes('.')) return false;
  const labels = domain.split('.');
  return labels.every((label) => label.length > 0);
}

export function singleLineField(
  value: unknown,
  min: number,
  max: number,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== 'string') return { ok: false, message: 'Must be text.' };
  if (value.length < min) return { ok: false, message: `Must be at least ${min} character${min === 1 ? '' : 's'}.` };
  if (value.length > max) return { ok: false, message: `Must be at most ${max} characters.` };
  if (!isSingleLine(value)) return { ok: false, message: 'Must be one line of text.' };
  return { ok: true, value };
}

export function multiLineField(
  value: unknown,
  min: number,
  max: number,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== 'string') return { ok: false, message: 'Must be text.' };
  if (value.length < min) return { ok: false, message: `Must be at least ${min} characters.` };
  if (value.length > max) return { ok: false, message: `Must be at most ${max} characters.` };
  if (!isMultiLine(value)) return { ok: false, message: 'Contains characters that are not allowed.' };
  return { ok: true, value };
}

export function addressField(value: unknown): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== 'string') return { ok: false, message: 'Must be text.' };
  if (!isBareAddress(value)) return { ok: false, message: 'Must be one plain email address.' };
  return { ok: true, value };
}

export const FILE_NAME_MAX = 200;

export function isSafeFileName(name: string): boolean {
  if (name.length === 0 || name.length > FILE_NAME_MAX) return false;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
  return !/[\u0000-\u001F\u007F]/.test(name);
}
