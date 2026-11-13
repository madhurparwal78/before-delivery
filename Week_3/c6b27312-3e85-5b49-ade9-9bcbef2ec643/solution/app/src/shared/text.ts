// Stored text: NFC, and lengths counted in grapheme segments.

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

export function normalizeText(value: string): string {
  return value.normalize("NFC");
}

export function graphemeCount(value: string): number {
  let n = 0;
  for (const _ of segmenter.segment(value)) n += 1;
  return n;
}

export const TITLE_MAX = 80;
export const DISPLAY_NAME_MAX = 40;

/** The text in NFC, when it is 1 to `max` grapheme segments long; otherwise null. */
export function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = normalizeText(value);
  const length = graphemeCount(text);
  return length >= 1 && length <= max ? text : null;
}

export const boundedMessage = (max: number): string => `Use 1 to ${max} characters.`;

/** Emails compare as email.toUpperCase().toLowerCase(). */
export function foldEmail(email: string): string {
  return email.toUpperCase().toLowerCase();
}

/** `holeDia` → `Hole dia`, `span2` → `Span 2`: split before each capital letter and digit run, sentence case. */
export function labelOf(name: string): string {
  const words = name.replace(/([A-Z])/g, " $1").replace(/(\d+)/g, " $1").trim().replace(/\s+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
