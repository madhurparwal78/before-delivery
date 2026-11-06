// Text rules shared by the API and the browser.

/** Every carriage return, line feed and other control character becomes one space. */
export function singleLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ");
}

/** Lower case, accents removed, each run of other characters replaced by one hyphen. */
export function slugBase(displayName: string): string {
  return displayName
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/** User-perceived characters (grapheme clusters). */
export function graphemeCount(value: string): number {
  return [...segmenter.segment(value)].length;
}

export const BIO_LIMIT = 600;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

/** Lower-cased, inner spaces collapsed; accents kept. */
export function normalName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
