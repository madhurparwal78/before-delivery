import { isUuid } from '../http/router.js';
import { MATCH_VISIBLE, TEAM_VISIBLE, TOURNAMENT_VISIBLE } from './access.js';
import { query } from './pool.js';

/** The match a viewer code opens; null when the code is unknown or the viewer link is off. */
export const matchIdByCode = async (code: string): Promise<string | null> => {
  if (code.includes('\0')) return null;
  const rows = await query<{ id: string }>('SELECT id FROM matches WHERE viewer_code = $1 AND viewer_link', [code]);
  return rows[0]?.id ?? null;
};

export const canSeeMatch = async (userId: string, matchId: string): Promise<boolean> =>
  isUuid(matchId) && (await query(`SELECT 1 FROM matches m WHERE m.id = $2 AND ${MATCH_VISIBLE}`, [userId, matchId])).length > 0;

export const isMatchOrganiser = async (userId: string, matchId: string): Promise<boolean> =>
  isUuid(matchId) && (await query('SELECT 1 FROM matches WHERE id = $2 AND organiser_id = $1', [userId, matchId])).length > 0;

export const canSeeTeam = async (userId: string, teamId: string): Promise<boolean> =>
  isUuid(teamId) && (await query(`SELECT 1 FROM teams t WHERE t.id = $2 AND ${TEAM_VISIBLE}`, [userId, teamId])).length > 0;

export const canSeeTournament = async (userId: string, tournamentId: string): Promise<boolean> =>
  isUuid(tournamentId) && (await query(`SELECT 1 FROM tournaments tr WHERE tr.id = $2 AND ${TOURNAMENT_VISIBLE}`, [userId, tournamentId])).length > 0;

export const canSeePlayer = async (userId: string, playerId: string): Promise<boolean> =>
  isUuid(playerId) && (await query(
    `SELECT 1 FROM players p JOIN teams t ON t.id = p.team_id WHERE p.id = $2 AND ${TEAM_VISIBLE}`, [userId, playerId])).length > 0;
