import { createUser, startSession, validateCredentials } from '../auth';
import { advanceClock, now, nowIso } from '../clock';
import { type Db, newId, newShareCode, pool, transact } from '../db';
import { AppError, invalid, notFound, validation } from '../errors';
import { type Ctx, readJsonBody, sendJson } from '../http';
import { Outbox, flushOutbox, publish } from '../live';
import type { Effects } from '../domain/engine';
import { createSwissRound, finishIfDone, flushSentences, startTournament } from '../domain/engine';
import { loadMatchByLabel, loadMatches, type MatchRow } from '../domain/matches';
import {
  callMatch,
  confirmScore,
  disputeScore,
  reportScore,
  resolveDispute,
  saveResult,
  type Actor,
} from '../domain/play';
import { loadEntrants, loadTournament, type EntrantRow, type TournamentRow } from '../domain/tournaments';
import { applyDueDeadlines } from '../timers';
import { ANNOUNCE } from '../../shared/copy';

interface SeedUser {
  username: string;
  password: string;
}

interface SeedStep {
  match?: string;
  action: 'called' | 'reported' | 'disputed' | 'confirmed' | 'resolved' | 'next_round';
  upper_games?: number;
  lower_games?: number;
  by?: string;
  counter?: { upper_games: number; lower_games: number };
  resolver?: string;
}

interface SeedEntrant {
  name: string;
  seed: number;
  username?: string;
  checked_in?: boolean;
}

interface SeedTournament {
  key: string;
  name: string;
  format: string;
  organizer: string;
  co_organizers?: string[];
  time_zone?: string;
  fill?: string;
  state?: string;
  checkin_closes_at?: string;
  entrants?: SeedEntrant[];
  steps?: SeedStep[];
}

const userId = async (db: Db, username: string): Promise<string> => {
  const { rows } = await db.query<{ id: string }>('select id from users where username = $1', [username]);
  const found = rows[0];
  if (found === undefined) throw invalid(`No account named @${username}.`);
  return found.id;
};

const actorForEntrant = (entrant: EntrantRow, organizerUsername: string, organizerId: string): Actor => ({
  userId: entrant.user_id ?? organizerId,
  username: entrant.username ?? organizerUsername,
  isOrganizer: false,
  entrantId: entrant.id,
});

const organizerActor = (username: string, id: string): Actor => ({
  userId: id,
  username,
  isOrganizer: true,
  entrantId: null,
});

const entrantByName = (entrants: EntrantRow[], name: string): EntrantRow => {
  const found = entrants.find((entrant) => entrant.name === name);
  if (found === undefined) throw invalid(`No entrant named ${name}.`);
  return found;
};

const matchByLabel = async (db: Db, tournamentId: string, label: string): Promise<MatchRow> => {
  const match = await loadMatchByLabel(db, tournamentId, label);
  if (match === null) throw invalid(`No match labelled ${label}.`);
  return match;
};

const opponentOf = (match: MatchRow, entrantId: string, entrants: EntrantRow[]): EntrantRow => {
  const otherId = match.upper_entrant_id === entrantId ? match.lower_entrant_id : match.upper_entrant_id;
  const found = entrants.find((entrant) => entrant.id === otherId);
  if (found === undefined) throw invalid(`Match ${match.label} has no opponent yet.`);
  return found;
};

const applyStep = async (effects: Effects, step: SeedStep, organizer: { username: string; id: string }): Promise<void> => {
  const entrants = await loadEntrants(effects.db, effects.tournament.id);
  const organizerAct = organizerActor(organizer.username, organizer.id);

  if (step.action === 'next_round') {
    const matches = await loadMatches(effects.db, effects.tournament.id);
    const lastRound = matches.reduce((highest, match) => Math.max(highest, match.round), 0);
    const created = await createSwissRound(effects, entrants, matches, lastRound + 1);
    if (created === null) throw invalid('No pairing without a rematch exists.');
    effects.sentences.push(ANNOUNCE.roundPaired(lastRound + 1));
    await finishIfDone(effects);
    flushSentences(effects);
    return;
  }

  const label = step.match ?? '';
  let match = await matchByLabel(effects.db, effects.tournament.id, label);

  if (step.action === 'called') {
    await callMatch(effects, match, organizerAct, match.version);
    return;
  }

  const score = { upper_games: step.upper_games, lower_games: step.lower_games };

  if (step.action === 'confirmed' && step.by === undefined) {
    await saveResult(effects, match, organizerAct, { ...score, version: match.version });
    return;
  }

  if (step.action === 'resolved') {
    const resolverName = step.resolver ?? organizer.username;
    const resolverId = await userId(effects.db, resolverName);
    await resolveDispute(
      effects,
      match,
      organizerActor(resolverName, resolverId),
      { ...score, version: match.version },
    );
    return;
  }

  const reporter = entrantByName(entrants, step.by ?? '');
  const reporterActor = actorForEntrant(reporter, organizer.username, organizer.id);
  await reportScore(effects, match, reporterActor, { ...score, version: match.version });
  match = await matchByLabel(effects.db, effects.tournament.id, label);

  if (step.action === 'reported') return;

  const opponent = opponentOf(match, reporter.id, entrants);
  const opponentActor = actorForEntrant(opponent, organizer.username, organizer.id);

  if (step.action === 'confirmed') {
    await confirmScore(effects, match, opponentActor, match.version);
    return;
  }

  await disputeScore(effects, match, opponentActor, {
    upper_games: step.counter?.upper_games,
    lower_games: step.counter?.lower_games,
    version: match.version,
  });
};

export const seed = async (ctx: Ctx): Promise<void> => {
  const body = await readJsonBody(ctx.req);
  const users = Array.isArray(body.users) ? (body.users as SeedUser[]) : [];
  const tournaments = Array.isArray(body.tournaments) ? (body.tournaments as SeedTournament[]) : [];

  const result = await transact(async (db) => {
    const createdUsers: Record<string, { id: string }> = {};
    for (const user of users) {
      const { username, password } = validateCredentials(user.username, user.password);
      const row = await createUser(db, username, password);
      createdUsers[username] = { id: row.id };
    }

    const createdTournaments: Record<
      string,
      { id: string; share_code: string; entrants: Record<string, string>; matches: Record<string, string> }
    > = {};
    const published: { id: string; messages: Awaited<ReturnType<typeof flushOutbox>> }[] = [];

    for (const spec of tournaments) {
      const id = newId();
      const shareCode = newShareCode();
      const organizerId = await userId(db, spec.organizer.toLowerCase());
      const state = spec.state ?? 'draft';
      const closesAt = spec.checkin_closes_at === undefined ? null : new Date(spec.checkin_closes_at);
      await db.query(
        `insert into tournaments (id, name, format, time_zone, fill, state, organizer_id, share_code,
          checkin_closes_at, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          spec.name,
          spec.format,
          spec.time_zone ?? 'UTC',
          spec.fill ?? 'lilac',
          state === 'running' || state === 'finished' ? 'draft' : state,
          organizerId,
          shareCode,
          closesAt,
          new Date(now()),
        ],
      );
      for (const coOrganizer of spec.co_organizers ?? []) {
        await db.query('insert into co_organizers (tournament_id, user_id) values ($1,$2)', [
          id,
          await userId(db, coOrganizer.toLowerCase()),
        ]);
      }
      for (const entrant of spec.entrants ?? []) {
        await db.query(
          'insert into entrants (id, tournament_id, name, seed, user_id, checked_in) values ($1,$2,$3,$4,$5,$6)',
          [
            newId(),
            id,
            entrant.name,
            entrant.seed,
            entrant.username === undefined ? null : await userId(db, entrant.username.toLowerCase()),
            entrant.checked_in === true,
          ],
        );
      }

      const outbox = new Outbox();
      const tournament = (await loadTournament(db, id)) as TournamentRow;
      const effects: Effects = { db, outbox, tournament, sentences: [], actor: spec.organizer };

      if (state === 'running' || state === 'finished') {
        const entrants = await loadEntrants(db, id);
        await startTournament(effects, entrants);
        for (const step of spec.steps ?? []) {
          try {
            await applyStep(effects, step, { username: spec.organizer.toLowerCase(), id: organizerId });
          } catch (error) {
            if (error instanceof AppError) throw invalid(error.message);
            throw error;
          }
        }
        if (state === 'finished' && effects.tournament.state !== 'finished') {
          throw invalid('Seed steps do not finish the tournament.');
        }
      }

      const entrants = await loadEntrants(db, id);
      const matches = await loadMatches(db, id);
      createdTournaments[spec.key] = {
        id,
        share_code: shareCode,
        entrants: Object.fromEntries(entrants.map((entrant) => [entrant.name, entrant.id])),
        matches: Object.fromEntries(matches.map((match) => [match.label, match.id])),
      };
      published.push({ id, messages: await flushOutbox(db, id, outbox) });
    }

    return { users: createdUsers, tournaments: createdTournaments, published };
  });

  for (const entry of result.published) publish(entry.id, entry.messages);
  sendJson(ctx.res, 201, { users: result.users, tournaments: result.tournaments });
};

export const gradingSession = async (ctx: Ctx): Promise<void> => {
  const body = await readJsonBody(ctx.req);
  const username = typeof body.username === 'string' ? body.username.toLowerCase() : '';
  const { rows } = await pool.query<{ id: string; username: string }>(
    'select id, username from users where username = $1',
    [username],
  );
  const user = rows[0];
  if (user === undefined) throw notFound();
  await transact(async (db) => {
    await startSession(db, ctx.res, user.id);
  });
  sendJson(ctx.res, 200, { user: { username: user.username } });
};

export const gradingClock = async (ctx: Ctx): Promise<void> => {
  const body = await readJsonBody(ctx.req);
  const advance = body.advance_ms;
  if (typeof advance !== 'number' || !Number.isInteger(advance) || advance < 0 || advance > 604800000) {
    throw validation({ advance_ms: 'Enter a whole number from 0 to 604800000.' });
  }
  advanceClock(advance);
  await applyDueDeadlines();
  sendJson(ctx.res, 200, { server_time: nowIso() });
};

