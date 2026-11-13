// The one sanitiser removal decision.
export interface RemovedSpan {
  start: number;
  end: number;
  text: string;
}
export interface SanitiserResult {
  verdict: string;
  before: string;
  after: string;
  removed: RemovedSpan[];
}
function isSurrogateTailHalf(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  const previous = index > 0 ? text.charCodeAt(index - 1) : 0;
  return code >= 0xDC00 && code <= 0xDFFF && !(previous >= 0xD800 && previous <= 0xDBFF);
}
/**
 * Applies the two published removal rules to the submitted text and returns
 * the removed spans with UTF-16 code-unit offsets (end exclusive).
 */
export function computeSanitiser(text: string): SanitiserResult {
  const removed: RemovedSpan[] = [];
  const kill: boolean[] = new Array(text.length).fill(false);
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '<') continue;
    const next = text[i + 1];
    if (next === undefined) continue;
    if (!(/[a-zA-Z/!]/).test(next)) continue;
    const close = text.indexOf('>', i + 1);
    if (close === -1) continue;
    for (let j = i; j <= close; j += 1) kill[j] = true;
    i = close;
  }
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '[') continue;
    const close = text.indexOf(']', i + 1);
    if (close === -1) continue;
    if (text[close + 1] !== '(') continue;
    const end = matchingParen(text, close + 1);
    if (end === -1) continue;
    const target = text.slice(close + 2, end);
    if (isAllowedScheme(target)) continue;
    for (let j = close + 1; j <= end; j += 1) kill[j] = true;
    i = end;
  }
  let after = '';
  let cursor = 0;
  let spans = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (!kill[i]) continue;
    const keepEnd = i;
    while (i < text.length && kill[i]) i += 1;
    spans += 1;
    after += text.slice(cursor, keepEnd);
    cursor = i;
    i -= 1;
  }
  after += text.slice(cursor);
  const removedSpans: RemovedSpan[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (!kill[i]) continue;
    const start = i;
    while (i < text.length && kill[i]) i += 1;
    removedSpans.push({ start, end: i, text: text.slice(start, i) });
    i -= 1;
  }
  return { verdict: spans === 0 ? 'nothing removed' : `${spans} removed`, before: text, after, removed: removedSpans };
}

export function matchingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}
export function isAllowedScheme(target: string): boolean {
  const trimmed = target.replace(/^[\s\u0000-\u001F]+/, '');
  const lowered = trimmed.toLowerCase();
  return lowered.startsWith('http:') || lowered.startsWith('https:') || lowered.startsWith('mailto:');
}
export { isSurrogateTailHalf };
