// Visibility predicates. $1 is always the signed-in user's id. A record is visible to its organiser and, for matches,
// to the match's scorers; teams, players and tournaments follow the matches they appear in.

export const MATCH_VISIBLE = `(m.organiser_id = $1 OR EXISTS (SELECT 1 FROM match_scorers s WHERE s.match_id = m.id AND s.user_id = $1))`;

export const TEAM_VISIBLE = `(t.organiser_id = $1 OR EXISTS (
  SELECT 1 FROM matches m JOIN match_scorers s ON s.match_id = m.id
  WHERE s.user_id = $1 AND (m.home_team_id = t.id OR m.away_team_id = t.id)))`;

export const TOURNAMENT_VISIBLE = `(tr.organiser_id = $1 OR EXISTS (
  SELECT 1 FROM matches m JOIN match_scorers s ON s.match_id = m.id
  WHERE s.user_id = $1 AND m.tournament_id = tr.id))`;
