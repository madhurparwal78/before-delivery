export const codePoints = (text: string): number => [...text].length;

export const readString = (source: Record<string, unknown>, key: string): string | null => {
  const value = source[key];
  return typeof value === 'string' ? value : null;
};

export const readBoolean = (source: Record<string, unknown>, key: string): boolean | null => {
  const value = source[key];
  return typeof value === 'boolean' ? value : null;
};

export const readNumber = (source: Record<string, unknown>, key: string): number | null => {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

export const readArray = (source: Record<string, unknown>, key: string): unknown[] | null => {
  const value = source[key];
  return Array.isArray(value) ? value : null;
};

export const readObjectArray = (
  source: Record<string, unknown>,
  key: string,
): Array<Record<string, unknown>> | null => {
  const items = readArray(source, key);
  if (items === null) return null;
  const out: Array<Record<string, unknown>> = [];
  for (const item of items) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
    out.push({ ...item });
  }
  return out;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export const isEmail = (value: string): boolean =>
  value.length <= 254 && EMAIL_PATTERN.test(value);

export const isTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
};
