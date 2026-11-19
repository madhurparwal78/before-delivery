import { computeSpan } from '../shared/anchors.js';

/**
 * The editor works on text whose line breaks are all LF, the way a text field
 * counts them. These helpers map between that text and the stored bytes.
 */
export function normalise(stored: string): string {
  return stored.replace(/\r\n/g, '\n');
}

export function dominantBreak(stored: string): string {
  const index = stored.indexOf('\n');
  if (index < 0) return '\n';
  return index > 0 && stored.charAt(index - 1) === '\r' ? '\r\n' : '\n';
}

export function storedOffsetOf(stored: string, normalisedOffset: number): number {
  let normalisedSeen = 0;
  let index = 0;
  while (index < stored.length && normalisedSeen < normalisedOffset) {
    if (stored.charCodeAt(index) === 13 && stored.charCodeAt(index + 1) === 10) {
      index += 2;
    } else {
      index += 1;
    }
    normalisedSeen += 1;
  }
  return index;
}

export function normalisedOffsetOf(stored: string, storedOffset: number): number {
  let normalised = 0;
  let index = 0;
  while (index < storedOffset && index < stored.length) {
    if (stored.charCodeAt(index) === 13 && stored.charCodeAt(index + 1) === 10) {
      index += 2;
    } else {
      index += 1;
    }
    normalised += 1;
  }
  return normalised;
}

/** Only the replaced span changes, so untouched line breaks keep their bytes. */
export function storedAfterEdit(stored: string, nextNormalised: string): string {
  const span = computeSpan(normalise(stored), nextNormalised);
  const storedA = storedOffsetOf(stored, span.a);
  const storedB = storedOffsetOf(stored, span.b);
  const replacement = nextNormalised
    .slice(span.a, span.a + span.n)
    .replace(/\n/g, dominantBreak(stored));
  return stored.slice(0, storedA) + replacement + stored.slice(storedB);
}

export function lineStarts(normalised: string): number[] {
  const starts = [0];
  for (let index = 0; index < normalised.length; index += 1) {
    if (normalised.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

export function offsetOfLine(normalised: string, line: number): number {
  const starts = lineStarts(normalised);
  const index = Math.min(Math.max(line, 1), starts.length) - 1;
  return starts[index];
}

export function lineOfOffset(normalised: string, offset: number): number {
  const starts = lineStarts(normalised);
  let line = 1;
  for (let index = 0; index < starts.length; index += 1) {
    if (starts[index] <= offset) line = index + 1;
    else break;
  }
  return line;
}

export interface SectionEntry {
  title: string;
  line: number;
}

const SECTION_PATTERN = /\\(chapter|section|subsection)\*?\{([^}]*)\}/g;

export function sectionsOf(normalised: string): SectionEntry[] {
  const sections: SectionEntry[] = [];
  let match = SECTION_PATTERN.exec(normalised);
  while (match !== null) {
    sections.push({ title: match[2], line: lineOfOffset(normalised, match.index) });
    match = SECTION_PATTERN.exec(normalised);
  }
  SECTION_PATTERN.lastIndex = 0;
  return sections;
}
