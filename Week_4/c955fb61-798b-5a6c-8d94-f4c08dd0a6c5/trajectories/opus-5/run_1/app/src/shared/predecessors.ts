import type { LinkType } from './types.js';

export interface PredecessorEntry {
  row: number;
  type: LinkType;
  lag: number;
}

/** Entries in predecessor row order, joined by `, `, with the type always written. */
export function canonicalPredecessors(entries: readonly PredecessorEntry[]): string {
  return [...entries]
    .sort((a, b) => a.row - b.row)
    .map(
      (entry) =>
        `${entry.row}${entry.type}${entry.lag === 0 ? '' : entry.lag > 0 ? `+${entry.lag}` : `${entry.lag}`}`,
    )
    .join(', ');
}

/** The canonical text of an item's incoming links, read from the current row order. */
export function canonicalFor(
  itemId: string,
  links: readonly { from: string; to: string; type: LinkType; lag: number }[],
  rowOf: Map<string, number>,
): string {
  return canonicalPredecessors(
    links
      .filter((link) => link.to === itemId)
      .map((link) => ({ row: rowOf.get(link.from)!, type: link.type, lag: link.lag })),
  );
}
