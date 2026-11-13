import { isStarted } from '../../shared/rules.js';
import { fail } from '../errors.js';
import { MSG } from '../messages.js';
import { generateBracket } from './bracket.js';
import { pairRound } from './swiss.js';
import type { Draw, Entrant, Tournament } from './types.js';

// The tournament lifecycle: legal moves and their refusals, decided in one table of checks.
const started = (t: Tournament): boolean => isStarted(t.state);

export function assertCanOpenCheckin(t: Tournament): void {
  if (t.state === 'checkin_open') fail('wrong_state', MSG.checkinAlreadyOpen);
  if (t.state === 'checkin_closed') fail('wrong_state', MSG.checkinAlreadyClosed);
  if (started(t)) fail('wrong_state', MSG.started);
}

export function assertCanCloseCheckin(t: Tournament): void {
  if (started(t)) fail('wrong_state', MSG.started);
  if (t.state !== 'checkin_open') fail('wrong_state', MSG.checkinNotOpen);
}

export function assertCanBackToDraft(t: Tournament): void {
  if (started(t)) fail('wrong_state', MSG.started);
  if (t.state === 'draft') fail('wrong_state', MSG.alreadyDraft);
}

// Entrants, account links, seeding, roster, and deleting the tournament all need it not to have started.
export function assertNotStarted(t: Tournament): void {
  if (started(t)) fail('wrong_state', MSG.started);
}

export function assertCheckinOpen(t: Tournament, now: number): void {
  if (t.state === 'draft') fail('wrong_state', MSG.checkinNotOpen);
  if (t.state !== 'checkin_open' || (t.checkinClosesAt !== null && now >= t.checkinClosesAt)) {
    fail('checkin_closed', MSG.checkinClosed);
  }
}

// Start: from a draft nobody is removed; from closed check-in every unchecked entrant is. Returns the removed entrants.
export function startTournament(draw: Draw): Entrant[] {
  const t = draw.tournament;
  if (started(t)) fail('wrong_state', MSG.started);
  if (t.state === 'checkin_open') fail('wrong_state', MSG.closeBeforeStart);
  const present = t.state === 'checkin_closed' ? draw.entrants.filter((e) => e.checkedIn) : draw.entrants;
  if (present.length < 2) fail('wrong_state', t.state === 'draft' ? MSG.needTwoEntrants : MSG.needTwoCheckedIn);
  const removed = draw.entrants.filter((e) => !present.includes(e));
  draw.entrants = present;
  present.forEach((entrant, index) => { entrant.seed = index + 1; });
  draw.entrantById = new Map(present.map((e) => [e.id, e]));
  t.state = 'running';
  t.fieldSize = present.length;
  generateBracket(draw);
  return removed;
}

// The next Swiss round, paired only after every match of the current round has a result.
export function pairNextSwissRound(draw: Draw): number {
  const t = draw.tournament;
  if (t.format !== 'swiss') fail('wrong_state', MSG.onlySwissRounds);
  if (t.state === 'finished') fail('wrong_state', MSG.finished);
  if (t.state !== 'running') fail('wrong_state', MSG.notRunning);
  const current = Math.max(...draw.matches.map((m) => m.round));
  if (draw.matches.some((m) => m.round === current && m.state !== 'bye' && m.state !== 'confirmed' && m.state !== 'resolved')) {
    fail('wrong_state', MSG.finishRound(current));
  }
  if (!pairRound(draw, current + 1)) fail('wrong_state', MSG.noPairing);
  return current + 1;
}
