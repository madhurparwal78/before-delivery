import type { Cell, LineStatus } from '../../shared/types.ts';

/** Units to go and cell order: the one place pledges become a line's picture. */

export interface PledgeRecord {
  id: number;
  pledger: string;
  units: number;
}

export const CLUB_PLEDGER = 'club';

export function pledgedUnits(pledges: PledgeRecord[]): number {
  return pledges.reduce((total, pledge) => total + pledge.units, 0);
}

export function unitsToGo(pack: number, pledges: PledgeRecord[]): number {
  return pack - pledgedUnits(pledges);
}

/** The owner of each unit, in pledge order, index 0 being unit 1. */
export function unitOwners(pledges: PledgeRecord[]): string[] {
  const owners: string[] = [];
  for (const pledge of pledges) {
    for (let index = 0; index < pledge.units; index += 1) owners.push(pledge.pledger);
  }
  return owners;
}

export function cellsFor(pack: number, pledges: PledgeRecord[], viewer: string | null): Cell[] {
  const owners = unitOwners(pledges);
  const cells: Cell[] = [];
  for (let unit = 0; unit < pack; unit += 1) {
    const owner = owners[unit];
    if (owner === undefined) cells.push('empty');
    else if (viewer !== null && owner === viewer) cells.push('mine');
    else cells.push('taken');
  }
  return cells;
}

export function effectiveLineStatus(storedStatus: LineStatus, pack: number, pledges: PledgeRecord[]): LineStatus {
  if (storedStatus === 'dropped' || storedStatus === 'taken_up') return storedStatus;
  return unitsToGo(pack, pledges) === 0 ? 'sealed' : 'filling';
}
