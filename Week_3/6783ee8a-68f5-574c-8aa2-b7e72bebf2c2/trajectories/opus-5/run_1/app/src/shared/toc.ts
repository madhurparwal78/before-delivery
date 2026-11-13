import { inlineText } from './markdown.js';
import type { Cell } from './types.js';

export interface HeadingEntry {
  cell_id: string;
  level: number;
  text: string;
  number: string;
}

/** The markdown headings of one cell source, outside code blocks, in order. */
export function cellHeadings(source: string): { level: number; text: string }[] {
  const headings: { level: number; text: string }[] = [];
  let fence: string | null = null;
  for (const line of source.split('\n')) {
    const fenceMatch = /^\s*(```|~~~)/.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1];
      else if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (match) headings.push({ level: match[1].length, text: inlineText(match[2]) });
  }
  return headings;
}

/**
 * The table of contents of a notebook. Each heading is numbered by the counters
 * of every level from the shallowest heading level used down to its own level;
 * a level that has not appeared under its parent counts as 0.
 */
export function tableOfContents(cells: Cell[]): HeadingEntry[] {
  const found: { cell_id: string; level: number; text: string }[] = [];
  for (const cell of cells) {
    if (cell.cell_type !== 'markdown') continue;
    for (const heading of cellHeadings(cell.source)) {
      found.push({ cell_id: cell.id, level: heading.level, text: heading.text });
    }
  }
  if (found.length === 0) return [];
  const shallowest = Math.min(...found.map((heading) => heading.level));
  const counters = new Array<number>(7).fill(0);
  return found.map((heading) => {
    counters[heading.level] += 1;
    for (let level = heading.level + 1; level <= 6; level += 1) counters[level] = 0;
    const parts: number[] = [];
    for (let level = shallowest; level <= heading.level; level += 1) parts.push(counters[level]);
    return { ...heading, number: parts.join('.') };
  });
}
