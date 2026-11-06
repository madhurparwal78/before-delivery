const COMBINING_MARKS = /\p{M}/gu;
const WHITESPACE_RUNS = /\s+/gu;

/**
 * The comparison form used by session search and by speaker slugs: NFD
 * decomposition, combining marks removed, lower-cased, whitespace runs
 * collapsed to one space.
 */
export function fold(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase().replace(WHITESPACE_RUNS, ' ');
}

const NON_SLUG_RUNS = /[^a-z0-9]+/g;

export function speakerSlug(name: string): string {
  return fold(name).replace(NON_SLUG_RUNS, '-');
}
