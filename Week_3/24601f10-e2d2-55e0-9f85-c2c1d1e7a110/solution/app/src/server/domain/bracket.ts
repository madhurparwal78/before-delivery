import { settle } from './advance.js';
import { addMatch, BYE, entrantSlot } from './draw.js';
import { bracketSize, slotOrder } from './seeding.js';
import { pairRound, swissRoundCount } from './swiss.js';
import type { Bracket } from '../../shared/api.js';
import type { Draw, Entrant, Match, Slot } from './types.js';

type Grid = Match[][];

const feedSlot = (number: number): 'upper' | 'lower' => (number % 2 === 1 ? 'upper' : 'lower');

function seedSlot(draw: Draw, seed: number): Slot {
  const entrant = [...draw.entrants].sort((a, b) => a.seed - b.seed)[seed - 1];
  return entrant ? entrantSlot(entrant.id) : BYE;
}

// The winners-bracket-shaped rounds shared by single elimination and the winners side of double elimination.
function eliminationRounds(draw: Draw, size: number, bracket: Bracket, label: (round: number, match: number) => string): Grid {
  const order = slotOrder(size);
  const rounds = Math.log2(size);
  const grid: Grid = [];
  for (let round = 1; round <= rounds; round++) {
    const row: Match[] = [];
    for (let number = 1; number <= size / 2 ** round; number++) {
      const first = round === 1 ? { upper: seedSlot(draw, order[2 * number - 2] as number),
        lower: seedSlot(draw, order[2 * number - 1] as number) } : {};
      row.push(addMatch(draw, { bracket, round, number, label: label(round, number), ...first }));
    }
    grid.push(row);
  }
  grid.forEach((row, r) => row.forEach((m, i) => {
    const next = grid[r + 1]?.[Math.floor(i / 2)];
    if (next) m.winnerTo = { matchId: next.id, slot: feedSlot(i + 1) };
  }));
  return grid;
}

function generateSingleElimination(draw: Draw): void {
  const size = bracketSize(draw.entrants.length);
  const grid = eliminationRounds(draw, size, 'main', (round, number) => `Round ${round}, match ${number}`);
  for (const m of grid[0] ?? []) settle(draw, m);
}

function generateDoubleElimination(draw: Draw): void {
  const size = bracketSize(draw.entrants.length);
  const winners = eliminationRounds(draw, size, 'winners', (round, number) => `Winners round ${round}, match ${number}`);
  const winnersRounds = winners.length;
  const losers: Grid = [];
  const losersRounds = 2 * (winnersRounds - 1);
  let count = size / 4;
  for (let round = 1; round <= losersRounds; round++) {
    if (round > 1) count = round % 2 === 0 ? count : count / 2;
    const row: Match[] = [];
    for (let number = 1; number <= count; number++) {
      row.push(addMatch(draw, { bracket: 'losers', round, number, label: `Losers round ${round}, match ${number}` }));
    }
    losers.push(row);
  }
  const grandFinal = addMatch(draw, { bracket: 'final', round: 1, number: 1, label: 'Grand final' });
  addMatch(draw, { bracket: 'final', round: 2, number: 1, label: 'Grand final reset', state: 'waiting' });
  const lastWinners = winners[winnersRounds - 1]?.[0] as Match;
  lastWinners.winnerTo = { matchId: grandFinal.id, slot: 'upper' };
  if (winnersRounds === 1) {
    lastWinners.loserTo = { matchId: grandFinal.id, slot: 'lower' };
  }
  // Losers of winners round 1 pair in match order; later winners rounds drop in reversed match order.
  winners.forEach((row, r) => row.forEach((m, i) => {
    if (winnersRounds === 1) return;
    if (r === 0) {
      const target = losers[0]?.[Math.floor(i / 2)] as Match;
      m.loserTo = { matchId: target.id, slot: feedSlot(i + 1) };
    } else {
      const target = losers[2 * r - 1]?.[row.length - 1 - i] as Match;
      m.loserTo = { matchId: target.id, slot: 'lower' };
    }
  }));
  losers.forEach((row, index) => row.forEach((m, i) => {
    const round = index + 1;
    const next = losers[index + 1];
    if (!next) {
      m.winnerTo = { matchId: grandFinal.id, slot: 'lower' };
    } else if ((round + 1) % 2 === 0) {
      m.winnerTo = { matchId: (next[i] as Match).id, slot: 'upper' };
    } else {
      m.winnerTo = { matchId: (next[Math.floor(i / 2)] as Match).id, slot: feedSlot(i + 1) };
    }
  }));
  for (const m of winners[0] ?? []) settle(draw, m);
}

// Seat the entrants by seed, a bye seat last when the field is odd. Round 1 pairs seat i with seat m + 1 - i, then
// every seat but the first rotates one step.
function generateRoundRobin(draw: Draw): void {
  const seats: Array<Entrant | null> = [...draw.entrants].sort((a, b) => a.seed - b.seed);
  if (seats.length % 2 === 1) seats.push(null);
  const seatCount = seats.length;
  for (let round = 1; round < seatCount; round++) {
    for (let number = 1; number <= seatCount / 2; number++) {
      const upper = seats[number - 1] ?? null;
      const lower = seats[seatCount - number] ?? null;
      const slot = (e: Entrant | null): Slot => (e ? entrantSlot(e.id) : BYE);
      const match = addMatch(draw, { bracket: 'main', round, number, label: `Round ${round}, match ${number}`,
        upper: slot(upper), lower: slot(lower), state: upper && lower ? 'pending' : 'bye' });
      if (!upper || !lower) match.winner = upper ? 'upper' : 'lower';
    }
    seats.splice(1, 0, seats.pop() as Entrant | null);
  }
}

export function generateBracket(draw: Draw): void {
  switch (draw.tournament.format) {
    case 'single_elimination': return generateSingleElimination(draw);
    case 'double_elimination': return generateDoubleElimination(draw);
    case 'round_robin': return generateRoundRobin(draw);
    case 'swiss':
      draw.tournament.swissRounds = swissRoundCount(draw.entrants.length);
      pairRound(draw, 1);
  }
}
