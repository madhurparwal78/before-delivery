/** The one definition of the search match and the note snippet window. */

export const SEARCH_GROUP_LIMIT = 10;
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;

const SNIPPET_LEAD = 40;
const SNIPPET_LENGTH = 120;

/** Every character of the query matches only itself, `%`, `_` and `\` included. */
export function literalLikePattern(query: string): string {
  return `%${query.replace(/[\\%_]/gu, (character) => `\\${character}`)}%`;
}

export function buildSnippet(text: string, query: string, matchedTitleOnly: boolean): string {
  const index = matchedTitleOnly ? 0 : text.toLowerCase().indexOf(query.toLowerCase());
  let start = index <= 0 ? 0 : Math.max(0, index - SNIPPET_LEAD);
  let end = Math.min(text.length, start + SNIPPET_LENGTH);
  if (start > 0 && isLowSurrogate(text.charCodeAt(start))) start -= 1;
  if (end < text.length && isLowSurrogate(text.charCodeAt(end))) end += 1;
  const body = text.slice(start, end);
  return `${start > 0 ? '\u2026' : ''}${body}${end < text.length ? '\u2026' : ''}`;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
