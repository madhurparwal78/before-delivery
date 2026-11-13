interface LinkTarget {
  labelStart: number;
  labelEnd: number;
  targetStart: number;
  targetEnd: number;
}

interface Address {
  start: number;
  end: number;
  url: string;
}

const ADDRESS_START = /https?:\/\//gi;
const ADDRESS_STOPS = new Set([' ', '\t', '\n', '\r', '<', '>', '"', "'", ')', ']']);
const TRAILING = new Set(['.', ',', ';', ':', '!', '?']);

export function allowedTarget(target: string): boolean {
  return /^(https?:|mailto:)/i.test(target.replace(/^[\s\u0000-\u001f]+/, ''));
}

export function findLinkTargets(text: string): LinkTarget[] {
  const found: LinkTarget[] = [];
  let from = 0;
  while (from < text.length) {
    const open = text.indexOf('[', from);
    if (open < 0) break;
    const close = text.indexOf(']', open + 1);
    if (close < 0) break;
    const end = text[close + 1] === '(' ? matchingParen(text, close + 1) : -1;
    if (end < 0) {
      from = open + 1;
      continue;
    }
    found.push({ labelStart: open + 1, labelEnd: close, targetStart: close + 2, targetEnd: end });
    from = end + 1;
  }
  return found;
}

function matchingParen(text: string, open: number): number {
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

export function addressEnd(text: string, start: number): number {
  let end = start;
  while (end < text.length && !ADDRESS_STOPS.has(text[end] as string)) end += 1;
  while (end > start && TRAILING.has(text[end - 1] as string)) end -= 1;
  return end;
}

export function findAddresses(text: string): Address[] {
  const targets = findLinkTargets(text);
  const found: Address[] = [];
  ADDRESS_START.lastIndex = 0;
  let from = 0;
  while (from < text.length) {
    ADDRESS_START.lastIndex = from;
    const match = ADDRESS_START.exec(text);
    if (!match) break;
    const start = match.index;
    const target = targets.find((t) => firstNonSpace(text, t.targetStart) === start);
    const end = target ? target.targetEnd : addressEnd(text, start);
    found.push({ start, end, url: text.slice(start, end) });
    from = Math.max(end, start + 1);
  }
  return found;
}

function firstNonSpace(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i] as string)) i += 1;
  return i;
}
