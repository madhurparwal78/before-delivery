const ADDRESS_STOP = new Set([' ', '\t', '\n', '\r', '<', '>', '"', "'", ')', ']']);
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?']);

export interface FoundAddress {
  start: number;
  end: number;
  url: string;
}

/** True when `text` has `http://` or `https://` at `index`, compared case-insensitively. */
export function addressStartsAt(text: string, index: number): boolean {
  const head = text.slice(index, index + 8).toLowerCase();
  return head.startsWith('http://') || head.startsWith('https://');
}

/** Where a bare address starting at `start` ends, by the published address rule. */
export function addressEnd(text: string, start: number): number {
  let end = start;
  while (end < text.length && !ADDRESS_STOP.has(text[end] as string)) end += 1;
  while (end > start && TRAILING_PUNCTUATION.has(text[end - 1] as string)) end -= 1;
  return end;
}

function dropTrailingPunctuation(url: string): string {
  let end = url.length;
  while (end > 0 && TRAILING_PUNCTUATION.has(url[end - 1] as string)) end -= 1;
  return url.slice(0, end);
}

function matchingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * The first web address in the text, by position. A kept `[label](target)`
 * link's target counts as an address and ends at the matching `)`.
 */
export function findFirstAddress(text: string): FoundAddress | null {
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '[') {
      const labelEnd = text.indexOf(']', i + 1);
      if (labelEnd !== -1 && text[labelEnd + 1] === '(') {
        const open = labelEnd + 1;
        const close = matchingParen(text, open);
        if (close !== -1) {
          const target = text.slice(open + 1, close);
          const trimmed = target.replace(/^[\u0000-\u0020\u007f]+/, '');
          if (addressStartsAt(trimmed, 0)) {
            const url = dropTrailingPunctuation(trimmed);
            if (url.length > 0) return { start: open + 1, end: close, url };
          }
          i = close + 1;
          continue;
        }
        i = labelEnd + 1;
        continue;
      }
      i += 1;
      continue;
    }
    if ((ch === 'h' || ch === 'H') && addressStartsAt(text, i)) {
      const end = addressEnd(text, i);
      const url = text.slice(i, end);
      if (url.length > 0) return { start: i, end, url };
      i += 1;
      continue;
    }
    i += 1;
  }
  return null;
}
