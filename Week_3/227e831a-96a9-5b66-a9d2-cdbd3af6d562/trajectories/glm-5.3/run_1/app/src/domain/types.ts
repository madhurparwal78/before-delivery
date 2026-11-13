/** The ten closet categories, in the one category order the whole app follows. */
export const CATEGORIES = [
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

export type Category = (typeof CATEGORIES)[number];

/** A list's state machine: planning → packed → { planning, walked }. */
export const LIST_STATES = ['planning', 'packed', 'walked'] as const;
export type ListState = (typeof LIST_STATES)[number];

/** The one decision for legal trip-list state moves. */
export function legalListStateMove(from: ListState, to: ListState): boolean {
  return (from === 'planning' && to === 'packed') || (from === 'packed' && to === 'planning') || (from === 'packed' && to === 'walked');
}

export const CARRY_MODES = ['base', 'worn', 'consumable'] as const;
export type CarryMode = (typeof CARRY_MODES)[number];

export type DisplayUnit = 'g' | 'oz' | 'lb';
export type PaperSize = 'A4' | 'Letter';
export type ItemStatus = 'active' | 'retired';
export type RetireReason = 'sold' | 'retired' | 'lost';
export type ImportStatus = 'previewed' | 'committed';
export type RowOutcome = 'matched' | 'created' | 'rejected';
export type SheetStatus = 'ready';

/** Canonical category from any case: returns null when it is not one of the ten. */
export function canonicalCategory(value: string): Category | null {
  const trimmed = value.trim();
  for (const category of CATEGORIES) {
    if (category.toLowerCase() === trimmed.toLowerCase()) return category;
  }
  return null;
}
