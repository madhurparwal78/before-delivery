import type { BracketKind, Format } from '../../shared/types';

export const matchLabel = (bracket: BracketKind, round: number, number: number): string => {
  switch (bracket) {
    case 'winners':
      return `Winners round ${round}, match ${number}`;
    case 'losers':
      return `Losers round ${round}, match ${number}`;
    case 'final':
      return round === 1 ? 'Grand final' : 'Grand final reset';
    default:
      return `Round ${round}, match ${number}`;
  }
};

export const bracketSize = (fieldSize: number): number => {
  let size = 2;
  while (size < fieldSize) size *= 2;
  return size;
};

/** Slot order: start from 1, 2; to double the size replace each seed s by the pair s, size+1-s. */
export const slotOrder = (size: number): number[] => {
  let order = [1, 2];
  while (order.length < size) {
    const doubled = order.length * 2;
    const next: number[] = [];
    for (const seed of order) {
      next.push(seed, doubled + 1 - seed);
    }
    order = next;
  }
  return order;
};

export type SlotSpec = { seed: number } | 'bye' | null;

export interface MatchSpec {
  bracket: BracketKind;
  round: number;
  number: number;
  upper: SlotSpec;
  lower: SlotSpec;
  waiting?: true;
}

export interface FeedSpec {
  from: { bracket: BracketKind; round: number; number: number };
  outcome: 'winner' | 'loser';
  to: { bracket: BracketKind; round: number; number: number };
  slot: 'upper' | 'lower';
}

export interface Structure {
  matches: MatchSpec[];
  feeds: FeedSpec[];
  roundsByBracket: Map<BracketKind, number>;
}

const seedSlot = (seed: number, fieldSize: number): SlotSpec => (seed > fieldSize ? 'bye' : { seed });

const eliminationRounds = (
  bracket: BracketKind,
  fieldSize: number,
  size: number,
  matches: MatchSpec[],
  feeds: FeedSpec[],
): number => {
  const rounds = Math.log2(size);
  const order = slotOrder(size);
  for (let m = 1; m <= size / 2; m += 1) {
    matches.push({
      bracket,
      round: 1,
      number: m,
      upper: seedSlot(order[2 * m - 2] as number, fieldSize),
      lower: seedSlot(order[2 * m - 1] as number, fieldSize),
    });
  }
  for (let r = 2; r <= rounds; r += 1) {
    const count = size / 2 ** r;
    for (let m = 1; m <= count; m += 1) {
      matches.push({ bracket, round: r, number: m, upper: null, lower: null });
    }
  }
  for (let r = 1; r < rounds; r += 1) {
    const count = size / 2 ** r;
    for (let m = 1; m <= count; m += 1) {
      feeds.push({
        from: { bracket, round: r, number: m },
        outcome: 'winner',
        to: { bracket, round: r + 1, number: Math.ceil(m / 2) },
        slot: m % 2 === 1 ? 'upper' : 'lower',
      });
    }
  }
  return rounds;
};

const roundRobinStructure = (fieldSize: number): Structure => {
  const matches: MatchSpec[] = [];
  const seats = fieldSize % 2 === 0 ? fieldSize : fieldSize + 1;
  let positions: SlotSpec[] = [];
  for (let seat = 1; seat <= seats; seat += 1) {
    positions.push(seat > fieldSize ? 'bye' : { seed: seat });
  }
  const rounds = seats - 1;
  for (let r = 1; r <= rounds; r += 1) {
    for (let i = 1; i <= seats / 2; i += 1) {
      matches.push({
        bracket: 'main',
        round: r,
        number: i,
        upper: positions[i - 1] as SlotSpec,
        lower: positions[seats - i] as SlotSpec,
      });
    }
    const first = positions[0] as SlotSpec;
    const last = positions[seats - 1] as SlotSpec;
    positions = [first, last, ...positions.slice(1, seats - 1)];
  }
  return { matches, feeds: [], roundsByBracket: new Map([['main', rounds]]) };
};

export const swissRoundCount = (fieldSize: number): number => Math.ceil(Math.log2(fieldSize));

/** The whole published structure of a tournament, with slots as seeds, byes or to be decided. */
export const buildStructure = (format: Format, fieldSize: number): Structure => {
  if (format === 'round_robin') return roundRobinStructure(fieldSize);
  if (format === 'swiss') return { matches: [], feeds: [], roundsByBracket: new Map([['main', 0]]) };

  const matches: MatchSpec[] = [];
  const feeds: FeedSpec[] = [];
  const size = bracketSize(fieldSize);

  if (format === 'single_elimination') {
    const rounds = eliminationRounds('main', fieldSize, size, matches, feeds);
    return { matches, feeds, roundsByBracket: new Map([['main', rounds]]) };
  }

  const winnersRounds = eliminationRounds('winners', fieldSize, size, matches, feeds);
  const winnersMatchCount = (round: number): number => size / 2 ** round;
  const losersRounds = winnersRounds >= 2 ? 2 * winnersRounds - 2 : 0;

  if (losersRounds >= 1) {
    const l1Count = winnersMatchCount(1) / 2;
    for (let j = 1; j <= l1Count; j += 1) {
      matches.push({ bracket: 'losers', round: 1, number: j, upper: null, lower: null });
      feeds.push({
        from: { bracket: 'winners', round: 1, number: 2 * j - 1 },
        outcome: 'loser',
        to: { bracket: 'losers', round: 1, number: j },
        slot: 'upper',
      });
      feeds.push({
        from: { bracket: 'winners', round: 1, number: 2 * j },
        outcome: 'loser',
        to: { bracket: 'losers', round: 1, number: j },
        slot: 'lower',
      });
    }
  }

  for (let k = 2; k <= winnersRounds; k += 1) {
    const dropIn = 2 * k - 2;
    const count = winnersMatchCount(k);
    for (let j = 1; j <= count; j += 1) {
      matches.push({ bracket: 'losers', round: dropIn, number: j, upper: null, lower: null });
      feeds.push({
        from: { bracket: 'losers', round: dropIn - 1, number: j },
        outcome: 'winner',
        to: { bracket: 'losers', round: dropIn, number: j },
        slot: 'upper',
      });
      feeds.push({
        from: { bracket: 'winners', round: k, number: count + 1 - j },
        outcome: 'loser',
        to: { bracket: 'losers', round: dropIn, number: j },
        slot: 'lower',
      });
    }
    if (k <= winnersRounds - 1) {
      const pairRound = 2 * k - 1;
      for (let j = 1; j <= count / 2; j += 1) {
        matches.push({ bracket: 'losers', round: pairRound, number: j, upper: null, lower: null });
        feeds.push({
          from: { bracket: 'losers', round: pairRound - 1, number: 2 * j - 1 },
          outcome: 'winner',
          to: { bracket: 'losers', round: pairRound, number: j },
          slot: 'upper',
        });
        feeds.push({
          from: { bracket: 'losers', round: pairRound - 1, number: 2 * j },
          outcome: 'winner',
          to: { bracket: 'losers', round: pairRound, number: j },
          slot: 'lower',
        });
      }
    }
  }

  matches.push({ bracket: 'final', round: 1, number: 1, upper: null, lower: null });
  matches.push({ bracket: 'final', round: 2, number: 1, upper: null, lower: null, waiting: true });
  feeds.push({
    from: { bracket: 'winners', round: winnersRounds, number: 1 },
    outcome: 'winner',
    to: { bracket: 'final', round: 1, number: 1 },
    slot: 'upper',
  });
  feeds.push(
    losersRounds >= 1
      ? {
          from: { bracket: 'losers', round: losersRounds, number: 1 },
          outcome: 'winner',
          to: { bracket: 'final', round: 1, number: 1 },
          slot: 'lower',
        }
      : {
          from: { bracket: 'winners', round: winnersRounds, number: 1 },
          outcome: 'loser',
          to: { bracket: 'final', round: 1, number: 1 },
          slot: 'lower',
        },
  );

  return {
    matches,
    feeds,
    roundsByBracket: new Map<BracketKind, number>([
      ['winners', winnersRounds],
      ['losers', losersRounds],
      ['final', 2],
    ]),
  };
};
