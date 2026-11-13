import { scoreText } from '../../shared/cards';
import { ANNOUNCE, ERROR_MESSAGES, FIELD_MESSAGES, WRONG_STATE } from '../../shared/copy';
import type { Winner } from '../../shared/types';
import { iso, now } from '../clock';
import { config } from '../config';
import { type Db, newId } from '../db';
import { AppError, forbidden, invalid, validation, wrongState } from '../errors';
import { dependentSet, slotsFedBySet } from './dependents';
import {
  afterResult,
  broadcastMatch,
  broadcastStandings,
  type Effects,
  finishIfDone,
  flushSentences,
  propagate,
  updateMatch,
} from './engine';
import { bothSlotsKnown, hasResult, loadFeeds, loadMatch, loadMatches, type MatchRow, toApiMatch } from './matches';
import type { TournamentRow } from './tournaments';

export interface Actor {
  userId: string;
  username: string;
  isOrganizer: boolean;
  entrantId: string | null;
}

export interface Score {
  upper: number;
  lower: number;
}

const side = (match: MatchRow, entrantId: string | null): 'upper' | 'lower' | null => {
  if (entrantId === null) return null;
  if (match.upper_entrant_id === entrantId) return 'upper';
  if (match.lower_entrant_id === entrantId) return 'lower';
  return null;
};

const entrantName = (match: MatchRow, slot: 'upper' | 'lower'): string =>
  (slot === 'upper' ? match.upper_name : match.lower_name) ?? '';

export const requireRunning = (tournament: TournamentRow): void => {
  if (tournament.state === 'finished') throw wrongState(WRONG_STATE.finished);
  if (tournament.state !== 'running') throw wrongState(WRONG_STATE.notRunning);
};

export const requirePlayable = (match: MatchRow): void => {
  if (match.state === 'bye' || match.state === 'not_needed' || match.state === 'waiting' || !bothSlotsKnown(match)) {
    throw wrongState(WRONG_STATE.notReady);
  }
};

export const staleMatch = (match: MatchRow): AppError =>
  new AppError('stale_match', ERROR_MESSAGES.staleMatch(match.updated_by ?? 'system', scoreText(match.upper_games, match.lower_games)), {
    match: toApiMatch(match, true),
  });

const checkVersion = (match: MatchRow, version: unknown): void => {
  if (version !== match.version) throw staleMatch(match);
};

export const readScore = (body: Record<string, unknown>, format: string): Score => {
  const fields: Record<string, string> = {};
  const read = (key: 'upper_games' | 'lower_games'): number => {
    const value = body[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 99) {
      fields[key] = FIELD_MESSAGES.games;
      return 0;
    }
    return value;
  };
  const upper = read('upper_games');
  const lower = read('lower_games');
  if (Object.keys(fields).length > 0) throw validation(fields);
  if (upper === 0 && lower === 0) throw invalid(ERROR_MESSAGES.needOneGame);
  if (upper === lower && format !== 'round_robin' && format !== 'swiss') {
    throw invalid(ERROR_MESSAGES.needWinner);
  }
  return { upper, lower };
};

export const winnerOf = (score: Score): Winner =>
  score.upper === score.lower ? 'draw' : score.upper > score.lower ? 'upper' : 'lower';

const requireParticipant = (match: MatchRow, actor: Actor): 'upper' | 'lower' | null => {
  const slot = side(match, actor.entrantId);
  if (slot === null && !actor.isOrganizer) throw forbidden(ERROR_MESSAGES.forbiddenReport);
  return slot;
};

const confirmReport = async (effects: Effects, match: MatchRow, actor: Actor): Promise<MatchRow> => {
  const report = match.report as NonNullable<MatchRow['report']>;
  const score: Score = { upper: report.upper_games, lower: report.lower_games };
  return updateMatch(
    effects.db,
    match.id,
    {
      state: 'confirmed',
      upper_games: score.upper,
      lower_games: score.lower,
      winner: winnerOf(score),
      auto_confirm_at: null,
      overdue: false,
    },
    actor.username,
  );
};

const disputeReport = async (
  effects: Effects,
  match: MatchRow,
  actor: Actor,
  slot: 'upper' | 'lower',
  score: Score,
): Promise<MatchRow> =>
  updateMatch(
    effects.db,
    match.id,
    {
      state: 'disputed',
      dispute: {
        by: entrantName(match, slot),
        upper_games: score.upper,
        lower_games: score.lower,
        disputed_at: iso(now()),
      },
      auto_confirm_at: null,
      overdue: false,
    },
    actor.username,
  );

export const callMatch = async (effects: Effects, match: MatchRow, actor: Actor, version: unknown): Promise<MatchRow> => {
  if (!actor.isOrganizer) throw forbidden();
  requireRunning(effects.tournament);
  checkVersion(match, version);
  requirePlayable(match);
  if (hasResult(match)) throw wrongState(WRONG_STATE.matchHasResult);
  if (match.state === 'disputed') throw wrongState(WRONG_STATE.matchDisputed);
  if (match.state === 'reported') throw wrongState(WRONG_STATE.matchHasResult);
  const updated = await updateMatch(effects.db, match.id, { state: 'called', called_at: new Date(now()) }, actor.username);
  broadcastMatch(effects.outbox, updated);
  return updated;
};

export type ReportOutcome = 'reported' | 'confirmed' | 'disputed';

export const reportScore = async (
  effects: Effects,
  match: MatchRow,
  actor: Actor,
  body: Record<string, unknown>,
): Promise<{ match: MatchRow; outcome: ReportOutcome }> => {
  const slot = requireParticipant(match, actor);
  requireRunning(effects.tournament);

  if (match.state === 'reported' && slot !== null) {
    const report = match.report as NonNullable<MatchRow['report']>;
    if (report.by === entrantName(match, slot)) throw wrongState(WRONG_STATE.alreadyReported);
    const score = readScore(body, effects.tournament.format);
    const same = score.upper === report.upper_games && score.lower === report.lower_games;
    const updated = same
      ? await confirmReport(effects, match, actor)
      : await disputeReport(effects, match, actor, slot, score);
    if (same) await afterResult(effects, updated);
    else broadcastMatch(effects.outbox, updated);
    return { match: updated, outcome: same ? 'confirmed' : 'disputed' };
  }

  checkVersion(match, body.version);
  requirePlayable(match);
  if (hasResult(match)) throw wrongState(WRONG_STATE.matchHasResult);
  if (match.state === 'disputed') throw wrongState(WRONG_STATE.matchDisputed);
  const score = readScore(body, effects.tournament.format);

  if (slot === null) {
    const updated = await saveResultRow(effects, match, actor, score);
    await afterResult(effects, updated);
    return { match: updated, outcome: 'confirmed' };
  }

  const reportedAt = now();
  const updated = await updateMatch(
    effects.db,
    match.id,
    {
      state: 'reported',
      report: {
        by: entrantName(match, slot),
        upper_games: score.upper,
        lower_games: score.lower,
        reported_at: iso(reportedAt),
        auto_confirm_at: iso(reportedAt + config.confirmWindowMs),
      },
      auto_confirm_at: new Date(reportedAt + config.confirmWindowMs),
      overdue: false,
    },
    actor.username,
  );
  broadcastMatch(effects.outbox, updated);
  return { match: updated, outcome: 'reported' };
};

export const confirmScore = async (
  effects: Effects,
  match: MatchRow,
  actor: Actor,
  version: unknown,
): Promise<MatchRow> => {
  const slot = requireParticipant(match, actor);
  requireRunning(effects.tournament);
  if (match.state === 'reported' && match.report !== null && slot !== null &&
      match.report.by === entrantName(match, slot)) {
    throw forbidden(ERROR_MESSAGES.forbiddenConfirmOwn);
  }
  checkVersion(match, version);
  requirePlayable(match);
  if (hasResult(match)) throw wrongState(WRONG_STATE.matchHasResult);
  if (match.state === 'disputed') throw wrongState(WRONG_STATE.matchDisputed);
  if (match.state !== 'reported' || match.report === null) throw wrongState(WRONG_STATE.noReport);
  const updated = await confirmReport(effects, match, actor);
  await afterResult(effects, updated);
  return updated;
};

export const disputeScore = async (
  effects: Effects,
  match: MatchRow,
  actor: Actor,
  body: Record<string, unknown>,
): Promise<MatchRow> => {
  const slot = requireParticipant(match, actor);
  requireRunning(effects.tournament);
  if (match.state === 'reported' && match.report !== null && slot !== null &&
      match.report.by === entrantName(match, slot)) {
    throw forbidden(ERROR_MESSAGES.forbiddenConfirmOwn);
  }
  checkVersion(match, body.version);
  requirePlayable(match);
  if (hasResult(match)) throw wrongState(WRONG_STATE.matchHasResult);
  if (match.state === 'disputed') throw wrongState(WRONG_STATE.matchDisputed);
  if (match.state !== 'reported' || match.report === null) throw wrongState(WRONG_STATE.noReport);
  const score = readScore(body, effects.tournament.format);
  if (score.upper === match.report.upper_games && score.lower === match.report.lower_games) {
    throw invalid(ERROR_MESSAGES.disputeMustDiffer);
  }
  const disputeSlot = slot ?? (match.report.by === entrantName(match, 'upper') ? 'lower' : 'upper');
  const updated = await disputeReport(effects, match, actor, disputeSlot, score);
  broadcastMatch(effects.outbox, updated);
  return updated;
};

const saveResultRow = async (effects: Effects, match: MatchRow, actor: Actor, score: Score): Promise<MatchRow> =>
  updateMatch(
    effects.db,
    match.id,
    {
      state: 'confirmed',
      upper_games: score.upper,
      lower_games: score.lower,
      winner: winnerOf(score),
      auto_confirm_at: null,
      overdue: false,
    },
    actor.username,
  );

export const saveResult = async (
  effects: Effects,
  match: MatchRow,
  actor: Actor,
  body: Record<string, unknown>,
): Promise<MatchRow> => {
  if (!actor.isOrganizer) throw forbidden();
  requireRunning(effects.tournament);
  checkVersion(match, body.version);
  requirePlayable(match);
  if (hasResult(match)) throw wrongState(WRONG_STATE.matchHasResult);
  if (match.state === 'disputed') throw wrongState(WRONG_STATE.matchDisputed);
  const score = readScore(body, effects.tournament.format);
  const updated = await saveResultRow(effects, match, actor, score);
  await afterResult(effects, updated);
  return updated;
};

export const resolveDispute = async (
  effects: Effects,
  match: MatchRow,
  actor: Actor,
  body: Record<string, unknown>,
): Promise<MatchRow> => {
  if (!actor.isOrganizer) throw forbidden(ERROR_MESSAGES.forbiddenResolve);
  requireRunning(effects.tournament);
  if (match.state === 'resolved') {
    throw new AppError(
      'already_resolved',
      ERROR_MESSAGES.alreadyResolved(match.updated_by ?? 'system', match.upper_games ?? 0, match.lower_games ?? 0),
      { match: toApiMatch(match, true) },
    );
  }
  checkVersion(match, body.version);
  requirePlayable(match);
  if (match.state !== 'disputed') throw wrongState(WRONG_STATE.noDispute);
  const score = readScore(body, effects.tournament.format);
  const updated = await updateMatch(
    effects.db,
    match.id,
    {
      state: 'resolved',
      upper_games: score.upper,
      lower_games: score.lower,
      winner: winnerOf(score),
      auto_confirm_at: null,
      overdue: false,
    },
    actor.username,
  );
  await afterResult(effects, updated);
  return updated;
};

export const requireEditable = (effects: Effects, match: MatchRow, actor: Actor): void => {
  if (!actor.isOrganizer) throw forbidden();
  requireRunning(effects.tournament);
  if (!hasResult(match)) throw wrongState(WRONG_STATE.onlyConfirmedEditable);
};

interface PreviewPayload {
  match_id: string;
  upper_games: number;
  lower_games: number;
  edited_version: number;
  dependents: { id: string; version: number }[];
}

export const editPreview = async (
  effects: Effects,
  match: MatchRow,
  actor: Actor,
  body: Record<string, unknown>,
): Promise<{ dependents: MatchRow[]; count: number; confirmed_count: number; preview_token: string }> => {
  requireEditable(effects, match, actor);
  checkVersion(match, body.version);
  const score = readScore(body, effects.tournament.format);
  const dependents = await proposedDependents(effects.db, effects.tournament, match, score);
  const token = newId() + newId();
  const payload: PreviewPayload = {
    match_id: match.id,
    upper_games: score.upper,
    lower_games: score.lower,
    edited_version: match.version,
    dependents: dependents.map((row) => ({ id: row.id, version: row.version })),
  };
  await effects.db.query(
    'insert into edit_previews (token, match_id, upper_games, lower_games, payload, created_at) values ($1,$2,$3,$4,$5,$6)',
    [token, match.id, score.upper, score.lower, JSON.stringify(payload), new Date(now())],
  );
  return {
    dependents,
    count: dependents.length,
    confirmed_count: dependents.filter((row) => hasResult(row)).length,
    preview_token: token,
  };
};

/** The dependent set of a proposed score: empty when the winner stays, or in round robin and Swiss. */
const proposedDependents = async (
  db: Db,
  tournament: TournamentRow,
  match: MatchRow,
  score: Score,
): Promise<MatchRow[]> => {
  if (tournament.format === 'round_robin' || tournament.format === 'swiss') return [];
  if (winnerOf(score) === match.winner) return [];
  const matches = await loadMatches(db, tournament.id);
  const feeds = await loadFeeds(db, tournament.id);
  return dependentSet(matches, feeds, match.id);
};

export const commitEdit = async (
  effects: Effects,
  match: MatchRow,
  actor: Actor,
  body: Record<string, unknown>,
): Promise<{ match: MatchRow; reset: string[] }> => {
  requireEditable(effects, match, actor);
  const token = typeof body.preview_token === 'string' ? body.preview_token : '';
  const stored = await effects.db.query<{ payload: PreviewPayload }>(
    'select payload from edit_previews where token = $1 and match_id = $2',
    [token, match.id],
  );
  const payload = stored.rows[0]?.payload;
  if (payload === undefined) throw new AppError('stale_preview', ERROR_MESSAGES.stalePreview);
  const score: Score = { upper: payload.upper_games, lower: payload.lower_games };
  if (payload.edited_version !== match.version) throw new AppError('stale_preview', ERROR_MESSAGES.stalePreview);

  const dependents = await proposedDependents(effects.db, effects.tournament, match, score);
  const same =
    dependents.length === payload.dependents.length &&
    dependents.every((row, index) => {
      const expected = payload.dependents[index];
      return expected !== undefined && expected.id === row.id && expected.version === row.version;
    });
  if (!same) throw new AppError('stale_preview', ERROR_MESSAGES.stalePreview);

  const feeds = await loadFeeds(effects.db, effects.tournament.id);
  const setIds = new Set(dependents.map((row) => row.id));
  const resetRows: MatchRow[] = [];

  for (const dependent of dependents) {
    const patch: Record<string, unknown> = {
      state: dependent.bracket === 'final' && dependent.round === 2 ? 'waiting' : 'pending',
      upper_games: null,
      lower_games: null,
      winner: null,
      report: null,
      dispute: null,
      called_at: null,
      auto_confirm_at: null,
      overdue: false,
    };
    const slots =
      dependent.bracket === 'final' && dependent.round === 2
        ? (['upper', 'lower'] as const)
        : slotsFedBySet(feeds, setIds, match.id, dependent.id);
    for (const slot of slots) {
      if (slot === 'upper') {
        patch.upper_entrant_id = null;
        patch.upper_bye = false;
      } else {
        patch.lower_entrant_id = null;
        patch.lower_bye = false;
      }
    }
    resetRows.push(await updateMatch(effects.db, dependent.id, patch, 'system'));
  }

  const updated = await updateMatch(
    effects.db,
    match.id,
    {
      upper_games: score.upper,
      lower_games: score.lower,
      winner: winnerOf(score),
      state: match.state,
    },
    actor.username,
  );

  if (resetRows.length > 0) {
    effects.outbox.add('matches.reset', { matches: resetRows.map((row) => toApiMatch(row, true)) });
  }
  broadcastMatch(effects.outbox, updated);
  await propagate(effects, [updated.id], false);
  await broadcastStandings(effects);
  await effects.db.query('delete from edit_previews where token = $1', [token]);
  if (resetRows.length > 0) effects.outbox.announce(ANNOUNCE.matchesReset(resetRows.length));
  await finishIfDone(effects);
  flushSentences(effects);
  return { match: (await loadMatch(effects.db, match.id)) as MatchRow, reset: resetRows.map((row) => row.id) };
};
