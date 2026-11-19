// Text rules shared by the browser and the server.

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Length in user-perceived characters, so an emoji family counts as one. */
export function characters(value: string): number {
  let count = 0;
  for (const _ of graphemes.segment(value)) count += 1;
  return count;
}

/** A specimen reference: 1 to 80 ASCII letters, digits or hyphens. */
export const REFERENCE_PATTERN = /^[A-Za-z0-9-]{1,80}$/;
