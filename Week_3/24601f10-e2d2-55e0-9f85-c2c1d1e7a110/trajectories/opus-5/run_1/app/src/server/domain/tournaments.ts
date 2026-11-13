import { ERROR_MESSAGES } from '../../shared/copy';
import { overallCurrentRound } from '../../shared/current';
import type { ApiEntrant, ApiTournament, Fill, Format, Role, TournamentState } from '../../shared/types';
import { iso, nowIso } from '../clock';
import { config } from '../config';
import type { Db } from '../db';
import { forbidden, notFound } from '../errors';
import { loadMatches, toApiMatch } from './matches';

export interface TournamentRow {
  id: string;
  name: string;
  format: Format;
  time_zone: string;
  fill: Fill;
  state: TournamentState;
  organizer_id: string;
  share_code: string;
  checkin_closes_at: Date | null;
  checkin_closed_at: Date | null;
  seeding_version: number;
  seeding_by: string | null;
  swiss_rounds: number | null;
  field_size: number | null;
  roster_key: string | null;
  roster_file_name: string | null;
  roster_sha256: string | null;
  logo_key: string | null;
  logo_content_type: string | null;
  logo_sha256: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  finished_on: string | null;
  last_seq: number;
}

export interface EntrantRow {
  id: string;
  tournament_id: string;
  name: string;
  seed: number;
  user_id: string | null;
  checked_in: boolean;
  placement: number | null;
  username: string | null;
}

const ENTRANT_SELECT = `
  select e.*, u.username
  from entrants e left join users u on u.id = e.user_id
  where e.tournament_id = $1 order by e.seed`;

export const loadEntrants = async (db: Db, tournamentId: string): Promise<EntrantRow[]> => {
  const { rows } = await db.query<EntrantRow>(ENTRANT_SELECT, [tournamentId]);
  return rows;
};

export const toApiEntrant = (row: EntrantRow, asOrganizer: boolean): ApiEntrant => {
  const entrant: ApiEntrant = { id: row.id, name: row.name, seed: row.seed, checked_in: row.checked_in };
  if (asOrganizer) entrant.username = row.username;
  return entrant;
};

export const loadTournament = async (db: Db, id: string): Promise<TournamentRow | null> => {
  const { rows } = await db.query<TournamentRow>('select * from tournaments where id = $1', [id]);
  return rows[0] ?? null;
};

export const loadTournamentByShare = async (db: Db, shareCode: string): Promise<TournamentRow | null> => {
  const { rows } = await db.query<TournamentRow>('select * from tournaments where share_code = $1', [shareCode]);
  return rows[0] ?? null;
};

export const lockTournament = async (db: Db, id: string): Promise<TournamentRow | null> => {
  const { rows } = await db.query<TournamentRow>('select * from tournaments where id = $1 for update', [id]);
  return rows[0] ?? null;
};

export const coOrganizerUsernames = async (db: Db, tournamentId: string): Promise<string[]> => {
  const { rows } = await db.query<{ username: string }>(
    `select u.username from co_organizers c join users u on u.id = c.user_id
     where c.tournament_id = $1 order by u.username`,
    [tournamentId],
  );
  return rows.map((row) => row.username);
};

export const roleFor = async (db: Db, tournament: TournamentRow, userId: string | null): Promise<Role> => {
  if (userId === null) return 'viewer';
  if (tournament.organizer_id === userId) return 'organizer';
  const co = await db.query('select 1 from co_organizers where tournament_id = $1 and user_id = $2', [
    tournament.id,
    userId,
  ]);
  if (co.rows.length > 0) return 'co_organizer';
  const entrant = await db.query('select 1 from entrants where tournament_id = $1 and user_id = $2', [
    tournament.id,
    userId,
  ]);
  if (entrant.rows.length > 0) return 'player';
  return 'viewer';
};

export const isOrganizerRole = (role: Role): boolean => role === 'organizer' || role === 'co_organizer';

export const shareUrl = (shareCode: string): string => `${config.publicUrl}/s/${shareCode}`;

export const toApiTournament = async (
  db: Db,
  tournament: TournamentRow,
  role: Role,
): Promise<ApiTournament> => {
  const entrants = await loadEntrants(db, tournament.id);
  const matches = (await loadMatches(db, tournament.id)).map((row) => toApiMatch(row, false));
  const asOrganizer = isOrganizerRole(role);
  const shaped: ApiTournament = {
    id: tournament.id,
    name: tournament.name,
    format: tournament.format,
    state: tournament.state,
    time_zone: tournament.time_zone,
    fill: tournament.fill,
    checkin_closes_at: tournament.checkin_closes_at === null ? null : iso(tournament.checkin_closes_at.getTime()),
    server_time: nowIso(),
    field_size: tournament.field_size,
    entrant_count: entrants.length,
    checked_in_count: entrants.filter((entrant) => entrant.checked_in).length,
    current_round: overallCurrentRound(matches, tournament.format),
    swiss_rounds: tournament.swiss_rounds,
    logo_url: tournament.logo_key === null ? null : `/api/tournaments/${tournament.id}/logo`,
    seeding_version: tournament.seeding_version,
    my_role: role,
    has_roster: tournament.roster_key !== null,
    finished_on: tournament.finished_on,
  };
  if (asOrganizer) {
    shaped.share_url = shareUrl(tournament.share_code);
    shaped.co_organizers = await coOrganizerUsernames(db, tournament.id);
  }
  return shaped;
};

export const publicTournament = (tournament: ApiTournament): ApiTournament => {
  const shaped: ApiTournament = { ...tournament, my_role: 'viewer' };
  delete shaped.share_url;
  delete shaped.co_organizers;
  return shaped;
};

export interface Visible {
  tournament: TournamentRow;
  role: Role;
}

/** A draft tournament is visible only to its organizers; everyone else gets 404, never 403. */
export const requireVisible = async (db: Db, id: string, userId: string | null): Promise<Visible> => {
  const tournament = await loadTournament(db, id);
  if (tournament === null) throw notFound();
  const role = await roleFor(db, tournament, userId);
  if (tournament.state === 'draft' && !isOrganizerRole(role)) throw notFound();
  return { tournament, role };
};

export const requireOrganizer = (visible: Visible): void => {
  if (!isOrganizerRole(visible.role)) throw forbidden();
};

export const requireOwner = (visible: Visible, userId: string): void => {
  if (visible.tournament.organizer_id !== userId) throw forbidden(ERROR_MESSAGES.forbiddenOrganizerOnly);
};
