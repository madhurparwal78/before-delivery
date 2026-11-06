// Length limits count Unicode code points; a limit's end value is allowed (brief: Text).
// Shared by the server, which enforces the limits, and the upload control, which pre-checks names.

/** Attachment file names: 1 to 255 characters (brief: Attachments). */
export const FILENAME_LIMIT = 255;

/** Attachment files: 1 to 10,000,000 bytes (brief: Attachments). */
export const FILE_LIMIT = 10_000_000;

export function codePoints(value: string): number {
  let count = 0;
  for (const _ of value) count++;
  return count;
}

/** U+0000 and unpaired surrogates cannot be stored as submitted. */
const UNSTORABLE = /\u0000|\p{Cs}/u;

/** A storable string of `min`..`max` code points; with `min` above 0, whitespace alone is refused. */
export function textWithin(value: unknown, min: number, max: number): value is string {
  if (typeof value !== "string" || UNSTORABLE.test(value)) return false;
  const length = codePoints(value);
  if (length < min || length > max) return false;
  return min === 0 || value.trim() !== "";
}
