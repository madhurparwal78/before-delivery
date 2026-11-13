export const CHAPTERS = [
  { id: 'opening', title: 'Opening' },
  { id: 'about', title: 'About' },
  { id: 'oxygen', title: 'Oxygen & Energy' },
  { id: 'science', title: 'Science & Technology' },
  { id: 'product', title: 'Product' },
  { id: 'interviews', title: 'Interviews' },
  { id: 'lifestyle', title: 'Lifestyle' },
] as const;

export type ChapterId = (typeof CHAPTERS)[number]['id'];

export const FIRST_CHAPTER_ID: ChapterId = 'opening';

/** The two-digit number a rail and menu stop carries before its title. */
export function chapterNumber(index: number): string {
  return String(index + 1).padStart(2, '0');
}

export function isChapterId(value: string): value is ChapterId {
  return CHAPTERS.some((chapter) => chapter.id === value);
}
