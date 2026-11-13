import type { Chapter } from '../../shared/copy.js';

export interface ChapterRange {
  chapter: Chapter;
  from: number;
  to: number;
  title: string;
}

/** Progress runs through seven ranges, each including its lower edge. */
export const chapterRanges: ChapterRange[] = [
  { chapter: 'alley', from: 0, to: 0.12, title: 'The alley' },
  { chapter: 'stove', from: 0.12, to: 0.3, title: 'The iron stove' },
  { chapter: 'goose', from: 0.3, to: 0.46, title: 'The roast goose' },
  { chapter: 'tree', from: 0.46, to: 0.62, title: 'The Christmas-tree' },
  { chapter: 'star', from: 0.62, to: 0.72, title: 'The falling star' },
  { chapter: 'grandmother', from: 0.72, to: 0.86, title: 'Grandmother' },
  { chapter: 'shelf', from: 0.86, to: 1, title: 'The last bundle' },
];

export const SHELF_RANGE_START = 0.86;

export function chapterAt(progress: number): Chapter {
  if (progress >= 1) return 'shelf';
  for (const range of chapterRanges) {
    if (progress >= range.from && progress < range.to) return range.chapter;
  }
  return 'alley';
}

export function rangeOf(chapter: Chapter): ChapterRange {
  const found = chapterRanges.find((range) => range.chapter === chapter);
  return found ?? (chapterRanges[0] as ChapterRange);
}

export const strikeChapters: Chapter[] = ['stove', 'goose', 'tree', 'star', 'grandmother'];
