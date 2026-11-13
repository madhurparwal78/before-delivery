import { createHash } from 'node:crypto';

interface PlacementData {
  readonly bodySerial: string | null;
  readonly holdId: string | null;
  readonly model: string;
  readonly lensSerial: string;
  readonly aimAcross: string;
  readonly aimDown: string;
  readonly bodyAcross: string;
  readonly bodyDown: string;
  readonly standoff: string;
  readonly ratio: string;
  readonly shiftAcrossPercent: string;
  readonly shiftDownPercent: string;
  readonly circuitId: string;
}

/** The hash of the canonical placement data, in placement order. */
export function layoutHash(placements: readonly PlacementData[]): string {
  const canonical = placements.map((placement) => [
    placement.bodySerial ?? '',
    placement.holdId ?? '',
    placement.model,
    placement.lensSerial,
    placement.aimAcross,
    placement.aimDown,
    placement.bodyAcross,
    placement.bodyDown,
    placement.standoff,
    placement.ratio,
    placement.shiftAcrossPercent,
    placement.shiftDownPercent,
    placement.circuitId,
  ]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** A layout with no placements, as every new layout starts. */
export const EMPTY_LAYOUT_HASH = layoutHash([]);
