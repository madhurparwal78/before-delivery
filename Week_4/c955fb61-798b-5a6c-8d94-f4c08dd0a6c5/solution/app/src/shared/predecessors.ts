import type { Item, Link } from "./types";

/** The canonical Predecessors text of an item: entries in predecessor row order, `2FS+1, 3SS-2, 4FF`. */
export function canonicalPredecessors(itemId: string, items: readonly Item[], links: readonly Link[]): string {
  const rowOf = new Map(items.map((item) => [item.id, item.row]));
  return links
    .filter((link) => link.to === itemId)
    .sort((a, b) => (rowOf.get(a.from) ?? 0) - (rowOf.get(b.from) ?? 0))
    .map((link) => `${rowOf.get(link.from)}${link.type}${link.lag === 0 ? "" : link.lag > 0 ? `+${link.lag}` : `${link.lag}`}`)
    .join(", ");
}
