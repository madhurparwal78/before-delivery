import type { LiveEventKind } from '../shared/types.js';
import { type MatchInput, type ViewContext, buildState, computeMatch } from './match.js';
import { buildTournamentView } from './stats.js';
import { loadMatchInput, matchById, tournamentById } from './store.js';
import { publish } from './valkey.js';

export function viewerContext(input: MatchInput): ViewContext {
  return {
    logoUrl: (teamId) =>
      input.has_logo.has(teamId) && input.viewer_link
        ? `/api/live/${input.viewer_code}/teams/${teamId}/logo`
        : null,
  };
}

export function scorerContext(input: MatchInput): ViewContext {
  return {
    logoUrl: (teamId) => (input.has_logo.has(teamId) ? `/api/teams/${teamId}/logo` : null),
  };
}

export async function publishMatchState(
  matchId: string,
  event: { kind: LiveEventKind; seq: number },
): Promise<void> {
  const row = await matchById(matchId);
  if (!row) return;
  const input = await loadMatchInput(row);
  const computed = computeMatch(input);
  const state = buildState(computed, viewerContext(input));
  await publish(`match:${matchId}`, JSON.stringify({ type: 'state', event, state }));
  if (row.tournament_id) await publishTournamentTable(row.tournament_id);
}

export async function publishTournamentTable(tournamentId: string): Promise<void> {
  const tournament = await tournamentById(tournamentId);
  if (!tournament) return;
  const view = await buildTournamentView(tournament);
  await publish(
    `tournament:${tournamentId}`,
    JSON.stringify({ type: 'table', tournament: tournamentId, groups: view.groups }),
  );
}

export async function publishLinkOff(matchId: string): Promise<void> {
  await publish(`match:${matchId}`, JSON.stringify({ type: 'link-off' }));
}
