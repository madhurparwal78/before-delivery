const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Counts user-perceived characters, so an emoji or an accented letter counts as one. */
export function graphemeLength(value: string): number {
  let n = 0;
  for (const _ of GRAPHEMES.segment(value)) n += 1;
  return n;
}

export const MAX_SLUG_LENGTH = 60;

/**
 * Lowercase ASCII letters and digits; every other run of characters becomes one
 * hyphen, with no leading or trailing hyphen, at most 60 characters.
 */
export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');
  return base === '' ? 'model' : base;
}

/** Adds `-2`, `-3` and onwards while the slug is taken. */
export function uniqueSlug(title: string, taken: (slug: string) => boolean): string {
  const base = slugify(title);
  if (!taken(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken(candidate)) return candidate;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}
