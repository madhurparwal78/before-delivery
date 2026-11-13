import type { Category } from './api-types'

export const CATEGORIES: readonly Category[] = [
  'Shelter', 'Sleep', 'Pack', 'Kitchen', 'Water', 'Clothing', 'Electronics', 'Essentials', 'Hygiene', 'Food',
]

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value)
}

export function categoryRank(category: Category): number {
  return CATEGORIES.indexOf(category)
}

/** The canonical category for text compared case-insensitively, as an import file writes it. */
export function categoryFromText(text: string): Category | null {
  const wanted = text.toLowerCase()
  return CATEGORIES.find((category) => category.toLowerCase() === wanted) ?? null
}
