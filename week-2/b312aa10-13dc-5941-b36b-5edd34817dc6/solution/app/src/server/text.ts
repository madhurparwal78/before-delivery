// Text fields: normalised to NFC when saved and measured in Unicode code points of the NFC text.
// Nothing is trimmed. Business names also refuse control characters and line or paragraph separators.

/** The NFC text when it is a string of `min` to `max` code points, otherwise null. */
export function boundedText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFC");
  const length = [...text].length;
  return length >= min && length <= max ? text : null;
}

const REFUSED_IN_NAMES = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

/** A business name of 1 to 80 code points with no refused character, in NFC, or null. */
export function businessName(value: unknown): string | null {
  const text = boundedText(value, 1, 80);
  return text !== null && !REFUSED_IN_NAMES.test(text) ? text : null;
}

/** An email address as the forms accept it: a local part (which RFC 5322 lets hold spaces when quoted) and a dotted domain. */
export const EMAIL = /^[^@]+@[^\s@]+\.[^\s@]+$/;
