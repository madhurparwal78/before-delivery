const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Counts user-perceived characters, so one joined emoji counts as 1. */
export function graphemeLength(value: string): number {
  let count = 0;
  for (const _ of segmenter.segment(value)) count += 1;
  return count;
}

export function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

/** `elapsed_ms` rounded down to whole seconds, as `0:07`, `12:04` or `1:02:09`. */
export function formatTime(elapsedMs: number): string {
  const total = Math.floor(elapsedMs / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const two = (n: number): string => String(n).padStart(2, '0');
  if (total < 3600) return `${minutes}:${two(seconds)}`;
  return `${hours}:${two(minutes)}:${two(seconds)}`;
}

/** The UTC calendar date of an ISO timestamp as `YYYY-MM-DD`. */
export function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** `Revealed 1 square` / `Revealed <n> squares`. */
export function revealedPhrase(count: number): string {
  return count === 1 ? 'Revealed 1 square' : `Revealed ${count} squares`;
}

export function squareCountPhrase(count: number): string {
  return count === 1 ? '1 square' : `${count} squares`;
}

/** Joins items with `, ` and ` and ` before the last. */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Title in lower case, runs of other characters to one hyphen, or `puzzle`. */
export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'puzzle' : slug;
}
