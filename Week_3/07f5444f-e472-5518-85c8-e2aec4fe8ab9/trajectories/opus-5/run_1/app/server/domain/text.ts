const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export type SingleLineField = 'title' | 'publisher';

export interface SingleLineResult {
  value: string;
  message: string | null;
}

const LABELS: Record<SingleLineField, string> = { title: 'Title', publisher: 'Publisher' };

/**
 * Single-line text: no control characters at all, and 1 to 120 characters after trimming
 * spaces. The control-character check comes first.
 */
export function readSingleLineText(field: SingleLineField, raw: unknown): SingleLineResult {
  const label = LABELS[field];
  if (typeof raw !== 'string') {
    return { value: '', message: `${label} must be 1 to 120 characters.` };
  }
  if (CONTROL_CHARACTERS.test(raw)) {
    return { value: raw, message: `${label} must be one line of text.` };
  }
  const trimmed = trimSpaces(raw);
  if ([...trimmed].length < 1 || [...trimmed].length > 120) {
    return { value: trimmed, message: `${label} must be 1 to 120 characters.` };
  }
  return { value: trimmed, message: null };
}

/** Only leading and trailing spaces are trimmed. */
export function trimSpaces(value: string): string {
  return value.replace(/^ +/, '').replace(/ +$/, '');
}

export function hasControlCharacter(value: string): boolean {
  return CONTROL_CHARACTERS.test(value);
}
