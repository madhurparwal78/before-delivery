/** The seven chapter ranges and their edges. */
export const CHAPTERS = ['alley', 'stove', 'goose', 'tree', 'star', 'grandmother', 'shelf'] as const;
export type Chapter = typeof CHAPTERS[number];

export const CHAPTER_RANGES: { chapter: Chapter; start: number; end: number }[] = [
  { chapter: 'alley', start: 0, end: 0.12 },
  { chapter: 'stove', start: 0.12, end: 0.30 },
  { chapter: 'goose', start: 0.30, end: 0.46 },
  { chapter: 'tree', start: 0.46, end: 0.62 },
  { chapter: 'star', start: 0.62, end: 0.72 },
  { chapter: 'grandmother', start: 0.72, end: 0.86 },
  { chapter: 'shelf', start: 0.86, end: 1.0 },
];

export function chapterFor(progress: number): Chapter {
  for (const r of CHAPTER_RANGES) {
    if (progress >= r.start && (progress < r.end || (r.end === 1 && progress <= 1))) return r.chapter;
  }
  return 'alley';
}

export const SHELF_START = 0.86;
export const STRIKE_CHAPTERS: Chapter[] = ['stove', 'goose', 'tree', 'star', 'grandmother'];
