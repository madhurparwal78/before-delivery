import { randomUUID } from 'node:crypto';
import type { Draw, Entrant, Match, Slot, Tournament } from './types.js';

export function newDraw(tournament: Tournament, entrants: Entrant[], matches: Match[], now: number, actor: string): Draw {
  return {
    tournament, entrants, matches, now, actor,
    byId: new Map(matches.map((m) => [m.id, m])),
    entrantById: new Map(entrants.map((e) => [e.id, e])),
    changed: new Map(), created: new Set(), events: [], finished: false,
  };
}

type MatchSeed = Pick<Match, 'bracket' | 'round' | 'number' | 'label'> & Partial<Pick<Match, 'upper' | 'lower' | 'state'>>;

export function addMatch(draw: Draw, seed: MatchSeed): Match {
  const match: Match = {
    id: randomUUID(), tournamentId: draw.tournament.id, upper: { kind: 'tbd' }, lower: { kind: 'tbd' }, state: 'pending',
    winner: null, upperGames: null, lowerGames: null, report: null, dispute: null, calledAt: null, overdue: false,
    version: 1, updatedBy: 'system', resolvedBy: null, pairedAt: null, winnerTo: null, loserTo: null, ...seed,
  };
  draw.matches.push(match);
  draw.byId.set(match.id, match);
  draw.created.add(match.id);
  return match;
}

// Every change raises a match's version once per operation and records who made it.
export function touch(draw: Draw, match: Match): void {
  if (!draw.created.has(match.id) && !draw.changed.has(match.id)) {
    draw.changed.set(match.id, match.version);
    match.version += 1;
  }
  match.updatedBy = draw.actor;
}

export function match(draw: Draw, id: string): Match {
  const found = draw.byId.get(id);
  if (!found) throw new Error(`unknown match ${id}`);
  return found;
}

export const entrantSlot = (entrantId: string): Slot => ({ kind: 'entrant', entrantId });
export const BYE: Slot = { kind: 'bye' };

export function nameOf(draw: Draw, entrantId: string): string {
  const entrant = draw.entrantById.get(entrantId);
  if (!entrant) throw new Error(`unknown entrant ${entrantId}`);
  return entrant.name;
}
