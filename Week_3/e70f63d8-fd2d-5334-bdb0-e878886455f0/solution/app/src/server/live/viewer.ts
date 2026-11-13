import type { MatchState, Scorecard, TeamRef } from '../../shared/wire.js';

const viewerLogo = (team: TeamRef, code: string): TeamRef => ({
  ...team, logo_url: team.logo_url === null ? null : team.logo_url.replace('/api/teams/', `/api/live/${code}/teams/`),
});

/** The state as a viewer holding `code` receives it: logo addresses point at the viewer routes. */
export const viewerState = (state: MatchState, code: string): MatchState => ({
  ...state,
  match: { ...state.match, home: viewerLogo(state.match.home, code), away: viewerLogo(state.match.away, code) },
  batting_team: viewerLogo(state.batting_team, code),
  bowling_team: viewerLogo(state.bowling_team, code),
});

export const viewerScorecard = (card: Scorecard, code: string): Scorecard => ({
  ...card,
  match: { ...card.match, home: viewerLogo(card.match.home, code), away: viewerLogo(card.match.away, code) },
});
