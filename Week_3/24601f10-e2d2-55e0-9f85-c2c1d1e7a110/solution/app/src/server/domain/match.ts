import { isDecided } from '../../shared/rules.js';
import { config } from '../config.js';
import { fail } from '../errors.js';
import { FIELD, MSG } from '../messages.js';
import { complete } from './advance.js';
import { nameOf, touch } from './draw.js';
import { isElimination, type Draw, type Match, type Side } from './types.js';

// Every match state transition and who may make it is decided in this module.
export interface Actor {
  username: string;
  organizer: boolean;
  // The entrant this account is linked to in this tournament, if any.
  entrantId: string | null;
}

type Games = { upper: number; lower: number };

export type MatchAction =
  | { kind: 'call'; version: number }
  | { kind: 'report'; games: unknown; version: number }
  | { kind: 'confirm'; version: number }
  | { kind: 'dispute'; games: unknown; version: number }
  | { kind: 'result'; games: unknown; version: number }
  | { kind: 'resolve'; games: unknown; version: number };

type Outcome = 'called' | 'reported' | 'confirmed' | 'disputed' | 'resolved' | 'saved';

const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 99;

// Games are whole numbers from 0 to 99; a score needs a game; elimination matches need a winner.
export function parseGames(draw: Draw, raw: unknown): Games {
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  if (!isWhole(body['upper_games'])) fields['upper_games'] = FIELD.games;
  if (!isWhole(body['lower_games'])) fields['lower_games'] = FIELD.games;
  if (Object.keys(fields).length) fail('validation', MSG.checkFields, { fields });
  const games = { upper: body['upper_games'] as number, lower: body['lower_games'] as number };
  if (games.upper === 0 && games.lower === 0) fail('validation', MSG.needGame);
  if (games.upper === games.lower && isElimination(draw.tournament.format)) fail('validation', MSG.needWinner);
  return games;
}

const scoreText = (m: Match): string => (m.upperGames === null ? 'not played' : `${m.upperGames}-${m.lowerGames}`);

export function entrantSide(m: Match, entrantId: string | null): Side | null {
  if (entrantId === null) return null;
  if (m.upper.kind === 'entrant' && m.upper.entrantId === entrantId) return 'upper';
  if (m.lower.kind === 'entrant' && m.lower.entrantId === entrantId) return 'lower';
  return null;
}

const bothKnown = (m: Match): boolean => m.upper.kind === 'entrant' && m.lower.kind === 'entrant';
const READY_STATES = ['pending', 'called'];

function assertRunning(draw: Draw): void {
  const { state } = draw.tournament;
  if (state === 'finished') fail('wrong_state', MSG.finished);
  if (state !== 'running') fail('wrong_state', MSG.notRunning);
}

function assertRole(m: Match, action: MatchAction, actor: Actor): void {
  const side = entrantSide(m, actor.entrantId);
  switch (action.kind) {
    case 'call':
    case 'result':
      if (!actor.organizer) fail('forbidden', MSG.cannotChange);
      return;
    case 'resolve':
      if (!actor.organizer) fail('forbidden', MSG.onlyOrganizersResolve);
      return;
    case 'report':
      if (!actor.organizer && !side) fail('forbidden', MSG.cannotReport);
      return;
    case 'confirm':
    case 'dispute':
      if (!side) fail('forbidden', MSG.cannotReport);
      return;
  }
}

function assertCurrent(m: Match, version: number): void {
  if (version !== m.version) {
    fail('stale_match', MSG.stale(m.updatedBy, scoreText(m)));
  }
}

// Why a write that reached a match in a state it does not allow is refused.
function refuseState(m: Match): never {
  if (m.state === 'disputed') fail('wrong_state', MSG.matchDisputed);
  if (isDecided(m.state)) fail('wrong_state', MSG.matchHasResult);
  return fail('wrong_state', MSG.notReady);
}

function report(draw: Draw, m: Match, games: Games, entrantId: string): void {
  m.report = { entrantId, by: nameOf(draw, entrantId), upper: games.upper, lower: games.lower, reportedAt: draw.now,
    autoConfirmAt: draw.now + config.confirmWindowMs };
  m.state = 'reported';
  m.overdue = false;
  touch(draw, m);
}

function answerReport(draw: Draw, m: Match, games: Games, entrantId: string): Outcome {
  const first = m.report as NonNullable<Match['report']>;
  if (games.upper === first.upper && games.lower === first.lower) {
    complete(draw, m, games.upper, games.lower, 'confirmed');
    return 'confirmed';
  }
  m.dispute = { entrantId, by: nameOf(draw, entrantId), upper: games.upper, lower: games.lower, disputedAt: draw.now };
  m.state = 'disputed';
  m.overdue = false;
  touch(draw, m);
  return 'disputed';
}

export function applyAction(draw: Draw, m: Match, action: MatchAction, actor: Actor): Outcome {
  assertRole(m, action, actor);
  assertRunning(draw);
  const side = entrantSide(m, actor.entrantId);
  const reporter = m.report ? entrantSide(m, m.report.entrantId) : null;

  // Two cases come before the version check: the opponent's report is their answer, and a resolve after a resolution.
  if (action.kind === 'report' && m.state === 'reported' && side && reporter && side !== reporter && !actor.organizer) {
    return answerReport(draw, m, parseGames(draw, action.games), actor.entrantId as string);
  }
  if (action.kind === 'resolve' && m.state === 'resolved') {
    fail('already_resolved', MSG.alreadyResolved(m.resolvedBy ?? m.updatedBy, scoreText(m)));
  }
  assertCurrent(m, action.version);

  switch (action.kind) {
    case 'call':
      if (m.state === 'called') return 'called';
      if (m.state !== 'pending' || !bothKnown(m)) refuseState(m);
      m.state = 'called';
      m.calledAt = draw.now;
      touch(draw, m);
      return 'called';
    case 'report': {
      if (actor.organizer && !side) return applyAction(draw, m, { ...action, kind: 'result' }, actor);
      if (m.state === 'reported') fail('wrong_state', MSG.alreadyReported);
      if (!READY_STATES.includes(m.state) || !bothKnown(m)) refuseState(m);
      report(draw, m, parseGames(draw, action.games), actor.entrantId as string);
      return 'reported';
    }
    case 'confirm': {
      if (m.state === 'pending' || m.state === 'called') fail('wrong_state', MSG.noReport);
      if (m.state !== 'reported') refuseState(m);
      if (side === reporter) fail('forbidden', MSG.ownReport);
      const first = m.report as NonNullable<Match['report']>;
      complete(draw, m, first.upper, first.lower, 'confirmed');
      return 'confirmed';
    }
    case 'dispute': {
      if (m.state === 'pending' || m.state === 'called') fail('wrong_state', MSG.noReport);
      if (m.state !== 'reported') refuseState(m);
      if (side === reporter) fail('forbidden', MSG.ownReport);
      const games = parseGames(draw, action.games);
      const first = m.report as NonNullable<Match['report']>;
      if (games.upper === first.upper && games.lower === first.lower) fail('validation', MSG.changeScore);
      return answerReport(draw, m, games, actor.entrantId as string);
    }
    case 'result': {
      if (!READY_STATES.includes(m.state) && m.state !== 'reported') refuseState(m);
      if (!bothKnown(m)) refuseState(m);
      const games = parseGames(draw, action.games);
      complete(draw, m, games.upper, games.lower, 'confirmed');
      return 'saved';
    }
    case 'resolve': {
      if (m.state !== 'disputed') fail('wrong_state', MSG.noDispute);
      const games = parseGames(draw, action.games);
      m.resolvedBy = actor.username;
      complete(draw, m, games.upper, games.lower, 'resolved');
      return 'resolved';
    }
  }
}

// An unanswered report becomes confirmed once the confirm window has passed on server time.
export function autoConfirm(draw: Draw, m: Match): void {
  const first = m.report as NonNullable<Match['report']>;
  complete(draw, m, first.upper, first.lower, 'confirmed');
}

// Shutter trace: an organizer, a running tournament, the version the organizer saw (a preview), a decided match.
export function assertEditable(draw: Draw, m: Match, actor: Actor, version?: number): void {
  if (!actor.organizer) fail('forbidden', MSG.cannotChange);
  assertRunning(draw);
  if (version !== undefined) assertCurrent(m, version);
  if (!isDecided(m.state)) fail('wrong_state', MSG.onlyConfirmedEdit);
}
