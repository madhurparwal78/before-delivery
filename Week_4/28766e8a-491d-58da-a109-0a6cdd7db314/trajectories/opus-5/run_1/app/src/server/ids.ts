export type IdPrefix = 'd' | 'p' | 'l' | 's' | 'c' | 'g' | 'm' | 'v' | 'x' | 'i' | 'u';

const LENGTH = 12;
let last = 0;

/**
 * Ids are a prefix and 12 lowercase letters or digits. They rise in creation order, so a
 * page's connectors sort by id in the order they were created, which router rule 7 relies
 * on.
 */
export function newId(prefix: IdPrefix): string {
  const now = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  last = Math.max(last + 1, now);
  return `${prefix}_${last.toString(36).padStart(LENGTH, '0')}`;
}
