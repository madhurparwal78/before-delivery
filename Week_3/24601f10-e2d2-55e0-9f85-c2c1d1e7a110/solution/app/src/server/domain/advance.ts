import type { Winner } from '../../shared/api.js';
import { BYE, entrantSlot, match as matchOf, nameOf, touch } from './draw.js';
import { computeStandings } from './standings.js';
import { isDecided, type Draw, type Feed, type Match, type Side, type Slot } from './types.js';

const other = (side: Side): Side => (side === 'upper' ? 'lower' : 'upper');

// Put a slot's content into the match a feed points at, then see whether that match is now a bye.
function place(draw: Draw, feed: Feed, slot: Slot): void {
  const target = matchOf(draw, feed.matchId);
  target[feed.slot] = slot;
  touch(draw, target);
  settle(draw, target);
}

function passForward(draw: Draw, m: Match, winner: Slot): void {
  if (m.winnerTo) place(draw, m.winnerTo, winner);
  if (m.loserTo) place(draw, m.loserTo, BYE);
}

// A pending match with a bye side is won by the other side at once; a match fed by two byes is not needed.
export function settle(draw: Draw, m: Match): void {
  if (m.state !== 'pending') return;
  if (m.upper.kind === 'bye' && m.lower.kind === 'bye') {
    m.state = 'not_needed';
    touch(draw, m);
    passForward(draw, m, BYE);
  } else if (m.upper.kind === 'entrant' && m.lower.kind === 'bye') {
    m.state = 'bye';
    m.winner = 'upper';
    touch(draw, m);
    passForward(draw, m, m.upper);
  } else if (m.upper.kind === 'bye' && m.lower.kind === 'entrant') {
    m.state = 'bye';
    m.winner = 'lower';
    touch(draw, m);
    passForward(draw, m, m.lower);
  }
}

function resolveGrandFinal(draw: Draw, m: Match, emit: boolean): void {
  if (m.round !== 1) return;
  const reset = draw.matches.find((x) => x.bracket === 'final' && x.round === 2) as Match;
  if (m.winner === 'lower') {
    reset.upper = m.upper;
    reset.lower = m.lower;
    reset.state = 'pending';
    if (emit) draw.events.push({ kind: 'reset_needed' });
  } else {
    reset.state = 'not_needed';
  }
  touch(draw, reset);
}

// The winner and loser of a decided match move on; announcements are recorded when `emit` is set.
export function propagateResult(draw: Draw, m: Match, emit: boolean): void {
  if (m.winner === null || m.winner === 'draw') return;
  if (m.bracket === 'final') return resolveGrandFinal(draw, m, emit);
  const moves: Array<[Feed | null, Slot, 'advance' | 'drop']> = [
    [m.winnerTo, m[m.winner], 'advance'],
    [m.loserTo, m[other(m.winner)], 'drop'],
  ];
  for (const [feed, slot, kind] of moves) {
    if (!feed) continue;
    place(draw, feed, slot);
    const target = matchOf(draw, feed.matchId);
    if (emit && slot.kind === 'entrant' && (kind === 'advance' || target.bracket === 'losers')) {
      draw.events.push({ kind, name: nameOf(draw, slot.entrantId), to: { bracket: target.bracket, round: target.round } });
    }
  }
}

export const winnerOf = (upper: number, lower: number): Winner => (upper > lower ? 'upper' : upper < lower ? 'lower' : 'draw');

export function decide(m: Match, upper: number, lower: number): void {
  m.upperGames = upper;
  m.lowerGames = lower;
  m.winner = winnerOf(upper, lower);
}

// A confirmed or resolved result: record it, advance the entrants, and finish the tournament when that was the last one.
export function complete(draw: Draw, m: Match, upper: number, lower: number, state: 'confirmed' | 'resolved'): void {
  decide(m, upper, lower);
  m.state = state;
  m.overdue = false;
  touch(draw, m);
  propagateResult(draw, m, true);
  evaluateFinish(draw);
}

export function championOf(draw: Draw): Slot | null {
  const { format, swissRounds } = draw.tournament;
  const winnerSlot = (m: Match | undefined): Slot | null => (m && isDecided(m.state) && m.winner && m.winner !== 'draw' ? m[m.winner] : null);
  if (format === 'single_elimination') {
    const last = Math.max(...draw.matches.map((m) => m.round));
    return winnerSlot(draw.matches.find((m) => m.round === last));
  }
  if (format === 'double_elimination') {
    const final = draw.matches.filter((m) => m.bracket === 'final');
    const first = final.find((m) => m.round === 1);
    const reset = final.find((m) => m.round === 2);
    return reset && isDecided(reset.state) ? winnerSlot(reset) : first && first.winner === 'upper' ? winnerSlot(first) : null;
  }
  const relevant = format === 'swiss' ? draw.matches.filter((m) => m.round === swissRounds) : draw.matches;
  const done = relevant.length > 0 && relevant.every((m) => m.state === 'bye' || isDecided(m.state));
  const first = done ? computeStandings(draw)?.rows[0] : undefined;
  return done && first ? entrantSlot(first.entrant_id) : null;
}

// A tournament finishes on its own when its last match has a result.
export function evaluateFinish(draw: Draw): void {
  if (draw.tournament.state !== 'running') return;
  const champion = championOf(draw);
  if (champion?.kind !== 'entrant') return;
  draw.tournament.state = 'finished';
  draw.tournament.finishedAt = draw.now;
  draw.finished = true;
  draw.events.push({ kind: 'champion', name: nameOf(draw, champion.entrantId) });
}
