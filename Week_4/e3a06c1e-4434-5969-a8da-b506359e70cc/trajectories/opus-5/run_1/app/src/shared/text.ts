const leading = /^\p{White_Space}+/u;
const trailing = /\p{White_Space}+$/u;
const whitespaceRun = /\p{White_Space}+/u;

/** The text-limit rule: NFC normalise, trim Unicode whitespace, count code points. */
export const normaliseText = (raw: string): string => raw.normalize('NFC').replace(leading, '').replace(trailing, '');

export const codePointCount = (value: string): number => [...value].length;

export interface TextCheck {
  readonly value: string;
  readonly length: number;
  readonly ok: boolean;
}

export const checkText = (raw: unknown, min: number, max: number): TextCheck => {
  if (typeof raw !== 'string') return { value: '', length: 0, ok: min === 0 };
  const value = normaliseText(raw);
  const length = codePointCount(value);
  return { value, length, ok: length >= min && length <= max };
};

export const checkEmail = (raw: unknown): TextCheck => {
  const checked = checkText(raw, 1, 200);
  if (!checked.ok) return { ...checked, ok: false };
  const parts = checked.value.split('@');
  const ok = parts.length === 2 && parts[0] !== undefined && parts[0].length > 0 && (parts[1]?.length ?? 0) > 0;
  return { ...checked, ok };
};

/** Words are the runs of text between Unicode whitespace. */
export const splitWords = (value: string): string[] => value.split(whitespaceRun).filter((word) => word.length > 0);

export const checkPassword = (raw: unknown): boolean => typeof raw === 'string' && codePointCount(raw) >= 12;
