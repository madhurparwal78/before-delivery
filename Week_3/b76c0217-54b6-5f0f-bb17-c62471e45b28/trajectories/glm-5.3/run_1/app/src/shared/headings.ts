import { parsePage, walkHeadings, anchorSlug } from './markdown';
import type { Block } from './markdown';

export type Heading = { text: string; level: number; anchor: string };

export function pageHeadings(source: string): Heading[] {
  const parsed = parsePage(source);
  const out: Heading[] = [];
  walkHeadings(parsed.blocks, (h) => {
    if (h.anchor) out.push({ text: h.text, level: h.level, anchor: h.anchor });
  });
  return out;
}

export function pageHasAnchor(source: string, anchor: string): boolean {
  return pageHeadings(source).some((h) => h.anchor === anchor);
}

export function renderSourceHeadingLevel(level: number): number {
  return level <= 1 ? 2 : level;
}

export { anchorSlug, parsePage };
export type { Block };
