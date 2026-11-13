import { addressEnd, allowedTarget, findLinkTargets } from './links.js';

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: InlineNode[] };

const isWordChar = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}]/u.test(char);

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let plain = '';
  const flush = (): void => {
    if (plain) nodes.push({ type: 'text', text: plain });
    plain = '';
  };
  const targets = findLinkTargets(text);
  let i = 0;
  while (i < text.length) {
    const char = text[i] as string;
    if (char === '`') {
      const close = text.indexOf('`', i + 1);
      if (close > i + 1) {
        flush();
        nodes.push({ type: 'code', text: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    if (char === '[') {
      const target = targets.find((t) => t.labelStart === i + 1);
      const href = target ? text.slice(target.targetStart, target.targetEnd).trim() : '';
      if (target && allowedTarget(href)) {
        flush();
        nodes.push({ type: 'link', href, children: parseInline(text.slice(target.labelStart, target.labelEnd)) });
        i = target.targetEnd + 1;
        continue;
      }
    }
    if (/^https?:\/\//i.test(text.slice(i, i + 8)) && !isWordChar(text[i - 1])) {
      const end = addressEnd(text, i);
      flush();
      const href = text.slice(i, end);
      nodes.push({ type: 'link', href, children: [{ type: 'text', text: href }] });
      i = end;
      continue;
    }
    if (char === '*' || char === '_') {
      const close = emphasisClose(text, i, char);
      if (close > 0) {
        flush();
        nodes.push({ type: 'em', children: parseInline(text.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }
    plain += char;
    i += 1;
  }
  flush();
  return nodes;
}

function emphasisClose(text: string, open: number, mark: string): number {
  if (mark === '_' && isWordChar(text[open - 1])) return -1;
  const first = text[open + 1];
  if (first === undefined || /\s/.test(first)) return -1;
  for (let close = open + 1; close < text.length; close += 1) {
    if (text[close] !== mark) continue;
    const before = text[close - 1] as string;
    if (close === open + 1 || /\s/.test(before)) continue;
    if (mark === '_' && isWordChar(text[close + 1])) continue;
    return close;
  }
  return -1;
}
