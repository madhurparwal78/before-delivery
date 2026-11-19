import { PANELS, isGaugeable, panelById, type Substrate } from '../../shared/panels';
import type { Band } from '../../shared/types';

export const MICRONS_MIN = 1;
export const MICRONS_MAX = 2_000;

export type Medians = Readonly<Record<'steel' | 'aluminium', number | null>>;

const roundHalfUp = (value: number): number => Math.floor(value + 0.5);

/** The median of the owner's readings on one substrate, to a whole micron. */
const medianOf = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  if (sorted.length % 2 === 1) return sorted[Math.floor(middle)];
  return roundHalfUp((sorted[middle - 1] + sorted[middle]) / 2);
};

/** Computed once from the owner's readings and reused everywhere. */
export const computeMedians = (ownerReadings: ReadonlyMap<string, number>): Medians => {
  const bySubstrate: Record<'steel' | 'aluminium', number[]> = { steel: [], aluminium: [] };
  for (const panel of PANELS) {
    if (!isGaugeable(panel)) continue;
    const microns = ownerReadings.get(panel.id);
    if (microns === undefined) continue;
    bySubstrate[panel.substrate as 'steel' | 'aluminium'].push(microns);
  }
  return { steel: medianOf(bySubstrate.steel), aluminium: medianOf(bySubstrate.aluminium) };
};

const bandFromDelta = (delta: number): Band => {
  if (delta < -30) return 'Thin';
  if (delta <= 40) return 'Original';
  if (delta <= 150) return 'Refinished';
  return 'Filler';
};

/**
 * The band of one reading on one panel, against the car's own median on the same
 * substrate. An owner reading always has a median, because it is part of it, so
 * `No baseline` only ever reaches an inspector reading.
 */
export const bandFor = (substrate: Substrate, microns: number | null, medians: Medians): Band => {
  if (substrate === 'plastic') return 'Not gauged';
  if (microns === null) return 'No reading';
  const median = medians[substrate];
  if (median === null) return 'No baseline';
  return bandFromDelta(microns - median);
};

/** The band shown on a panel row and carried by every finding on that panel. */
export const ownerBandForPanel = (
  panelId: string,
  ownerReadings: ReadonlyMap<string, number>,
  medians: Medians,
): Band => {
  const panel = panelById(panelId);
  if (panel === undefined) throw new Error(`Unknown panel ${panelId}`);
  const microns = ownerReadings.get(panelId);
  return bandFor(panel.substrate, microns === undefined ? null : microns, medians);
};
