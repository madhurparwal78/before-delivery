import { formatMoney } from '../shared/format';
import { NOT_INSPECTED_LABEL, tierLabel, type Tier } from '../shared/labels';
import { announceStrength, logStrengthChange, reducedMotion } from './core';
import { MONEY_TIMING, Odometer } from './odometer';
import { TIER_SWAP_DELAY_MS, TIER_SWAP_MS, type BlockCell } from './platmap';

export interface BlockStrengthValues {
  averageFrames: number | null;
  tier: Tier | null;
}

function strengthWords(average: string | null): string {
  return average === null ? 'no samples' : `${average} frames`;
}

/** Drives the readout roll, the tier swap, the payable roll and the announcements. */
export class StrengthPresenter {
  constructor(private readonly payable: Odometer | null) {}

  /**
   * Rolls one block from the figures it held before the change to the server's
   * figures, then announces the change.
   */
  apply(
    cell: BlockCell,
    previous: BlockStrengthValues,
    next: BlockStrengthValues,
    orchardPayableCents: number,
  ): void {
    const previousAverage =
      previous.averageFrames === null ? null : previous.averageFrames.toFixed(1);
    const previousTier = previous.tier;
    const nextAverage = next.averageFrames === null ? null : next.averageFrames.toFixed(1);
    if (
      previousAverage === nextAverage &&
      previousTier === next.tier &&
      cell.currentAverage === nextAverage
    ) {
      this.rollPayable(orchardPayableCents, 0);
      return;
    }
    cell.provisional = false;
    cell.applyStrength(next.averageFrames, next.tier, () => {
      const delay = reducedMotion() ? 0 : TIER_SWAP_DELAY_MS + TIER_SWAP_MS;
      this.rollPayable(orchardPayableCents, delay);
      const announce = (): void => {
        announceStrength(
          `${cell.name}: ${strengthWords(nextAverage)}, ${next.tier === null ? NOT_INSPECTED_LABEL : tierLabel(next.tier)}. Orchard payable ${formatMoney(orchardPayableCents)}.`,
        );
      };
      if (reducedMotion()) {
        const changed = previousTier !== next.tier;
        logStrengthChange(
          `${cell.name}: ${strengthWords(previousAverage)} → ${strengthWords(nextAverage)}, ${changed ? 'now' : 'still'} ${next.tier === null ? NOT_INSPECTED_LABEL : tierLabel(next.tier)}`,
        );
        announce();
        return;
      }
      window.setTimeout(announce, delay);
    });
  }

  /** Starts the columns rolling toward the browser's provisional average. */
  provisional(cell: BlockCell, averageFrames: number): void {
    cell.provisional = true;
    cell.applyStrength(averageFrames, cell.currentTier);
  }

  /** Returns the readout to the figures shown before a refused change. */
  rollBack(cell: BlockCell, previous: BlockStrengthValues, orchardPayableCents: number): void {
    cell.provisional = false;
    cell.rollBack(previous.averageFrames, previous.tier);
    this.rollPayable(orchardPayableCents, 0);
  }

  rollPayable(cents: number, delayMs: number): void {
    const target = this.payable;
    if (target === null) return;
    const value = formatMoney(cents);
    if (target.text === value) return;
    if (delayMs === 0 || reducedMotion()) target.roll(value, MONEY_TIMING);
    else window.setTimeout(() => target.roll(value, MONEY_TIMING), delayMs);
  }
}
