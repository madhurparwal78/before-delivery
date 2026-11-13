import type { Category } from './api-types'

/** NFKC, trim, every run of white space to one space, lowercase. */
export function normaliseName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\p{White_Space}+/gu, ' ').toLowerCase()
}

export const ITEM_EXISTS = 'You already own an item with that name and category.'

/** An item's identity: its normalised name plus its category. */
export function itemIdentity(name: string, category: Category): string {
  return `${category}\u0000${normaliseName(name)}`
}
