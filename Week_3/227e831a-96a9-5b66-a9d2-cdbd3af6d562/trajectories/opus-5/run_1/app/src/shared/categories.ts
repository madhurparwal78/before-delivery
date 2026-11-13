export const CATEGORY_ORDER = [
  'Shelter',
  'Sleep',
  'Pack',
  'Kitchen',
  'Water',
  'Clothing',
  'Electronics',
  'Essentials',
  'Hygiene',
  'Food',
] as const;

export type Category = (typeof CATEGORY_ORDER)[number];

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORY_ORDER as readonly string[]).includes(value);
}

/** The canonical spelling of a category named case-insensitively, as imports name it. */
export function canonicalCategory(value: string): Category | null {
  const wanted = value.trim().toLowerCase();
  return CATEGORY_ORDER.find((category) => category.toLowerCase() === wanted) ?? null;
}

export function categoryRank(category: string): number {
  const index = (CATEGORY_ORDER as readonly string[]).indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}
