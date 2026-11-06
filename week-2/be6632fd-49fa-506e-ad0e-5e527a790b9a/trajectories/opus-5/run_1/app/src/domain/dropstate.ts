export const DROP_STATUSES = ['draft', 'scheduled', 'live', 'sold_out', 'withdrawn'] as const;
export type DropStatus = (typeof DROP_STATUSES)[number];

export const PUBLIC_DROP_STATUSES = ['upcoming', 'live', 'sold_out'] as const;
export type PublicDropStatus = (typeof PUBLIC_DROP_STATUSES)[number];

export type MarketStatus = 'upcoming' | 'live' | 'sold_out';

const LEGAL_EDGES: ReadonlyArray<readonly [DropStatus, DropStatus]> = [
  ['draft', 'scheduled'],
  ['scheduled', 'live'],
  ['live', 'sold_out'],
  ['sold_out', 'live'],
  ['scheduled', 'withdrawn'],
  ['live', 'withdrawn'],
  ['sold_out', 'withdrawn'],
];

export function isLegalTransition(from: DropStatus, to: DropStatus): boolean {
  return LEGAL_EDGES.some(([a, b]) => a === from && b === to);
}

/** Timing, pieces, palette and the hold length change only in draft or scheduled. */
export function isPlanningOpen(status: DropStatus): boolean {
  return status === 'draft' || status === 'scheduled';
}

export function isPublicStatus(status: DropStatus): boolean {
  return status === 'scheduled' || status === 'live' || status === 'sold_out';
}

/** The public status word for a drop that is on a public surface. */
export function publicStatusOf(status: DropStatus): PublicDropStatus {
  if (status === 'live') return 'live';
  if (status === 'sold_out') return 'sold_out';
  return 'upcoming';
}

/**
 * A market is upcoming before its go-live instant, sold out when its claims equal its store
 * pieces, and live otherwise.
 */
export function marketStatusOf(input: {
  goLiveAtMs: number | null;
  nowMs: number;
  storePieces: number;
  claimed: number;
}): MarketStatus {
  if (input.goLiveAtMs === null || input.nowMs < input.goLiveAtMs) return 'upcoming';
  if (input.claimed >= input.storePieces) return 'sold_out';
  return 'live';
}

/** Pieces left are store pieces minus claims minus live holds. */
export function piecesLeftOf(storePieces: number, claimed: number, held: number): number {
  return Math.max(0, storePieces - claimed - held);
}

export const STATUS_WORDS: Record<PublicDropStatus | 'withdrawn', string> = {
  upcoming: 'Upcoming',
  live: 'Live',
  sold_out: 'Sold out',
  withdrawn: 'Withdrawn',
};
