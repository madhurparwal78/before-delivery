import type { LibraryCard } from "../../shared/api.ts";
import { BADGES, type Badge } from "../../shared/domain.ts";

export interface Filters {
  /** Class label, or empty for all classes. */
  classLabel: string;
  badges: ReadonlySet<Badge>;
  query: string;
}

/** Instant client-side filtering: class, ticked badges, and a case-insensitive match on card name or class label. */
export function applyFilters(cards: readonly LibraryCard[], filters: Filters): LibraryCard[] {
  const query = filters.query.trim().toLowerCase();
  return cards.filter(
    (card) =>
      (filters.classLabel === "" || card.classLabel === filters.classLabel) &&
      (filters.badges.size === 0 || filters.badges.has(card.badge)) &&
      (query === "" || card.cardName.toLowerCase().includes(query) || card.classLabel.toLowerCase().includes(query)),
  );
}

/** `status "Library results"`: the count, then one `, <value>` per active filter (class, badges in order, query). */
export function resultsSentence(count: number, filters: Filters): string {
  const parts = [count === 1 ? "1 asset" : `${count} assets`];
  if (filters.classLabel) parts.push(filters.classLabel);
  for (const badge of BADGES) if (filters.badges.has(badge)) parts.push(badge);
  const query = filters.query.trim();
  if (query) parts.push(`matching "${query}"`);
  return parts.join(", ");
}
