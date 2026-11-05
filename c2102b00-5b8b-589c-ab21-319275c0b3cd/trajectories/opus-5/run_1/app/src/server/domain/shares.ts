import type { Share } from '../../shared/types.ts';
import type { PledgeRecord } from './lines.ts';

/** Unit shares and the leftover-cent rule: the one place a case price is split. */

export function unitBaseCents(priceCents: number, pack: number): number {
  return Math.floor(priceCents / pack);
}

export function remainderCents(priceCents: number, pack: number): number {
  return priceCents - unitBaseCents(priceCents, pack) * pack;
}

/** The share of one unit, numbered from 1 in pledge order. */
export function shareOfUnit(priceCents: number, pack: number, unitNumber: number): number {
  return unitBaseCents(priceCents, pack) + (unitNumber <= remainderCents(priceCents, pack) ? 1 : 0);
}

export function shareOfUnits(priceCents: number, pack: number, unitNumbers: Iterable<number>): number {
  let total = 0;
  for (const unitNumber of unitNumbers) total += shareOfUnit(priceCents, pack, unitNumber);
  return total;
}

export function sharesForPledges(priceCents: number, pack: number, pledges: PledgeRecord[]): Share[] {
  const shares: Share[] = [];
  let unit = 1;
  for (const pledge of pledges) {
    const unitNumbers: number[] = [];
    for (let index = 0; index < pledge.units; index += 1) unitNumbers.push(unit + index);
    shares.push({
      pledger: pledge.pledger,
      units: pledge.units,
      first_unit: unit,
      share_cents: shareOfUnits(priceCents, pack, unitNumbers),
    });
    unit += pledge.units;
  }
  return shares;
}
