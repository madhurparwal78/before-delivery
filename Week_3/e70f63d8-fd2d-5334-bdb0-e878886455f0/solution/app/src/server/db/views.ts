import type {
  GroupTable, MatchDetail, MatchListItem, MatchSide, PlayerRef, ScorerMatchState, TeamDetail,
} from '../../shared/wire.js';
import { dayText } from '../../shared/dates.js';
import { buildState } from '../laws/present.js';
import { groupTable } from '../laws/standings.js';
import type { MatchFacts } from '../laws/standings.js';
import type { Side } from '../laws/types.js';
import { MATCH_VISIBLE, TEAM_VISIBLE } from './access.js';
import type { Bundle, MatchRow } from './matches.js';
import { notFound } from '../http/errors.js';
import { canSeeMatch } from './lookup.js';
import { MATCH_SELECT, bundleOf, loadMatch, logoUrl } from './matches.js';
import type { Row } from './pool.js';
import { direct, query } from './pool.js';

const playerRef = (player: Side['xi'][number]): PlayerRef => ({ id: player.id, name: player.name, short_name: player.shortName });

/** A match this user may open, as a loaded bundle; 404 for anything else. */
export const visibleBundle = async (userId: string, matchId: string): Promise<Bundle> => {
  if (!(await canSeeMatch(userId, matchId))) throw notFound();
  return loadMatch(direct, matchId);
};

export const scorerState = (bundle: Bundle): ScorerMatchState => ({
  ...buildState(bundle.view, bundle.ctx), viewer_link: bundle.row.viewer_link, viewer_code: bundle.row.viewer_link ? bundle.row.viewer_code : null,
});

const sideOf = (side: Side, logo: string | null, uploads: number): MatchSide => ({
  id: side.id, name: side.name, logo_url: logoUrl(side.id, logo, uploads), xi: side.xi.map(playerRef),
});

export const matchDetail = async (bundle: Bundle): Promise<MatchDetail> => {
  const scorers = await query<{ display_name: string }>(
    `SELECT u.display_name FROM users u WHERE u.id = $1
     UNION ALL SELECT u.display_name FROM match_scorers s JOIN users u ON u.id = s.user_id WHERE s.match_id = $2`,
    [bundle.row.organiser_id, bundle.row.id]);
  const row = bundle.row;
  return {
    id: row.id, title: `${row.home_name} v ${row.away_name}`, status: bundle.view.status,
    home: sideOf(bundle.spec.home, row.home_logo, row.home_uploads), away: sideOf(bundle.spec.away, row.away_logo, row.away_uploads),
    overs: row.overs, players_per_side: row.players_per_side, super_over: row.super_over,
    tournament: row.tournament_id && row.tournament_name ? { id: row.tournament_id, name: row.tournament_name } : null,
    viewer_link: row.viewer_link, viewer_code: row.viewer_link ? row.viewer_code : null,
    scorers: scorers.map((scorer) => ({ display_name: scorer.display_name })),
    next_innings: bundle.view.next ? { batting_team: bundle.view.next.battingTeam.id, bowling_team: bundle.view.next.bowlingTeam.id } : null,
  };
};

export const matchListItem = (bundle: Bundle, userId: string): MatchListItem => ({
  id: bundle.row.id, title: `${bundle.row.home_name} v ${bundle.row.away_name}`, status: bundle.view.status,
  played_on: bundle.playedOn, result: bundle.view.result?.text ?? null, is_organiser: bundle.row.organiser_id === userId,
});

export const visibleMatches = async (userId: string): Promise<Bundle[]> => {
  const rows = await query<MatchRow>(`${MATCH_SELECT} WHERE ${MATCH_VISIBLE} ORDER BY m.created_at DESC`, [userId]);
  return Promise.all(rows.map((row) => bundleOf(direct, row)));
};

export const teamDetail = async (userId: string, teamId: string): Promise<TeamDetail | null> => {
  const teams = await query<{ id: string; name: string; logo_key: string | null; logo_uploads: number; organiser_id: string }>(
    `SELECT t.id, t.name, t.logo_key, t.logo_uploads, t.organiser_id FROM teams t WHERE t.id = $2 AND ${TEAM_VISIBLE}`, [userId, teamId]);
  const team = teams[0];
  if (!team) return null;
  const players = await query<{ id: string; name: string; short_name: string }>(
    'SELECT id, name, short_name FROM players WHERE team_id = $1 ORDER BY position', [teamId]);
  const rows = await query<MatchRow>(
    `${MATCH_SELECT} WHERE (m.home_team_id = $2 OR m.away_team_id = $2) AND ${MATCH_VISIBLE} ORDER BY m.created_at DESC`, [userId, teamId]);
  const bundles = await Promise.all(rows.map((row) => bundleOf(direct, row)));
  const dated = bundles.flatMap((bundle) => (bundle.view.result
    ? [{ bundle, result: bundle.view.result.text, day: bundle.playedOn ?? bundle.row.created_at.toISOString().slice(0, 10) }] : []))
    .sort((a, b) => b.day.localeCompare(a.day));
  return {
    id: team.id, name: team.name, logo_url: logoUrl(team.id, team.logo_key, team.logo_uploads), is_organiser: team.organiser_id === userId,
    players: players.map((player) => ({ id: player.id, name: player.name, short_name: player.short_name })),
    matches: dated.map(({ bundle, result, day }) => ({
      id: bundle.row.id,
      line: `${bundle.row.home_name} v ${bundle.row.away_name}, ${dayText(day)}: ${result}`,
      scorecard_url: bundle.row.summary ? null : `/matches/${bundle.row.id}/scorecard`,
    })),
  };
};

interface GroupRow extends Row { id: string; name: string }

/** A tournament's tables, group by group, from the finished matches of teams in the same group. */
export const tournamentTables = async (tournamentId: string): Promise<GroupTable[]> => {
  const groups = await query<GroupRow>('SELECT id, name FROM tournament_groups WHERE tournament_id = $1 ORDER BY position', [tournamentId]);
  const members = await query<{ group_id: string; id: string; name: string }>(
    `SELECT g.group_id, t.id, t.name FROM group_teams g JOIN teams t ON t.id = g.team_id WHERE g.tournament_id = $1 ORDER BY t.name`, [tournamentId]);
  const rows = await query<MatchRow>(`${MATCH_SELECT} WHERE m.tournament_id = $1 ORDER BY m.created_at`, [tournamentId]);
  const bundles = await Promise.all(rows.map((row) => bundleOf(direct, row)));
  return groups.map((group) => {
    const teams = members.filter((member) => member.group_id === group.id);
    const ids = new Set(teams.map((team) => team.id));
    const inGroup = bundles.filter((bundle) => ids.has(bundle.row.home_team_id) && ids.has(bundle.row.away_team_id));
    const facts: MatchFacts[] = inGroup.flatMap((bundle) => (bundle.facts ? [bundle.facts] : []));
    return {
      name: group.name,
      table: groupTable(teams, facts),
      matches: inGroup.map((bundle) => ({
        id: bundle.row.id, home: bundle.row.home_name, away: bundle.row.away_name, status: bundle.view.status,
        result: bundle.view.result?.text ?? null,
      })),
    };
  });
};
