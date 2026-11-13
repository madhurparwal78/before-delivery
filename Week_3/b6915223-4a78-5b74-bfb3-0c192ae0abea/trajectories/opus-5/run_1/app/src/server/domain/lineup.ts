import type { BrokenRule, Position } from '../../shared/types.ts';
import { positionRank } from './squadRules.ts';

export interface LineupPlayer {
  id: string;
  position: Position;
  price_tenths: number;
}

export interface Lineup {
  starting: string[];
  bench: string[];
  captain: string;
  vice_captain: string;
}

const SHAPE_MINIMUMS: { position: Position; minimum: number; code: string; message: string }[] = [
  {
    position: 'DEF',
    minimum: 3,
    code: 'shape_defenders',
    message: 'the eleven needs at least 3 defenders',
  },
  {
    position: 'MID',
    minimum: 2,
    code: 'shape_midfielders',
    message: 'the eleven needs at least 2 midfielders',
  },
  {
    position: 'FWD',
    minimum: 1,
    code: 'shape_forwards',
    message: 'the eleven needs at least 1 forward',
  },
];

/** The one place the shape and captain rules are decided. */
export const checkLineupRules = (
  lineup: Lineup,
  positionOf: (playerId: string) => Position,
): BrokenRule[] => {
  const broken: BrokenRule[] = [];

  if (lineup.starting.length !== 11 || lineup.bench.length !== 4) {
    broken.push({
      code: 'eleven_size',
      message: 'the eleven needs exactly 11 players and the bench 4',
    });
  }

  const counts: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const id of lineup.starting) counts[positionOf(id)] += 1;

  if (counts.GK !== 1) {
    broken.push({ code: 'shape_goalkeeper', message: 'the eleven needs exactly 1 goalkeeper' });
  }
  for (const rule of SHAPE_MINIMUMS) {
    if (counts[rule.position] < rule.minimum) {
      broken.push({ code: rule.code, message: rule.message });
    }
  }

  const startingSet = new Set(lineup.starting);
  if (
    lineup.captain === lineup.vice_captain ||
    !startingSet.has(lineup.captain) ||
    !startingSet.has(lineup.vice_captain)
  ) {
    broken.push({
      code: 'captain',
      message: 'the captain and vice-captain must be two different starters',
    });
  }

  return broken;
};

/** Keeps the eleven grouped by position while preserving every other relative order. */
export const toElevenOrder = (
  starting: string[],
  positionOf: (playerId: string) => Position,
): string[] =>
  starting
    .map((id, index) => ({ id, index }))
    .sort((a, b) => {
      const byPosition = positionRank(positionOf(a.id)) - positionRank(positionOf(b.id));
      return byPosition !== 0 ? byPosition : a.index - b.index;
    })
    .map((entry) => entry.id);

export interface Armbands {
  captain: string;
  vice_captain: string;
}

/**
 * The one place an armband change is decided: making the vice-captain captain,
 * or the captain vice-captain, swaps the two armbands.
 */
export const resolveArmbandChange = (previous: Armbands, submitted: Armbands): Armbands => {
  const captainChanged = submitted.captain !== previous.captain;
  const viceChanged = submitted.vice_captain !== previous.vice_captain;
  if (captainChanged && !viceChanged && submitted.captain === previous.vice_captain) {
    return { captain: submitted.captain, vice_captain: previous.captain };
  }
  if (viceChanged && !captainChanged && submitted.vice_captain === previous.captain) {
    return { captain: previous.vice_captain, vice_captain: submitted.vice_captain };
  }
  return submitted;
};

/** The one place an armband's inheritance is decided when its holder leaves the eleven. */
export const inheritArmbands = (
  previousStarting: string[],
  nextStarting: string[],
  armbands: Armbands,
): Armbands => {
  const nextSet = new Set(nextStarting);
  const previousSet = new Set(previousStarting);
  const left = previousStarting.filter((id) => !nextSet.has(id));
  const entered = nextStarting.filter((id) => !previousSet.has(id));
  const heir = (holder: string): string => {
    const index = left.indexOf(holder);
    return index === -1 ? holder : (entered[index] ?? holder);
  };
  return {
    captain: nextSet.has(armbands.captain) ? armbands.captain : heir(armbands.captain),
    vice_captain: nextSet.has(armbands.vice_captain)
      ? armbands.vice_captain
      : heir(armbands.vice_captain),
  };
};

const byPriceThenId = (a: LineupPlayer, b: LineupPlayer): number =>
  b.price_tenths - a.price_tenths || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The published default eleven, bench order, captain and vice-captain. */
export const defaultLineup = (squad: LineupPlayer[]): Lineup => {
  const ranked = (position: Position): LineupPlayer[] =>
    squad.filter((player) => player.position === position).sort(byPriceThenId);

  const keepers = ranked('GK');
  const defenders = ranked('DEF');
  const midfielders = ranked('MID');
  const forwards = ranked('FWD');

  const starting = [
    ...keepers.slice(0, 1),
    ...defenders.slice(0, 4),
    ...midfielders.slice(0, 4),
    ...forwards.slice(0, 2),
  ];
  const bench = [
    ...keepers.slice(1),
    ...defenders.slice(4),
    ...midfielders.slice(4),
    ...forwards.slice(2),
  ];
  const byPrice = [...starting].sort(byPriceThenId);

  return {
    starting: starting.map((player) => player.id),
    bench: bench.map((player) => player.id),
    captain: byPrice[0]!.id,
    vice_captain: byPrice[1]!.id,
  };
};
