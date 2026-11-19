import { NAME_BAD_CHARS, NAME_REQUIRED, NAME_TOO_LONG } from '../../shared/copy.js';

export interface CheckedName {
  value: string;
  error: string | null;
}

/** File and folder names: 1 to 120 characters after trimming, with no slashes. */
export const checkName = (raw: unknown): CheckedName => {
  if (typeof raw !== 'string') return { value: '', error: NAME_REQUIRED };
  const value = raw.trim();
  if (value.length === 0) return { value, error: NAME_REQUIRED };
  if (value.length > 120) return { value, error: NAME_TOO_LONG };
  if (value.includes('/') || value.includes('\\')) return { value, error: NAME_BAD_CHARS };
  return { value, error: null };
};
