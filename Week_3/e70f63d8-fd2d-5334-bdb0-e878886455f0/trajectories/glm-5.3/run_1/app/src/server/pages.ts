import type { AppDeps } from "./api.js";
import {
  asString,
  err,
  type Ctx,
} from "./http.js";
import { computeMatch, loadMatch } from "./match.js";
import { buildScorecard } from "./scorecard.js";
import { buildState } from "./state.js";
import * as apiMod from "./api.js";
import * as html from "./pages-html.js";

export const htmlEscape = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Server-rendered pages: one main landmark, one h1, the Main nav on every page.


export const pageRoute = async (deps: AppDeps, ctx: Ctx): Promise<void> => {
  const path = ctx.path;
  const send = (html: string, status = 200): void => {
    const payload = Buffer.from(html, "utf8");
    ctx.res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Content-Length": payload.length });
    ctx.res.end(payload);
  };
  const notFound = (): void => send(html.notFoundPage(), 404);
  const user = ctx.session;

  const resolve = async (check: Promise<boolean>): Promise<boolean> => await check;

  if (path === "/") {
    send(html.landingPage(user !== null));
    return;
  }
  if (path === "/signup") {
    send(html.signUpPage());
    return;
  }
  if (path === "/signin") {
    send(html.signInPage());
    return;
  }
  if (path === "/follow") {
    send(html.followPage(user !== null));
    return;
  }

  // Viewer pages need no account.
  const livePath = /^\/live\/([^/]+)$/.exec(path);
  if (livePath) {
    const code = decodeURIComponent(livePath[1]);
    const rows = await deps.db.query<{ id: string }>(`SELECT id FROM matches WHERE viewer_code = $1 AND viewer_link = true`, [code]);
    if (rows.length === 0) return notFound();
    const loaded = await loadMatch(deps.db, rows[0].id);
    if (!loaded) return notFound();
    const computed = computeMatch(loaded);
    const state = buildState(loaded, computed);
    send(html.viewerPage(state, code));
    return;
  }
  const liveCardPath = /^\/live\/([^/]+)\/scorecard$/.exec(path);
  if (liveCardPath) {
    const code = decodeURIComponent(liveCardPath[1]);
    const rows = await deps.db.query<{ id: string }>(`SELECT id FROM matches WHERE viewer_code = $1 AND viewer_link = true`, [code]);
    if (rows.length === 0) return notFound();
    const loaded = await loadMatch(deps.db, rows[0].id);
    if (!loaded) return notFound();
    const computed = computeMatch(loaded);
    const card = buildScorecard(loaded, computed);
    send(html.scorecardPage(card, `/live/${code}`));
    return;
  }

  // Everything else needs an account. A page this user cannot open answers 404
  // with the not-found copy, whether signed out or another organiser's record.
  if (user === null) {
    send(html.notFoundPage(), 404);
    return;
  }

  if (path === "/matches") {
    const rows = await deps.db.query<{ id: string; title: string; status: string; result: string | null }>(
      `SELECT m.id, h.name || ' v ' || a.name AS title, m.status, m.result
       FROM matches m JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
       WHERE m.organiser_id = $1 OR EXISTS (SELECT 1 FROM match_scorers ms WHERE ms.match_id = m.id AND ms.user_id = $1)
       ORDER BY m.created_at DESC`,
      [user.id],
    );
    send(html.matchesPage(rows));
    return;
  }
  if (path === "/matches/new") {
    const teams = await deps.db.query<{ id: string; name: string }>(
      `SELECT id, name FROM teams WHERE organiser_id = $1 ORDER BY created_at`,
      [user.id],
    );
    const tournaments = await deps.db.query<{ id: string; name: string }>(
      `SELECT id, name FROM tournaments WHERE organiser_id = $1 ORDER BY created_at`,
      [user.id],
    );
    send(html.newMatchPage(teams, tournaments));
    return;
  }

  const matchPath = /^\/matches\/([^/]+)$/.exec(path);
  if (matchPath) {
    const id = decodeURIComponent(matchPath[1]);
    const loaded = await loadMatch(deps.db, id);
    if (!loaded) return notFound();
    const organiser = loaded.match.organiser_id === user.id;
    const scorer = await deps.db.query(`SELECT 1 FROM match_scorers WHERE match_id = $1 AND user_id = $2`, [id, user.id]);
    if (!organiser && scorer.length === 0) return notFound();
    if (!organiser) return notFound();
    const scorers = await deps.db.query<{ display_name: string }>(
      `SELECT u.display_name FROM match_scorers s JOIN users u ON u.id = s.user_id WHERE s.match_id = $1`,
      [id],
    );
    send(html.matchPage(loaded, scorers.map((s) => s.display_name)));
    return;
  }

  const scorePath = /^\/matches\/([^/]+)\/score$/.exec(path);
  if (scorePath) {
    const id = decodeURIComponent(scorePath[1]);
    const loaded = await loadMatch(deps.db, id);
    if (!loaded) return notFound();
    const organiser = loaded.match.organiser_id === user.id;
    const scorer = await deps.db.query(`SELECT 1 FROM match_scorers WHERE match_id = $1 AND user_id = $2`, [id, user.id]);
    if (!organiser && scorer.length === 0) return notFound();
    const computed = computeMatch(loaded);
    const state = buildState(loaded, computed);
    send(html.scoringPage(state, id));
    return;
  }

  const scorecardPath = /^\/matches\/([^/]+)\/scorecard$/.exec(path);
  if (scorecardPath) {
    const id = decodeURIComponent(scorecardPath[1]);
    const loaded = await loadMatch(deps.db, id);
    if (!loaded) return notFound();
    const organiser = loaded.match.organiser_id === user.id;
    const scorer = await deps.db.query(`SELECT 1 FROM match_scorers WHERE match_id = $1 AND user_id = $2`, [id, user.id]);
    if (!organiser && scorer.length === 0) return notFound();
    const computed = computeMatch(loaded);
    const card = buildScorecard(loaded, computed);
    send(html.scorecardPage(card));
    return;
  }

  if (path === "/teams") {
    const rows = await deps.db.query<{ id: string; name: string }>(
      `SELECT id, name FROM teams WHERE organiser_id = $1 ORDER BY created_at`,
      [user.id],
    );
    send(html.teamsPage(rows));
    return;
  }
  if (path === "/teams/new") {
    send(html.newTeamPage());
    return;
  }
  const teamPath = /^\/teams\/([^/]+)$/.exec(path);
  if (teamPath) {
    const id = decodeURIComponent(teamPath[1]);
    const team = await deps.db.query<{ organiser_id: string }>(`SELECT organiser_id FROM teams WHERE id = $1`, [id]);
    if (team.length === 0) return notFound();
    const allowed = await resolve(canSeeTeam(deps, user.id, id));
    if (!allowed) return notFound();
    const detail = (await apiMod.teamJson(deps, id)) as {
      id: string;
      name: string;
      logo_url: string | null;
      players: { id: string; name: string; short_name: string }[];
      matches: { id: string; line: string; scorecard_url: string | null }[];
    };
    const isOrganiser = team[0].organiser_id === user.id;
    send(html.teamPage(detail, isOrganiser));
    return;
  }

  if (path === "/tournaments") {
    const rows = await deps.db.query<{ id: string; name: string }>(
      `SELECT id, name FROM tournaments WHERE organiser_id = $1 ORDER BY created_at`,
      [user.id],
    );
    send(html.tournamentsPage(rows));
    return;
  }
  if (path === "/tournaments/new") {
    const teams = await deps.db.query<{ id: string; name: string }>(
      `SELECT id, name FROM teams WHERE organiser_id = $1 ORDER BY created_at`,
      [user.id],
    );
    send(html.newTournamentPage(teams));
    return;
  }
  const tournamentPath = /^\/tournaments\/([^/]+)$/.exec(path);
  if (tournamentPath) {
    const id = decodeURIComponent(tournamentPath[1]);
    const t = await deps.db.query<{ organiser_id: string }>(`SELECT organiser_id FROM tournaments WHERE id = $1`, [id]);
    if (t.length === 0) return notFound();
    const allowed = await canSeeTournament(deps, user.id, id);
    if (!allowed) return notFound();
    const json = (await apiMod.tournamentJson(deps, id)) as {
      id: string;
      name: string;
      groups: {
        name: string;
        table: { team: { id: string; name: string }; p: number; w: number; l: number; t: number; pts: number; nrr: string }[];
        matches: { id: string; home: string; away: string; status: string; result: string | null }[];
      }[];
    };
    send(html.tournamentPage(json, id));
    return;
  }

  if (path === "/players") {
    const rows = await deps.db.query<{ id: string; name: string; short_name: string; team_id: string; team_name: string }>(
      `SELECT p.id, p.name, p.short_name, p.team_id, t.name AS team_name
       FROM players p JOIN teams t ON t.id = p.team_id
       WHERE t.organiser_id = $1
          OR EXISTS (SELECT 1 FROM match_scorers ms JOIN matches m ON m.id = ms.match_id WHERE ms.user_id = $1 AND (m.home_team_id = p.team_id OR m.away_team_id = p.team_id))
       ORDER BY t.name, p.batting_order`,
      [user.id],
    );
    send(html.playersPage(rows));
    return;
  }

  const playerPath = /^\/players\/([^/]+)$/.exec(path);
  if (playerPath) {
    const id = decodeURIComponent(playerPath[1]);
    try {
      const career = await careersPageData(deps, id, user.id);
      send(html.careerPage(career));
    } catch {
      return notFound();
    }
    return;
  }

  const invitePath = /^\/invitations\/([^/]+)$/.exec(path);
  if (invitePath) {
    const token = decodeURIComponent(invitePath[1]);
    const rows = await deps.db.query<{ match_id: string; sent_at: Date; accepted_at: Date | null }>(
      `SELECT match_id, sent_at, accepted_at FROM invitations WHERE token = $1`,
      [token],
    );
    if (rows.length === 0) return notFound();
    const titleRows = await deps.db.query<{ title: string }>(
      `SELECT h.name || ' v ' || a.name AS title FROM matches m JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id WHERE m.id = $1`,
      [rows[0].match_id],
    );
    send(html.invitationPage(titleRows[0].title, token));
    return;
  }

  notFound();
};

const canSeeTeam = async (deps: AppDeps, userId: string, teamId: string): Promise<boolean> => {
  const owned = await deps.db.query(`SELECT 1 FROM teams WHERE id = $1 AND organiser_id = $2`, [teamId, userId]);
  if (owned.length > 0) return true;
  const scorer = await deps.db.query(
    `SELECT 1 FROM match_scorers ms JOIN matches m ON m.id = ms.match_id WHERE ms.user_id = $1 AND (m.home_team_id = $2 OR m.away_team_id = $2)`,
    [userId, teamId],
  );
  return scorer.length > 0;
};

const canSeeTournament = async (deps: AppDeps, userId: string, tournamentId: string): Promise<boolean> => {
  const owned = await deps.db.query(`SELECT 1 FROM tournaments WHERE id = $1 AND organiser_id = $2`, [tournamentId, userId]);
  if (owned.length > 0) return true;
  const scorer = await deps.db.query(
    `SELECT 1 FROM match_scorers ms JOIN matches m ON m.id = ms.match_id WHERE ms.user_id = $1 AND m.tournament_id = $2`,
    [userId, tournamentId],
  );
  return scorer.length > 0;
};

const careersPageData = async (deps: AppDeps, playerId: string, viewerId: string): Promise<Record<string, unknown>> => {
  const { careersJson } = await import("./careers.js");
  return (await careersJson(deps, playerId, viewerId)) as Record<string, unknown>;
};

void asString;
void err;
