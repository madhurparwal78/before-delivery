import { ERROR_MESSAGES } from '../../shared/copy';
import type { SharePayload } from '../../shared/types';
import { requireUser } from '../auth';
import { pool } from '../db';
import { notFound } from '../errors';
import { type Ctx, sendJson } from '../http';
import { loadMatches, toApiMatch } from '../domain/matches';
import { computeStandings } from '../domain/standings';
import {
  loadEntrants,
  loadTournamentByShare,
  publicTournament,
  toApiTournament,
  type TournamentRow,
} from '../domain/tournaments';

export const shareTournament = async (db: typeof pool, tournament: TournamentRow): Promise<SharePayload> => {
  const entrants = await loadEntrants(db, tournament.id);
  const matches = await loadMatches(db, tournament.id);
  const { format } = tournament;
  return {
    tournament: publicTournament(await toApiTournament(db, tournament, 'viewer')),
    entrants: entrants.map((entrant) => ({ name: entrant.name, seed: entrant.seed })),
    matches: matches.map((row) => toApiMatch(row, false)),
    standings:
      format === 'round_robin' || format === 'swiss' ? computeStandings(format, entrants, matches) : null,
  };
};

export const requireShare = async (code: string): Promise<TournamentRow> => {
  const tournament = await loadTournamentByShare(pool, code);
  if (tournament === null) throw notFound(ERROR_MESSAGES.notFoundShare);
  if (tournament.state === 'draft') throw notFound(ERROR_MESSAGES.notPublicYet);
  return tournament;
};

export const getShare = async (ctx: Ctx): Promise<void> => {
  const tournament = await requireShare(ctx.params.code as string);
  sendJson(ctx.res, 200, await shareTournament(pool, tournament));
};

export const getHistory = async (ctx: Ctx): Promise<void> => {
  requireUser(ctx);
  const username = (ctx.params.username as string).toLowerCase();
  const user = await pool.query<{ id: string }>('select id from users where username = $1', [username]);
  const owner = user.rows[0];
  if (owner === undefined) throw notFound();
  const { rows } = await pool.query<{
    tournament_id: string;
    tournament_name: string;
    place: number;
    field_size: number;
    finished_on: string;
    text: string;
  }>(
    `select tournament_id, tournament_name, place, field_size, finished_on, text
     from history_rows where user_id = $1 order by finished_at desc, tournament_name`,
    [owner.id],
  );
  sendJson(ctx.res, 200, { rows });
};
