import { createHash } from 'node:crypto';
import type { Dependent } from '../../shared/api.js';
import { propagateResult, decide, evaluateFinish, winnerOf } from './advance.js';
import { match as matchOf, touch } from './draw.js';
import { isDecided, type Draw, type Feed, type Match } from './types.js';

// Shutter trace: the dependent set of a proposed result change, its token, and the commit.
const BRACKET_ORDER = { winners: 0, main: 0, losers: 1, final: 2 } as const;

const feedsOf = (m: Match): Feed[] => [m.winnerTo, m.loserTo].filter((f): f is Feed => f !== null);

function resetOf(draw: Draw): Match | undefined {
  return draw.matches.find((m) => m.bracket === 'final' && m.round === 2);
}

// Walk the feed edges from the edited match: a match joins when the slot fed by the edited match or by a member
// currently holds an entrant or a bye. Returns the members in reset order.
export function dependentSet(draw: Draw, edited: Match, upper: number, lower: number): Match[] {
  const newWinner = winnerOf(upper, lower);
  const format = draw.tournament.format;
  if (newWinner === edited.winner || (format !== 'single_elimination' && format !== 'double_elimination')) return [];
  const parents = new Map<string, Set<string>>();
  const members = new Map<string, Match>();
  const join = (parent: Match, target: Match): void => {
    parents.set(target.id, (parents.get(target.id) ?? new Set()).add(parent.id));
    members.set(target.id, target);
  };
  const queue: Match[] = [edited];
  for (let at = 0; at < queue.length; at++) {
    const from = queue[at] as Match;
    const targets = feedsOf(from).map((feed) => ({ target: matchOf(draw, feed.matchId), slot: feed.slot }))
      .filter(({ target, slot }) => target[slot].kind !== 'tbd').map(({ target }) => target);
    const reset = resetOf(draw);
    if (reset && from.bracket === 'final' && from.round === 1 && (reset.state === 'not_needed' || reset.upper.kind === 'entrant')) {
      targets.push(reset);
    }
    for (const target of targets) {
      const fresh = !members.has(target.id);
      join(from, target);
      if (fresh) queue.push(target);
    }
  }
  const distance = new Map<string, number>([[edited.id, 0]]);
  const longest = (m: Match): number => {
    const known = distance.get(m.id);
    if (known !== undefined) return known;
    const best = Math.max(...[...(parents.get(m.id) ?? [])].map((id) => longest(matchOf(draw, id)))) + 1;
    distance.set(m.id, best);
    return best;
  };
  return [...members.values()].sort((a, b) => longest(a) - longest(b)
    || BRACKET_ORDER[a.bracket] - BRACKET_ORDER[b.bracket] || a.round - b.round || a.number - b.number);
}

export function describeDependents(set: Match[]): { dependents: Dependent[]; count: number; confirmedCount: number } {
  return {
    dependents: set.map((m) => ({ match_id: m.id, label: m.label, state: m.state })),
    count: set.length,
    confirmedCount: set.filter((m) => isDecided(m.state)).length,
  };
}

// The token binds the proposed score, the set and the version of every match involved.
export function previewToken(edited: Match, upper: number, lower: number, set: Match[]): string {
  const bound = [edited.id, edited.version, upper, lower, ...set.map((m) => [m.id, m.version])];
  return createHash('sha256').update(JSON.stringify(bound)).digest('hex');
}

// Commit: every member loses the entrants that came through slots fed from the edited match or the set and goes back
// to pending, then the edited match takes its new score and its winner and loser advance again.
export function commitEdit(draw: Draw, edited: Match, upper: number, lower: number, set: Match[]): void {
  const inSet = new Set(set.map((m) => m.id));
  for (const from of [edited, ...set]) {
    for (const feed of feedsOf(from)) {
      if (inSet.has(feed.matchId)) matchOf(draw, feed.matchId)[feed.slot] = { kind: 'tbd' };
    }
  }
  for (const m of set) {
    m.report = null;
    m.dispute = null;
    m.upperGames = null;
    m.lowerGames = null;
    m.winner = null;
    m.calledAt = null;
    m.overdue = false;
    m.resolvedBy = null;
    m.state = m.bracket === 'final' && m.round === 2 ? 'waiting' : 'pending';
    if (m.state === 'waiting') {
      m.upper = { kind: 'tbd' };
      m.lower = { kind: 'tbd' };
    }
    touch(draw, m);
  }
  decide(edited, upper, lower);
  touch(draw, edited);
  if (set.length) propagateResult(draw, edited, false);
  evaluateFinish(draw);
}
