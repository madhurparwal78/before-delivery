import { config } from './config.js';
import { now } from './clock.js';
import { one } from './db.js';
import { HttpError } from './errors.js';
import { type Ctx, sendHtml } from './http.js';
import { scorerContext, viewerContext } from './live.js';
import { buildScorecard, buildState, computeMatch } from './match.js';
import {
  careerPage,
  followPage,
  invitationPage,
  landingPage,
  matchPage,
  matchesPage,
  newMatchPage,
  newTeamPage,
  newTournamentPage,
  notFoundPage,
  playersPage,
  scorecardPage,
  scoringPage,
  signInPage,
  signInRequiredPage,
  signUpPage,
  teamPage,
  teamsPage,
  tournamentPage,
  tournamentsPage,
  viewerPage,
} from './pages.js';
import { buildCareer, buildTournamentView, teamHistory } from './stats.js';
import {
  type UserRow,
  isScorer,
  loadMatchInput,
  matchByCode,
  matchById,
  teamPlayers,
  visibleMatches,
  visiblePlayer,
  visiblePlayers,
  visibleTeam,
  visibleTeams,
  visibleTournament,
  visibleTournaments,
} from './store.js';

export async function handlePage(ctx: Ctx, segments: string[], user: UserRow | null): Promise<boolean> {
  const signedIn = user !== null;
  const notFound = (): never => {
    sendHtml(ctx.res, 404, notFoundPage(signedIn));
    throw new PageHandled();
  };
  const requireUser = (): UserRow => {
    if (!user) {
      sendHtml(ctx.res, 401, signInRequiredPage());
      throw new PageHandled();
    }
    return user;
  };

  try {
    if (segments.length === 0) {
      sendHtml(ctx.res, 200, landingPage(signedIn));
      return true;
    }
    if (segments[0] === 'signup' && segments.length === 1) {
      sendHtml(ctx.res, 200, signUpPage());
      return true;
    }
    if (segments[0] === 'signin' && segments.length === 1) {
      sendHtml(ctx.res, 200, signInPage());
      return true;
    }
    if (segments[0] === 'follow' && segments.length === 1) {
      sendHtml(ctx.res, 200, followPage(signedIn));
      return true;
    }

    if (segments[0] === 'matches') {
      const owner = requireUser();
      if (segments.length === 1) {
        const rows = await visibleMatches(owner.id);
        const matches = [];
        for (const row of rows) {
          const input = await loadMatchInput(row);
          const computed = computeMatch(input);
          matches.push({
            id: row.id,
            title: `${input.home.name} v ${input.away.name}`,
            status: computed.status,
            result: computed.result,
            played_on: input.played_on,
          });
        }
        sendHtml(ctx.res, 200, matchesPage(matches));
        return true;
      }
      if (segments.length === 2 && segments[1] === 'new') {
        const teams = await visibleTeams(owner.id);
        const withPlayers = [];
        for (const team of teams) {
          withPlayers.push({
            id: team.id,
            name: team.name,
            players: (await teamPlayers(team.id)).map((player) => ({
              id: player.id,
              name: player.name,
            })),
          });
        }
        const tournaments = await visibleTournaments(owner.id);
        sendHtml(
          ctx.res,
          200,
          newMatchPage(
            withPlayers,
            tournaments.map((tournament) => ({ id: tournament.id, name: tournament.name })),
          ),
        );
        return true;
      }
      const row = await matchById(segments[1]);
      if (!row) notFound();
      const match = row!;
      if (segments.length === 2) {
        if (match.organiser_id !== owner.id) notFound();
        const input = await loadMatchInput(match);
        sendHtml(
          ctx.res,
          200,
          matchPage({
            id: match.id,
            title: `${input.home.name} v ${input.away.name}`,
            viewer_link: match.viewer_link,
            viewer_code: match.viewer_link ? match.viewer_code : null,
            base_url: config.appBaseUrl,
          }),
        );
        return true;
      }
      if (!(await isScorer(match.id, owner.id))) notFound();
      const input = await loadMatchInput(match);
      const computed = computeMatch(input);
      if (segments.length === 3 && segments[2] === 'score') {
        const title = `${input.home.name} v ${input.away.name}`;
        sendHtml(
          ctx.res,
          200,
          scoringPage({
            title,
            matchId: match.id,
            bootstrap: {
              match_id: match.id,
              state: {
                ...buildState(computed, scorerContext(input)),
                viewer_link: input.viewer_link,
                viewer_code: input.viewer_link ? input.viewer_code : null,
              },
              teams: [input.home, input.away].map((team) => ({
                id: team.id,
                name: team.name,
                logo_url: input.has_logo.has(team.id) ? `/api/teams/${team.id}/logo` : null,
                players: input.xi.get(team.id) ?? [],
              })),
            },
          }),
        );
        return true;
      }
      if (segments.length === 3 && segments[2] === 'scorecard') {
        sendHtml(
          ctx.res,
          200,
          scorecardPage({
            card: buildScorecard(computed, scorerContext(input)),
            signedIn: true,
            backLink: `/matches/${match.id}/score`,
          }),
        );
        return true;
      }
      notFound();
    }

    if (segments[0] === 'live') {
      const code = segments[1] ?? '';
      const match = await matchByCode(code);
      if (!match || !match.viewer_link) notFound();
      const input = await loadMatchInput(match!);
      const computed = computeMatch(input);
      const title = `${input.home.name} v ${input.away.name}`;
      if (segments.length === 2) {
        sendHtml(
          ctx.res,
          200,
          viewerPage({
            title,
            code,
            bootstrap: { code, state: buildState(computed, viewerContext(input)) },
          }),
        );
        return true;
      }
      if (segments.length === 3 && segments[2] === 'scorecard') {
        sendHtml(
          ctx.res,
          200,
          scorecardPage({
            card: buildScorecard(computed, viewerContext(input)),
            signedIn,
            backLink: `/live/${code}`,
          }),
        );
        return true;
      }
      notFound();
    }

    if (segments[0] === 'teams') {
      const owner = requireUser();
      if (segments.length === 1) {
        const teams = await visibleTeams(owner.id);
        sendHtml(ctx.res, 200, teamsPage(teams.map((team) => ({ id: team.id, name: team.name }))));
        return true;
      }
      if (segments.length === 2 && segments[1] === 'new') {
        sendHtml(ctx.res, 200, newTeamPage());
        return true;
      }
      if (segments.length === 2) {
        const team = await visibleTeam(owner.id, segments[1]);
        if (!team) notFound();
        sendHtml(
          ctx.res,
          200,
          teamPage({
            team: {
              id: team!.id,
              name: team!.name,
              logo_url: team!.logo_key ? `/api/teams/${team!.id}/logo` : null,
            },
            players: (await teamPlayers(team!.id)).map((player) => ({
              id: player.id,
              name: player.name,
              short_name: player.short_name,
            })),
            matches: await teamHistory(team!.id),
            organiser: team!.organiser_id === owner.id,
          }),
        );
        return true;
      }
      notFound();
    }

    if (segments[0] === 'tournaments') {
      const owner = requireUser();
      if (segments.length === 1) {
        const tournaments = await visibleTournaments(owner.id);
        sendHtml(
          ctx.res,
          200,
          tournamentsPage(tournaments.map((tournament) => ({ id: tournament.id, name: tournament.name }))),
        );
        return true;
      }
      if (segments.length === 2 && segments[1] === 'new') {
        const teams = await visibleTeams(owner.id);
        sendHtml(
          ctx.res,
          200,
          newTournamentPage(teams.map((team) => ({ id: team.id, name: team.name }))),
        );
        return true;
      }
      if (segments.length === 2) {
        const tournament = await visibleTournament(owner.id, segments[1]);
        if (!tournament) notFound();
        sendHtml(ctx.res, 200, tournamentPage(await buildTournamentView(tournament!)));
        return true;
      }
      notFound();
    }

    if (segments[0] === 'players') {
      const owner = requireUser();
      if (segments.length === 1) {
        const players = await visiblePlayers(owner.id);
        sendHtml(
          ctx.res,
          200,
          playersPage(
            players.map((player) => ({
              id: player.id,
              name: player.name,
              short_name: player.short_name,
              team: player.team_name,
            })),
          ),
        );
        return true;
      }
      if (segments.length === 2) {
        const player = await visiblePlayer(owner.id, segments[1]);
        if (!player) notFound();
        sendHtml(ctx.res, 200, careerPage(await buildCareer(player!)));
        return true;
      }
      notFound();
    }

    if (segments[0] === 'invitations' && segments.length === 2) {
      requireUser();
      const token = segments[1];
      const invitation = await one<{ match_id: string; sent_at: string; accepted_at: string | null }>(
        'select match_id, sent_at, accepted_at from invitations where token = $1',
        [token],
      );
      if (!invitation) notFound();
      const match = await matchById(invitation!.match_id);
      if (!match) notFound();
      const input = await loadMatchInput(match!);
      const expired =
        now().getTime() - new Date(invitation!.sent_at).getTime() >= config.inviteTtlHours * 3600_000;
      sendHtml(
        ctx.res,
        200,
        invitationPage({
          token,
          title: `${input.home.name} v ${input.away.name}`,
          status: invitation!.accepted_at ? 'used' : expired ? 'expired' : 'open',
        }),
      );
      return true;
    }

    notFound();
    return true;
  } catch (error) {
    if (error instanceof PageHandled) return true;
    if (error instanceof HttpError && error.status === 404) {
      sendHtml(ctx.res, 404, notFoundPage(signedIn));
      return true;
    }
    throw error;
  }
}

class PageHandled extends Error {}
