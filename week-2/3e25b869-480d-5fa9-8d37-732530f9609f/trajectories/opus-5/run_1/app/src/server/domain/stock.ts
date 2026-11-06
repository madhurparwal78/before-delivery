import type { Bar, BarStatus } from '../../shared/types.js';

export type MovementKind = 'cut' | 'sale' | 'restock';

export type StockMovement = { kind: MovementKind; bars: number[] };

export type StockCounts = { cut: number; sold: number; held: number; available: number };

/**
 * The single reading of a batch's stock: bar states come from the ledger, then active holds take
 * precedence over the bars that are still available.
 */
export function readStock(
  barsCut: number,
  movements: readonly StockMovement[],
  heldBars: ReadonlySet<number>,
): { bars: Bar[]; counts: StockCounts } {
  const sold = new Set<number>();
  for (const movement of movements) {
    for (const bar of movement.bars) {
      if (movement.kind === 'sale') sold.add(bar);
      else if (movement.kind === 'restock') sold.delete(bar);
    }
  }
  const bars: Bar[] = [];
  let soldCount = 0;
  let heldCount = 0;
  for (let number = 1; number <= barsCut; number += 1) {
    let status: BarStatus;
    if (sold.has(number)) {
      status = 'sold';
      soldCount += 1;
    } else if (heldBars.has(number)) {
      status = 'held';
      heldCount += 1;
    } else {
      status = 'available';
    }
    bars.push({ number, status });
  }
  return {
    bars,
    counts: {
      cut: barsCut,
      sold: soldCount,
      held: heldCount,
      available: barsCut - soldCount - heldCount,
    },
  };
}

/** Holds always take the lowest-numbered available bar. */
export function lowestAvailableBar(bars: readonly Bar[]): number | null {
  for (const bar of bars) if (bar.status === 'available') return bar.number;
  return null;
}
