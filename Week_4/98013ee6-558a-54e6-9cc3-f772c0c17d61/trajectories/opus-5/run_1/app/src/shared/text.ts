const TAG_BODY = /[A-Za-z0-9_]/;

export function codePoints(value: string): number {
  return [...value].length;
}

/**
 * A tag is a `#` at the start of the text or after a character that is not a
 * letter, digit or underscore, followed by 1 to 30 letters, digits or underscores.
 * Longer runs are not tags.
 */
export function extractTags(...texts: string[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    const chars = [...text];
    for (let index = 0; index < chars.length; index += 1) {
      if (chars[index] !== '#') continue;
      const before = index === 0 ? null : chars[index - 1];
      if (before !== null && TAG_BODY.test(before)) continue;
      let end = index + 1;
      while (end < chars.length && TAG_BODY.test(chars[end])) end += 1;
      const run = chars.slice(index + 1, end).join('');
      index = end - 1;
      if (run.length < 1 || run.length > 30) continue;
      const tag = run.toLowerCase();
      if (!seen.has(tag)) {
        seen.add(tag);
        found.push(tag);
      }
    }
  }
  return found;
}

/** The fragment being typed right before the caret, without the `#`, or null. */
export function tagFragmentAt(text: string, caret: number): { fragment: string; start: number } | null {
  const upto = text.slice(0, caret);
  const match = /#([A-Za-z0-9_]{1,30})$/.exec(upto);
  if (!match) return null;
  const start = upto.length - match[0].length;
  if (start > 0 && TAG_BODY.test(upto[start - 1])) return null;
  return { fragment: match[1], start };
}

/** Source links must be absolute http or https URLs. */
export function parseSource(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  return url;
}

/** The displayed host: lowercase, no leading www., no default port. */
export function sourceHost(value: string): string | null {
  const url = parseSource(value);
  if (!url) return null;
  let host = url.hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  const port = url.port;
  if (!port) return host;
  if (url.protocol === 'https:' && port === '443') return host;
  if (url.protocol === 'http:' && port === '80') return host;
  return `${host}:${port}`;
}

const WORD = /[\p{L}\p{N}]+/gu;

export function queryWords(query: string): string[] {
  return [...query.matchAll(WORD)].map((match) => match[0].toLowerCase());
}
