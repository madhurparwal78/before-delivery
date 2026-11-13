import { allowedTarget, findLinkTargets } from './links.js';

interface RemovedSpan {
  start: number;
  end: number;
  text: string;
}

export interface Sanitised {
  before: string;
  after: string;
  removed: RemovedSpan[];
}

function tagSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '<' && /[\p{L}/!]/u.test(text[i + 1] ?? '')) {
      const close = text.indexOf('>', i + 1);
      if (close >= 0) {
        spans.push([i, close + 1]);
        i = close + 1;
        continue;
      }
    }
    i += 1;
  }
  return spans;
}

function unsafeTargetSpans(text: string): [number, number][] {
  return findLinkTargets(text)
    .filter((link) => !allowedTarget(text.slice(link.targetStart, link.targetEnd)))
    .map((link): [number, number] => [link.targetStart - 1, link.targetEnd + 1]);
}

const inside = (inner: [number, number], outer: [number, number]): boolean => inner[0] >= outer[0] && inner[1] <= outer[1];
const overlaps = (a: [number, number], b: [number, number]): boolean => a[0] < b[1] && b[0] < a[1];

export function sanitise(before: string): Sanitised {
  const tags = tagSpans(before);
  const targets = unsafeTargetSpans(before).filter((target) => !tags.some((tag) => overlaps(tag, target) && !inside(tag, target)) && !tags.some((tag) => inside(target, tag)));
  const spans = [...tags.filter((tag) => !targets.some((target) => inside(tag, target))), ...targets].sort((a, b) => a[0] - b[0]);
  let after = '';
  let cursor = 0;
  for (const [start, end] of spans) {
    after += before.slice(cursor, start);
    cursor = end;
  }
  after += before.slice(cursor);
  return { before, after, removed: spans.map(([start, end]) => ({ start, end, text: before.slice(start, end) })) };
}

export const sanitiserVerdict = (removed: readonly RemovedSpan[]): string => (removed.length === 0 ? 'nothing removed' : `${removed.length} removed`);
