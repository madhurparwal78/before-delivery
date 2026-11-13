import { ANNOUNCE } from '../../shared/copy';
import { regionCurrentRound } from '../../shared/current';
import type { MatchState, Winner } from '../../shared/types';
import { iso, now } from '../clock';
import { config } from '../config';
import { type Db, newId } from '../db';
import type { Outbox } from '../live';
import {
  bothSlotsKnown,
  hasResult,
  loadFeeds,
  loadMatch,
  loadMatches,
  loserEntrantId,
  loserIsBye,
  type MatchRow,
  toApiMatch,
  winnerEntrantId,
  winnerIsBye,
} from './matches';
import { computeStandings } from './standings';
import { buildStructure, matchLabel, swissRoundCount } from './structure';
import { pairSwissRound } from './swiss';
import { computePlacements, decidingMatch } from './placements';
import { historyRowText } from '../../shared/cards';
import { loadEntrants, type EntrantRow, type TournamentRow, toApiTournament } from './tournaments';

export interface Effects {
  db: Db;
  outbox: Outbox;
  tournament: TournamentRow;
  sentences: string[];
  actor: string | null;
}

export const zoneDate = (ms: number, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(ms),
  );

type SlotValue = { entrantId: string } | 'bye' | null;

const COLUMNS = [
  'state',
  'upper_games',
  'lower_games',
  'winner',
  'report',
  'dispute',
  'called_at',
  'auto_confirm_at',
  'paired_at',
  'upper_entrant_id',
  'lower_entrant_id',
  'upper_bye',
  'lower_bye',
  'overdue',
] as const;

export type MatchPatch = Partial<Record<(typeof COLUMNS)[number], unknown>>;

export const updateMatch = async (
  db: Db,
  id: string,
  patch: MatchPatch,
  updatedBy: string | null,
  bumpVersion = true,
): Promise<MatchRow> => {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const column of COLUMNS) {
    if (!(column in patch)) continue;
    const value = patch[column];
    params.push(column === 'report' || column === 'dispute' ? (value === null ? null : JSON.stringify(value)) : value);
    sets.push(`${column} = $${params.length}`);
  }
  if (bumpVersion) {
    sets.push('version = version + 1');
    params.push(updatedBy);
    sets.push(`updated_by = $${params.length}`);
  }
  params.push(id);
  await db.query(`update matches set ${sets.join(', ')} where id = $${params.length}`, params);
  return (await loadMatch(db, id)) as MatchRow;
};

export const broadcastMatch = (outbox: Outbox, row: MatchRow): void => {
  outbox.add('match.updated', { match: toApiMatch(row, true) });
};

export const broadcastStandings = async (effects: Effects): Promise<void> => {
  const { format } = effects.tournament;
  if (format !== 'round_robin' && format !== 'swiss') return;
  const entrants = await loadEntrants(effects.db, effects.tournament.id);
  const matches = await loadMatches(effects.db, effects.tournament.id);
  effects.outbox.add('standings.updated', { rows: computeStandings(format, entrants, matches).rows });
};

export const broadcastTournament = async (effects: Effects): Promise<void> => {
  const fresh = (await effects.db.query<TournamentRow>('select * from tournaments where id = $1', [
    effects.tournament.id,
  ])).rows[0] as TournamentRow;
  effects.tournament = fresh;
  effects.outbox.add('tournament.updated', {
    tournament: await toApiTournament(effects.db, fresh, 'organizer'),
  });
};

export const broadcastEntrants = async (effects: Effects): Promise<void> => {
  const entrants = await loadEntrants(effects.db, effects.tournament.id);
  effects.outbox.add('entrants.updated', {
    entrants: entrants.map((entrant) => ({
      id: entrant.id,
      name: entrant.name,
      seed: entrant.seed,
      username: entrant.username,
      checked_in: entrant.checked_in,
    })),
  });
};

export const flushSentences = (effects: Effects): void => {
  if (effects.sentences.length > 0) effects.outbox.announce(effects.sentences.join('. '));
  effects.sentences.length = 0;
};

const outcomeValue = (row: MatchRow, outcome: 'winner' | 'loser'): SlotValue => {
  if (row.state === 'not_needed') return 'bye';
  if (row.state !== 'bye' && !hasResult(row)) return null;
  if (outcome === 'winner') {
    if (winnerIsBye(row)) return 'bye';
    const id = winnerEntrantId(row);
    return id === null ? null : { entrantId: id };
  }
  if (loserIsBye(row)) return 'bye';
  const id = loserEntrantId(row);
  return id === null ? null : { entrantId: id };
};

const slotHolds = (row: MatchRow, slot: 'upper' | 'lower', value: SlotValue): boolean => {
  const entrantId = slot === 'upper' ? row.upper_entrant_id : row.lower_entrant_id;
  const bye = slot === 'upper' ? row.upper_bye : row.lower_bye;
  if (value === 'bye') return bye;
  if (value === null) return entrantId === null && !bye;
  return entrantId === value.entrantId;
};

const advanceSentence = (
  effects: Effects,
  destination: MatchRow,
  outcome: 'winner' | 'loser',
  name: string,
): void => {
  const { format } = effects.tournament;
  if (format === 'single_elimination') {
    if (outcome === 'winner') effects.sentences.push(ANNOUNCE.advancesRound(name, destination.round));
    return;
  }
  if (format !== 'double_elimination') return;
  if (destination.bracket === 'winners') {
    effects.sentences.push(ANNOUNCE.advancesWinners(name, destination.round));
    return;
  }
  if (destination.bracket === 'losers') {
    effects.sentences.push(
      outcome === 'loser'
        ? ANNOUNCE.dropsLosers(name, destination.round)
        : ANNOUNCE.advancesLosers(name, destination.round),
    );
    return;
  }
  if (destination.bracket === 'final' && destination.round === 1) {
    effects.sentences.push(ANNOUNCE.advancesGrandFinal(name));
  }
};

/** Places outcomes into later slots, settles byes and announces, until nothing more follows. */
export const propagate = async (effects: Effects, startIds: string[], announce: boolean): Promise<void> => {
  const { db, outbox } = effects;
  const feeds = await loadFeeds(db, effects.tournament.id);
  const queue = [...startIds];
  const guard = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift() as string;
    const row = await loadMatch(db, id);
    if (row === null) continue;

    if (hasResult(row) || row.state === 'bye' || row.state === 'not_needed') {
      for (const feed of feeds.filter((edge) => edge.src_match_id === id)) {
        const value = outcomeValue(row, feed.outcome);
        if (value === null) continue;
        const destination = await loadMatch(db, feed.dst_match_id);
        if (destination === null) continue;
        if (slotHolds(destination, feed.slot, value)) continue;
        const patch: MatchPatch =
          feed.slot === 'upper'
            ? { upper_entrant_id: value === 'bye' ? null : value.entrantId, upper_bye: value === 'bye' }
            : { lower_entrant_id: value === 'bye' ? null : value.entrantId, lower_bye: value === 'bye' };
        const updated = await updateMatch(db, destination.id, patch, 'system');
        if (announce && value !== 'bye') {
          const name = feed.slot === 'upper' ? updated.upper_name : updated.lower_name;
          if (name !== null) advanceSentence(effects, updated, feed.outcome, name);
        }
        broadcastMatch(outbox, updated);
        queue.push(updated.id);
      }

      if (row.bracket === 'final' && row.round === 1 && hasResult(row)) {
        const reset = (await loadMatches(db, effects.tournament.id)).find(
          (match) => match.bracket === 'final' && match.round === 2,
        );
        if (reset !== undefined) {
          if (row.winner === 'lower' && reset.state !== 'pending') {
            const updated = await updateMatch(
              db,
              reset.id,
              {
                upper_entrant_id: row.upper_entrant_id,
                lower_entrant_id: row.lower_entrant_id,
                state: 'pending',
                upper_games: null,
                lower_games: null,
                winner: null,
                report: null,
                dispute: null,
              },
              'system',
            );
            if (announce) effects.sentences.push(ANNOUNCE.grandFinalReset);
            broadcastMatch(outbox, updated);
          } else if (row.winner === 'upper' && reset.state !== 'not_needed') {
            const updated = await updateMatch(db, reset.id, { state: 'not_needed' }, 'system');
            broadcastMatch(outbox, updated);
          }
        }
      }
    }

    if (row.state === 'pending' && bothSlotsKnown(row) && (row.upper_bye || row.lower_bye) && !guard.has(row.id)) {
      guard.add(row.id);
      const bothByes = row.upper_bye && row.lower_bye;
      const state: MatchState = bothByes ? 'not_needed' : 'bye';
      const winner: Winner = bothByes ? null : row.upper_bye ? 'lower' : 'upper';
      const updated = await updateMatch(db, row.id, { state, winner }, 'system');
      broadcastMatch(outbox, updated);
      queue.push(updated.id);
    }
  }
};

export const startTournament = async (effects: Effects, entrants: EntrantRow[]): Promise<void> => {
  const { db, tournament } = effects;
  const fieldSize = entrants.length;
  const bySeed = new Map(entrants.map((entrant) => [entrant.seed, entrant]));
  const structure = buildStructure(tournament.format, fieldSize);
  const createdAt = new Date(now());

  for (const spec of structure.matches) {
    const upper = spec.upper === null || spec.upper === 'bye' ? null : bySeed.get(spec.upper.seed)?.id ?? null;
    const lower = spec.lower === null || spec.lower === 'bye' ? null : bySeed.get(spec.lower.seed)?.id ?? null;
    await db.query(
      `insert into matches (id, tournament_id, bracket, round, number, label, upper_entrant_id, lower_entrant_id,
        upper_bye, lower_bye, state, version, paired_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12)`,
      [
        newId(),
        tournament.id,
        spec.bracket,
        spec.round,
        spec.number,
        matchLabel(spec.bracket, spec.round, spec.number),
        upper,
        lower,
        spec.upper === 'bye',
        spec.lower === 'bye',
        spec.waiting === true ? 'waiting' : 'pending',
        createdAt,
      ],
    );
  }

  const created = await loadMatches(db, tournament.id);
  const keyed = new Map(created.map((match) => [`${match.bracket}:${match.round}:${match.number}`, match]));
  for (const feed of structure.feeds) {
    const from = keyed.get(`${feed.from.bracket}:${feed.from.round}:${feed.from.number}`);
    const to = keyed.get(`${feed.to.bracket}:${feed.to.round}:${feed.to.number}`);
    if (from === undefined || to === undefined) continue;
    await db.query(
      'insert into match_feeds (tournament_id, src_match_id, outcome, dst_match_id, slot) values ($1,$2,$3,$4,$5)',
      [tournament.id, from.id, feed.outcome, to.id, feed.slot],
    );
  }

  let swissRounds: number | null = null;
  if (tournament.format === 'swiss') {
    swissRounds = swissRoundCount(fieldSize);
    await createSwissRound(effects, entrants, [], 1);
  }

  await db.query(
    `update tournaments set state = 'running', started_at = $2, field_size = $3, swiss_rounds = $4 where id = $1`,
    [tournament.id, createdAt, fieldSize, swissRounds],
  );
  effects.tournament = { ...tournament, state: 'running', started_at: createdAt, field_size: fieldSize, swiss_rounds: swissRounds };

  if (tournament.format !== 'swiss') {
    await propagate(effects, created.map((match) => match.id), false);
  }
  effects.sentences.push(ANNOUNCE.started);
  await broadcastTournament(effects);
  await broadcastStandings(effects);
  await finishIfDone(effects);
  flushSentences(effects);
};

export const createSwissRound = async (
  effects: Effects,
  entrants: EntrantRow[],
  matches: MatchRow[],
  round: number,
): Promise<MatchRow[] | null> => {
  const pairing = pairSwissRound(entrants, matches, round);
  if (pairing === null) return null;
  const pairedAt = new Date(now());
  const created: MatchRow[] = [];
  let number = 0;
  for (const pair of pairing.pairs) {
    number += 1;
    const id = newId();
    await effects.db.query(
      `insert into matches (id, tournament_id, bracket, round, number, label, upper_entrant_id, lower_entrant_id,
        state, version, paired_at) values ($1,$2,'main',$3,$4,$5,$6,$7,'pending',1,$8)`,
      [id, effects.tournament.id, round, number, matchLabel('main', round, number), pair.upper, pair.lower, pairedAt],
    );
    created.push((await loadMatch(effects.db, id)) as MatchRow);
  }
  if (pairing.byeEntrantId !== null) {
    number += 1;
    const id = newId();
    await effects.db.query(
      `insert into matches (id, tournament_id, bracket, round, number, label, upper_entrant_id, lower_bye,
        state, upper_games, lower_games, winner, version, paired_at)
       values ($1,$2,'main',$3,$4,$5,$6,true,'bye',2,0,'upper',1,$7)`,
      [id, effects.tournament.id, round, number, matchLabel('main', round, number), pairing.byeEntrantId, pairedAt],
    );
    created.push((await loadMatch(effects.db, id)) as MatchRow);
  }
  return created;
};

const championName = async (effects: Effects, matches: MatchRow[]): Promise<string | null> => {
  const { format } = effects.tournament;
  if (format === 'round_robin' || format === 'swiss') {
    const entrants = await loadEntrants(effects.db, effects.tournament.id);
    return computeStandings(format, entrants, matches).rows[0]?.name ?? null;
  }
  const final = decidingMatch(format, matches);
  if (final === undefined || !hasResult(final)) return null;
  return final.winner === 'upper' ? final.upper_name : final.lower_name;
};

const UNSETTLED: MatchState[] = ['pending', 'called', 'reported', 'disputed'];

const isFinished = (effects: Effects, matches: MatchRow[]): boolean => {
  const { format, swiss_rounds } = effects.tournament;
  if (format === 'single_elimination') {
    const final = decidingMatch(format, matches);
    return final !== undefined && hasResult(final);
  }
  if (format === 'double_elimination') {
    const grandFinal = matches.find((match) => match.bracket === 'final' && match.round === 1);
    const reset = matches.find((match) => match.bracket === 'final' && match.round === 2);
    if (reset !== undefined && hasResult(reset)) return true;
    return grandFinal !== undefined && hasResult(grandFinal) && grandFinal.winner === 'upper';
  }
  if (format === 'round_robin') {
    return matches.every((match) => !UNSETTLED.includes(match.state));
  }
  const lastRound = matches.reduce((highest, match) => Math.max(highest, match.round), 0);
  if (swiss_rounds === null || lastRound < swiss_rounds) return false;
  return matches
    .filter((match) => match.round === lastRound)
    .every((match) => !UNSETTLED.includes(match.state));
};

export const finishIfDone = async (effects: Effects): Promise<boolean> => {
  const { db, tournament } = effects;
  if (tournament.state !== 'running') return false;
  const matches = await loadMatches(db, tournament.id);
  if (matches.length === 0 || !isFinished(effects, matches)) return false;

  const entrants = await loadEntrants(db, tournament.id);
  const places = computePlacements(tournament.format, entrants, matches);
  const finishedAt = new Date(now());
  const finishedOn = zoneDate(finishedAt.getTime(), tournament.time_zone);

  for (const entrant of entrants) {
    const place = places.get(entrant.id) ?? entrants.length;
    await db.query('update entrants set placement = $2 where id = $1', [entrant.id, place]);
    if (entrant.user_id === null) continue;
    await db.query(
      `insert into history_rows (id, user_id, tournament_id, tournament_name, place, field_size, finished_on, text, finished_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (user_id, tournament_id) do nothing`,
      [
        newId(),
        entrant.user_id,
        tournament.id,
        tournament.name,
        place,
        entrants.length,
        finishedOn,
        historyRowText(tournament.name, place, entrants.length, finishedOn),
        finishedAt,
      ],
    );
  }

  await db.query(`update tournaments set state = 'finished', finished_at = $2, finished_on = $3 where id = $1`, [
    tournament.id,
    finishedAt,
    finishedOn,
  ]);
  effects.tournament = { ...tournament, state: 'finished', finished_at: finishedAt, finished_on: finishedOn };

  const champion = await championName(effects, matches);
  if (champion !== null) effects.sentences.push(ANNOUNCE.winsTournament(champion));
  await broadcastTournament(effects);
  return true;
};

/** Called after a match reaches a result: advance, update standings and finish when done. */
export const afterResult = async (effects: Effects, row: MatchRow): Promise<void> => {
  broadcastMatch(effects.outbox, row);
  await propagate(effects, [row.id], true);
  await broadcastStandings(effects);
  await finishIfDone(effects);
  flushSentences(effects);
};

export const overdueFor = (tournament: TournamentRow, match: MatchRow, currentRound: number): boolean => {
  if (tournament.state !== 'running') return false;
  if (match.state === 'called' && match.called_at !== null) {
    if (now() - match.called_at.getTime() >= config.matchLimitMs) return true;
  }
  if (tournament.format === 'swiss' && match.round === currentRound && match.paired_at !== null) {
    if (
      (match.state === 'pending' || match.state === 'called') &&
      now() - match.paired_at.getTime() >= config.swissRoundMs
    ) {
      return true;
    }
  }
  return false;
};

/** Overdue never changes a match's version or updated_by, and reaches organizers only. */
export const refreshOverdue = async (effects: Effects): Promise<void> => {
  const matches = await loadMatches(effects.db, effects.tournament.id);
  if (matches.length === 0) return;
  const currentRound = regionCurrentRound(matches.map((match) => toApiMatch(match, false)), 'main');
  for (const match of matches) {
    const wanted = overdueFor(effects.tournament, match, currentRound);
    if (wanted === match.overdue) continue;
    const updated = await updateMatch(effects.db, match.id, { overdue: wanted }, null, false);
    effects.outbox.add('match.updated', { match: toApiMatch(updated, true) }, 'organizers');
  }
};

export const autoConfirmDue = async (effects: Effects): Promise<void> => {
  const matches = await loadMatches(effects.db, effects.tournament.id);
  const due = matches
    .filter(
      (match) => match.state === 'reported' && match.auto_confirm_at !== null && match.auto_confirm_at.getTime() <= now(),
    )
    .sort((a, b) => (a.auto_confirm_at as Date).getTime() - (b.auto_confirm_at as Date).getTime());
  for (const match of due) {
    const report = match.report;
    if (report === null) continue;
    const winner: Winner =
      report.upper_games === report.lower_games ? 'draw' : report.upper_games > report.lower_games ? 'upper' : 'lower';
    const updated = await updateMatch(
      effects.db,
      match.id,
      {
        state: 'confirmed',
        upper_games: report.upper_games,
        lower_games: report.lower_games,
        winner,
        auto_confirm_at: null,
        overdue: false,
      },
      'system',
    );
    await afterResult(effects, updated);
  }
};

export const closeCheckinIfDue = async (effects: Effects): Promise<void> => {
  const { tournament } = effects;
  if (tournament.state !== 'checkin_open' || tournament.checkin_closes_at === null) return;
  if (tournament.checkin_closes_at.getTime() > now()) return;
  await closeCheckin(effects, tournament.checkin_closes_at);
};

export const closeCheckin = async (effects: Effects, at: Date): Promise<void> => {
  await effects.db.query(
    `update tournaments set state = 'checkin_closed', checkin_closed_at = $2 where id = $1`,
    [effects.tournament.id, at],
  );
  effects.tournament = { ...effects.tournament, state: 'checkin_closed', checkin_closed_at: at };
  effects.sentences.push(ANNOUNCE.checkinClosed);
  await broadcastTournament(effects);
  flushSentences(effects);
};

export const autoConfirmAt = (reportedAt: number): string => iso(reportedAt + config.confirmWindowMs);
