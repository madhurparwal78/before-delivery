/** Layout chosen for a window width: the one place that decides. */
export type Layout = 'phone' | 'tablet' | 'desktop';

export function layoutForWidth(width: number): Layout {
  if (width <= 767) return 'phone';
  if (width <= 1099) return 'tablet';
  return 'desktop';
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The caret position after a replaced span, per the anchor rules. */
export function moveCaret(caret: number, a: number, b: number, n: number): number {
  if (a === b) return caret <= a ? caret : caret + n;
  if (caret >= b) return caret + n - (b - a);
  if (caret <= a) return caret;
  return a + n;
}

/** Convert a textarea selection (CRLF counted as one) to stored UTF-16 offsets. */
export function storedOffset(text: string, visualIndex: number): number {
  let stored = 0;
  let visual = 0;
  while (visual < visualIndex && stored < text.length) {
    if (text[stored] === '\r' && text[stored + 1] === '\n') stored += 2;
    else stored += 1;
    visual += 1;
  }
  return stored;
}

/** The number of lines the way the textbox counts them: each CRLF is one line break. */
export function lineCount(text: string): number {
  if (text.length === 0) return 1;
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lines++;
    else if (text[i] === '\r' && text[i + 1] === '\n') { lines++; i++; }
  }
  return lines;
}

/** Offset of the start of a line (1-based), counting CRLF as one break. */
export function lineStart(text: string, line: number): number {
  let current = 1;
  let i = 0;
  while (i < text.length && current < line) {
    if (text[i] === '\n') current++;
    else if (text[i] === '\r' && text[i + 1] === '\n') { current++; i++; }
    i++;
  }
  return i;
}

/** The line number (1-based) holding an offset. */
export function lineOfOffset(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') line++;
    else if (text[i] === '\r' && text[i + 1] === '\n') { line++; i++; }
  }
  return line;
}

/** Sections of the open file: \chapter, \section and \subsection titles. */
export interface Section {
  title: string;
  line: number;
}

export function sectionsOf(text: string): Section[] {
  const out: Section[] = [];
  const lines = splitLines(text);
  lines.forEach((line, idx) => {
    const m = /\\(chapter\*?|section\*?|subsection\*?)\{([^}]*)\}/.exec(line);
    if (!m) return;
    out.push({ title: m[2], line: idx + 1 });
  });
  return out;
}

export function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n');
  return normalized.split('\n');
}

/** A retry key for a save press. */
export function newRetryKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function fileKind(path: string): 'figure' | 'text' {
  if (/\.(png|jpe?g|pdf|svg)$/i.test(path)) return 'figure';
  return 'text';
}
