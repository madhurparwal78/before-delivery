export interface RemovedSpan {
  start: number;
  end: number;
  text: string;
}

export interface SanitiserResult {
  before: string;
  after: string;
  removed: RemovedSpan[];
}

const ALLOWED_LINK_SCHEMES = ['http:', 'https:', 'mailto:'];

function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z]/.test(ch);
}

/** The scheme is compared case-insensitively, ignoring leading spaces and control characters. */
function hasAllowedScheme(target: string): boolean {
  let index = 0;
  while (index < target.length) {
    const code = target.charCodeAt(index);
    if (code === 0x20 || code <= 0x1f || code === 0x7f) index += 1;
    else break;
  }
  const rest = target.slice(index).toLowerCase();
  return ALLOWED_LINK_SCHEMES.some((scheme) => rest.startsWith(scheme));
}

/** Finds the `)` matching the `(` at `open`, counting nested parentheses. */
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
 * The published removal rules: markup-like spans, and the target of a
 * `[label](target)` link whose target is not an absolute http, https or
 * mailto address.
 */
export function sanitise(before: string): SanitiserResult {
  const removed: RemovedSpan[] = [];
  let i = 0;
  while (i < before.length) {
    const ch = before[i];
    if (ch === '<') {
      const next = before[i + 1];
      if (isLetter(next) || next === '/' || next === '!') {
        const close = before.indexOf('>', i + 1);
        if (close !== -1) {
          removed.push({ start: i, end: close + 1, text: before.slice(i, close + 1) });
          i = close + 1;
          continue;
        }
      }
      i += 1;
      continue;
    }
    if (ch === '[') {
      const labelEnd = before.indexOf(']', i + 1);
      if (labelEnd !== -1 && before[labelEnd + 1] === '(') {
        const open = labelEnd + 1;
        const close = matchingParen(before, open);
        if (close !== -1) {
          const target = before.slice(open + 1, close);
          if (!hasAllowedScheme(target)) {
            removed.push({ start: open, end: close + 1, text: before.slice(open, close + 1) });
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
    i += 1;
  }

  let after = '';
  let cursor = 0;
  for (const span of removed) {
    after += before.slice(cursor, span.start);
    cursor = span.end;
  }
  after += before.slice(cursor);
  return { before, after, removed };
}

export function sanitiserVerdict(removedCount: number): string {
  return removedCount === 0 ? 'nothing removed' : `${removedCount} removed`;
}
