import type { Db } from "./db.js";
import {
  asBool,
  asNumber,
  asRecord,
  asString,
  err,
  playedOnOf,
  type Ctx,
  type SessionUser,
} from "./http.js";
import { copy } from "./copy.js";
import { newPasswordHash, newId, newSessionToken, passwordMatches } from "./ids.js";
import type { Services } from "./services.js";
import { now } from "./clock.js";
import { config } from "./config.js";

// Field validation collects per-field messages under one VALIDATION error.

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validationError = (fields: Record<string, string>): ApiErrorShape =>
  err(422, "VALIDATION", copy.fieldErrorsSummary, { fields });

type ApiErrorShape = ReturnType<typeof err>;

export interface AppDeps {
  db: Db;
  services: Services;
}

// ---------- accounts ----------

export const signUp = async (deps: AppDeps, ctx: Ctx): Promise<unknown> => {
  const body = asRecord(ctx.body);
  const email = asString(body.email)?.trim().toLowerCase() ?? "";
  const password = asString(body.password) ?? "";
  const displayName = asString(body.display_name)?.trim() ?? "";

  const fields: Record<string, string> = {};
  if (!emailPattern.test(email)) fields.email = copy.invalidEmail;
  if (password.length < 10) fields.password = copy.passwordTooShort;
  if (displayName.length === 0) fields.display_name = copy.nameRequired;
  if (Object.keys(fields).length > 0) throw validationError(fields);

  const existing = await deps.db.query(`SELECT id FROM users WHERE lower(email) = $1`, [email]);
  if (existing.length > 0) throw validationError({ email: copy.emailTaken });

  const id = newId();
  await deps.db.query(
    `INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)`,
    [id, email, newPasswordHash(password), displayName],
  );
  const token = newSessionToken();
  await deps.db.query(`INSERT INTO sessions (token, user_id) VALUES ($1, $2)`, [token, id]);
  const user = await sessionOf(deps, token);
  ctx.session = user;
  ctx.sessionToken = token;
  return { user: { id, email, display_name: displayName }, session: token };
};

export const signIn = async (deps: AppDeps, ctx: Ctx): Promise<unknown> => {
  const body = asRecord(ctx.body);
  const email = asString(body.email)?.trim().toLowerCase() ?? "";
  const password = asString(body.password) ?? "";
  const rows = await deps.db.query<{ id: string; email: string; display_name: string; password_hash: string }>(
    `SELECT id, email, display_name, password_hash FROM users WHERE lower(email) = $1`,
    [email],
  );
  // Same work and same answer for unknown email and wrong password.
  const hash = rows.length > 0 ? rows[0].password_hash : newPasswordHash("placeholder-password");
  const ok = passwordMatches(password, hash);
  if (rows.length === 0 || !ok) throw err(401, "SIGN_IN_FAILED", copy.signInFailed);
  const token = newSessionToken();
  await deps.db.query(`INSERT INTO sessions (token, user_id) VALUES ($1, $2)`, [token, rows[0].id]);
  const user = await sessionOf(deps, token);
  ctx.session = user;
  ctx.sessionToken = token;
  return { user: { id: rows[0].id, email: rows[0].email, display_name: rows[0].display_name } };
};

export const sessionOf = async (deps: AppDeps, token: string | undefined): Promise<SessionUser | null> => {
  if (!token) return null;
  const rows = await deps.db.query<{ id: string; email: string; display_name: string }>(
    `SELECT u.id, u.email, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
    [token],
  );
  if (rows.length === 0) return null;
  return { id: rows[0].id, email: rows[0].email, display_name: rows[0].display_name };
};

// ---------- teams ----------

export const lastWord = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
};

export const createTeam = async (deps: AppDeps, ctx: Ctx): Promise<unknown> => {
  const body = asRecord(ctx.body);
  const name = asString(body.name)?.trim() ?? "";
  const playersRaw = Array.isArray(body.players) ? body.players : [];
  const fields: Record<string, string> = {};
  if (name.length === 0) fields.name = copy.nameRequired;
  const players: { name: string; short_name: string }[] = [];
  playersRaw.forEach((p, i) => {
    const rec = asRecord(p);
    const pname = asString(rec.name)?.trim() ?? "";
    const shortRaw = asString(rec.short_name)?.trim() ?? "";
    if (pname.length === 0) {
      fields[`players[${i}].name`] = copy.nameRequired;
      return;
    }
    const short = shortRaw.length > 0 ? shortRaw : lastWord(pname);
    players.push({ name: pname, short_name: short });
  });
  const shorts = players.map((p) => p.short_name);
  if (new Set(shorts).size !== shorts.length) {
    const firstClash = shorts.find((s, i) => shorts.indexOf(s) !== i);
    const idx = shorts.findIndex((s, i) => s === firstClash && shorts.indexOf(s) !== i);
    fields[`players[${idx}].short_name`] = copy.shortNameClash;
  }
  if (Object.keys(fields).length > 0) throw validationError(fields);

  const teamId = newId();
  await deps.db.withTransaction(async (client) => {
    await client.query(`INSERT INTO teams (id, organiser_id, name) VALUES ($1, $2, $3)`, [teamId, ctx.session!.id, name]);
    for (let i = 0; i < players.length; i++) {
      await client.query(
        `INSERT INTO players (id, team_id, name, short_name, batting_order) VALUES ($1, $2, $3, $4, $5)`,
        [newId(), teamId, players[i].name, players[i].short_name, i],
      );
    }
  });
  return teamJson(deps, teamId);
};

export const teamJson = async (deps: AppDeps, teamId: string): Promise<unknown> => {
  const rows = await deps.db.query<{ id: string; name: string; logo_key: string | null }>(
    `SELECT id, name, logo_key FROM teams WHERE id = $1`,
    [teamId],
  );
  const players = await deps.db.query<{ id: string; name: string; short_name: string }>(
    `SELECT id, name, short_name FROM players WHERE team_id = $1 ORDER BY batting_order`,
    [teamId],
  );
  const matches = await finishedTeamMatches(deps, teamId);
  return {
    id: rows[0].id,
    name: rows[0].name,
    logo_url: rows[0].logo_key ? `/api/teams/${teamId}/logo` : null,
    players,
    matches,
  };
};

export const finishedTeamMatches = async (deps: AppDeps, teamId: string): Promise<{ id: string; line: string; scorecard_url: string | null }[]> => {
  const rows = await deps.db.query<{
    id: string;
    home_name: string;
    away_name: string;
    result: string | null;
    played_on: string | null;
    first_delivery: string | null;
    has_log: boolean;
  }>(
    `SELECT m.id,
            h.name AS home_name, a.name AS away_name,
            m.result, m.played_on,
            (SELECT min(created_at)::text FROM deliveries d WHERE d.match_id = m.id) AS first_delivery,
            EXISTS (SELECT 1 FROM deliveries d WHERE d.match_id = m.id) AS has_log
     FROM matches m JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
     WHERE (m.home_team_id = $1 OR m.away_team_id = $1)
       AND m.result IS NOT NULL
     ORDER BY m.played_on DESC NULLS LAST, m.created_at DESC`,
    [teamId],
  );
  return rows.map((r) => {
    const date = r.played_on
      ? formatDate(r.played_on)
      : r.first_delivery
        ? playedOnOf(r.first_delivery)
        : todayDate();
    return {
      id: r.id,
      line: `${r.home_name} v ${r.away_name}, ${date}: ${r.result}`,
      scorecard_url: r.has_log ? `/matches/${r.id}/scorecard` : null,
    };
  });
};

const formatDate = (ymd: string): string => {
  const [y, m, d] = ymd.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${y}`;
};

const todayDate = (): string => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: config.appTz,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(now());
  return parts;
};

export const addPlayer = async (deps: AppDeps, ctx: Ctx): Promise<unknown> => {
  const teamId = ctx.params.id;
  const team = await deps.db.query<{ organiser_id: string }>(`SELECT organiser_id FROM teams WHERE id = $1`, [teamId]);
  if (team.length === 0 || team[0].organiser_id !== ctx.session!.id) throw err(404, "NOT_FOUND", copy.notFound);
  const body = asRecord(ctx.body);
  const name = asString(body.name)?.trim() ?? "";
  const short = asString(body.short_name)?.trim() || (name ? lastWord(name) : "");
  const fields: Record<string, string> = {};
  if (name.length === 0) fields.name = copy.nameRequired;
  const clash = await deps.db.query(`SELECT 1 FROM players WHERE team_id = $1 AND short_name = $2`, [teamId, short]);
  if (clash.length > 0) fields.short_name = copy.shortNameClash;
  if (Object.keys(fields).length > 0) throw validationError(fields);
  const id = newId();
  const order = await deps.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM players WHERE team_id = $1`, [teamId]);
  await deps.db.query(
    `INSERT INTO players (id, team_id, name, short_name, batting_order) VALUES ($1, $2, $3, $4, $5)`,
    [id, teamId, name, short, order[0].n],
  );
  return { id, name, short_name: short };
};

// ---------- tournaments ----------

export const createTournament = async (deps: AppDeps, ctx: Ctx): Promise<unknown> => {
  const body = asRecord(ctx.body);
  const name = asString(body.name)?.trim() ?? "";
  const overs = asNumber(body.overs);
  const playersPerSide = asNumber(body.players_per_side);
  const superOver = asBool(body.super_over) ?? false;
  const groupsRaw = Array.isArray(body.groups) ? body.groups : [];

  const fields: Record<string, string> = {};
  if (name.length === 0) fields.name = copy.nameRequired;
  if (overs === null || !Number.isInteger(overs) || overs < 1 || overs > 50) fields.overs = copy.oversField;
  if (playersPerSide === null || !Number.isInteger(playersPerSide) || playersPerSide < 2 || playersPerSide > 11)
    fields.players_per_side = copy.playersPerSideField;

  const groups: { name: string; teams: string[] }[] = [];
  const seenTeams = new Set<string>();
  groupsRaw.forEach((g, i) => {
    const rec = asRecord(g);
    const gname = asString(rec.name)?.trim() ?? "";
    const teamsRaw = Array.isArray(rec.teams) ? rec.teams : [];
    const teams = teamsRaw.map((t) => asString(t) ?? "");
    if (gname.length === 0) fields[`groups[${i}].name`] = copy.nameRequired;
    for (const t of teams) {
      if (seenTeams.has(t)) fields.tournament = copy.shortNameClash;
      seenTeams.add(t);
    }
    groups.push({ name: gname, teams });
  });

  for (const g of groups) {
    for (const t of g.teams) {
      if (t === "") continue;
      const owned = await deps.db.query(`SELECT 1 FROM teams WHERE id = $1 AND organiser_id = $2`, [t, ctx.session!.id]);
      if (owned.length === 0) throw err(404, "NOT_FOUND", copy.notFound);
    }
  }
  if (Object.keys(fields).length > 0) throw validationError(fields);

  const id = newId();
  await deps.db.withTransaction(async (client) => {
    await client.query(
      `INSERT INTO tournaments (id, organiser_id, name, overs, players_per_side, super_over) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, ctx.session!.id, name, overs!, playersPerSide!, superOver],
    );
    for (const g of groups) {
      const gid = newId();
      await client.query(`INSERT INTO tournament_groups (id, tournament_id, name) VALUES ($1, $2, $3)`, [gid, id, g.name]);
      for (const t of g.teams) {
        await client.query(`INSERT INTO tournament_group_teams (group_id, team_id) VALUES ($1, $2)`, [gid, t]);
      }
    }
  });
  return tournamentJson(deps, id);
};

export const tournamentJson = async (deps: AppDeps, tournamentId: string): Promise<unknown> => {
  const rows = await deps.db.query<{
    id: string;
    name: string;
    overs: number;
    players_per_side: number;
    super_over: boolean;
  }>(`SELECT id, name, overs, players_per_side, super_over FROM tournaments WHERE id = $1`, [tournamentId]);
  const groups = await deps.db.query<{ id: string; name: string }>(
    `SELECT id, name FROM tournament_groups WHERE tournament_id = $1 ORDER BY name`,
    [tournamentId],
  );
  const groupJson = await Promise.all(
    groups.map(async (g) => ({
      name: g.name,
      table: await groupTable(deps, tournamentId, g.id),
      matches: await groupMatches(deps, tournamentId, g.id),
    })),
  );
  return {
    id: rows[0].id,
    name: rows[0].name,
    overs: rows[0].overs,
    players_per_side: rows[0].players_per_side,
    super_over: rows[0].super_over,
    groups: groupJson,
  };
};

export const groupTable = async (
  deps: AppDeps,
  tournamentId: string,
  groupId: string,
): Promise<{ team: { id: string; name: string }; p: number; w: number; l: number; t: number; pts: number; nrr: string }[]> => {
  const teams = await deps.db.query<{ id: string; name: string }>(
    `SELECT t.id, t.name FROM tournament_group_teams g JOIN teams t ON t.id = g.team_id WHERE g.group_id = $1 ORDER BY t.name`,
    [groupId],
  );
  const matches = await finishedTournamentMatches(deps, tournamentId, groupId);
  const rows = teams.map((team) => {
    let p = 0;
    let w = 0;
    let l = 0;
    let t = 0;
    let runsFor = 0;
    let ballsFor = 0;
    let runsAgainst = 0;
    let ballsAgainst = 0;
    for (const m of matches) {
      const isHome = m.home_id === team.id;
      const isAway = m.away_id === team.id;
      if (!isHome && !isAway) continue;
      p += 1;
      if (m.winner === team.id) w += 1;
      else if (m.winner === null) t += 1;
      else l += 1;
      const own = isHome ? m.home_summary : m.away_summary;
      const other = isHome ? m.away_summary : m.home_summary;
      if (own) {
        runsFor += own.runs;
        ballsFor += own.ballsFaced;
      }
      if (other) {
        // Runs conceded come with the balls the other side faced while batting.
        runsAgainst += other.runs;
        ballsAgainst += other.ballsFaced;
      }
    }
    const nrr =
      p === 0
        ? 0
        : runsFor / (ballsFor / 6) - runsAgainst / (ballsAgainst / 6);
    return { team, p, w, l, t, pts: w * 2 + t, nrr, nrrRaw: nrr, wCount: w };
  });
  rows.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.wCount !== a.wCount) return b.wCount - a.wCount;
    if (b.nrrRaw !== a.nrrRaw) return b.nrrRaw - a.nrrRaw;
    // head-to-head when exactly two teams are level
    if (rows.length === 2) {
      const h2h = matches.find(
        (m) => (m.home_id === a.team.id && m.away_id === b.team.id) || (m.home_id === b.team.id && m.away_id === a.team.id),
      );
      if (h2h && h2h.winner) {
        if (h2h.winner === a.team.id) return -1;
        if (h2h.winner === b.team.id) return 1;
      }
    }
    return a.team.name.localeCompare(b.team.name);
  });
  const rate3 = (v: number): string => {
    const factor = 1000;
    const scaled = Math.abs(v) * factor;
    const rounded = Math.floor(scaled + 0.5) / factor;
    const r = v < 0 ? -rounded : rounded;
    return `${r > 0 ? "+" : r < 0 ? "-" : ""}${Math.abs(r).toFixed(3)}`;
  };
  return rows.map((r) => ({ team: r.team, p: r.p, w: r.w, l: r.l, t: r.t, pts: r.pts, nrr: rate3(r.nrr) }));
};

export interface FinishedTournamentMatch {
  id: string;
  home_id: string;
  away_id: string;
  winner: string | null;
  home_summary: { runs: number; ballsFaced: number; ballsBowled: number } | null;
  away_summary: { runs: number; ballsFaced: number; ballsBowled: number } | null;
}

export const finishedTournamentMatches = async (
  deps: AppDeps,
  tournamentId: string,
  groupId: string,
): Promise<FinishedTournamentMatch[]> => {
  const rows = await deps.db.query<{
    id: string;
    home_id: string;
    away_id: string;
    result: string | null;
    summary_winner: string | null;
    summary_first_runs: number | null;
    summary_first_wickets: number | null;
    summary_first_balls: number | null;
    summary_first_all_out: boolean | null;
    summary_second_runs: number | null;
    summary_second_wickets: number | null;
    summary_second_balls: number | null;
    summary_second_all_out: boolean | null;
    overs: number;
    batting_first: string;
  }>(
    `SELECT m.id, m.home_team_id AS home_id, m.away_team_id AS away_id, m.result, m.summary_winner,
            m.summary_first_runs, m.summary_first_wickets, m.summary_first_balls, m.summary_first_all_out,
            m.summary_second_runs, m.summary_second_wickets, m.summary_second_balls, m.summary_second_all_out,
            m.overs, m.batting_first
     FROM matches m
     WHERE m.tournament_id = $1 AND m.result IS NOT NULL
       AND EXISTS (SELECT 1 FROM tournament_group_teams g WHERE g.group_id = $2 AND (g.team_id = m.home_team_id OR g.team_id = m.away_team_id))
     ORDER BY m.created_at`,
    [tournamentId, groupId],
  );
  const out: FinishedTournamentMatch[] = [];
  for (const r of rows) {
    const scored = await inningsRunsOf(deps, r.id);
    const battingFirst = r.batting_first;
    const summaryAvailable = r.summary_first_runs !== null;
    if (summaryAvailable) {
      const quotaBalls = r.overs * 6;
      const firstAllOut = r.summary_first_all_out ?? false;
      const secondAllOut = r.summary_second_all_out ?? false;
      const firstRuns = r.summary_first_runs!;
      const secondRuns = r.summary_second_runs!;
      const firstBalls = firstAllOut ? quotaBalls : r.summary_first_balls!;
      const secondBalls = secondAllOut ? quotaBalls : r.summary_second_balls!;
      const homeSummary =
        battingFirst === r.home_id
          ? { runs: firstRuns, ballsFaced: firstBalls, ballsBowled: secondBalls }
          : { runs: secondRuns, ballsFaced: secondBalls, ballsBowled: firstBalls };
      const awaySummary =
        battingFirst === r.home_id
          ? { runs: secondRuns, ballsFaced: secondBalls, ballsBowled: firstBalls }
          : { runs: firstRuns, ballsFaced: firstBalls, ballsBowled: secondBalls };
      out.push({
        id: r.id,
        home_id: r.home_id,
        away_id: r.away_id,
        winner: r.summary_winner,
        home_summary: homeSummary,
        away_summary: awaySummary,
      });
    } else if (scored.length === 2) {
      const quotaBalls = r.overs * 6;
      const firstInn = scored[0];
      const secondInn = scored[1];
      const firstBalls = firstInn.all_out ? quotaBalls : firstInn.legal_balls;
      const secondBalls = secondInn.all_out ? quotaBalls : secondInn.legal_balls;
      const homeSummary =
        battingFirst === r.home_id
          ? { runs: firstInn.runs, ballsFaced: firstBalls, ballsBowled: secondBalls }
          : { runs: secondInn.runs, ballsFaced: secondBalls, ballsBowled: firstBalls };
      const awaySummary =
        battingFirst === r.home_id
          ? { runs: secondInn.runs, ballsFaced: secondBalls, ballsBowled: firstBalls }
          : { runs: firstInn.runs, ballsFaced: firstBalls, ballsBowled: secondBalls };
      out.push({
        id: r.id,
        home_id: r.home_id,
        away_id: r.away_id,
        winner: winnerOfScored(scored),
        home_summary: homeSummary,
        away_summary: awaySummary,
      });
    }
  }
  return out;
};

export const inningsRunsOf = async (
  deps: AppDeps,
  matchId: string,
): Promise<{ runs: number; wickets: number; legal_balls: number; all_out: boolean; batting_team: string; bowling_team: string }[]> => {
  const { computeMatch, loadMatch } = await import("./match.js");
  const loaded = await loadMatch(deps.db, matchId);
  if (!loaded) return [];
  const computed = computeMatch(loaded);
  const list = computed.innings.filter((i: { super_over_number: number }) => i.super_over_number === 0);
  return list.map((inn: { id: string; batting_team_id: string; bowling_team_id: string }) => {
    const replay = computed.replays.get(inn.id)!;
    return {
      runs: replay.runs,
      wickets: replay.wickets,
      legal_balls: replay.legal_balls,
      all_out: replay.ended_reason === "all-out",
      batting_team: inn.batting_team_id,
      bowling_team: inn.bowling_team_id,
    };
  });
};

const winnerOfScored = (
  scored: { runs: number; batting_team: string }[],
): string | null => {
  if (scored.length < 2) return null;
  const first = scored[0];
  const second = scored[1];
  if (second.runs > first.runs) return second.batting_team;
  if (second.runs < first.runs) return first.batting_team;
  return null;
};

export const groupMatches = async (deps: AppDeps, tournamentId: string, groupId: string): Promise<{ id: string; home: string; away: string; status: string; result: string | null }[]> => {
  const rows = await deps.db.query<{ id: string; home_id: string; away_id: string; status: string; result: string | null }>(
    `SELECT m.id, m.home_team_id AS home_id, m.away_team_id AS away_id, m.status, m.result
     FROM matches m
     WHERE m.tournament_id = $1
       AND EXISTS (SELECT 1 FROM tournament_group_teams g WHERE g.group_id = $2 AND (g.team_id = m.home_team_id OR g.team_id = m.away_team_id))
     ORDER BY m.created_at`,
    [tournamentId, groupId],
  );
  return rows.map((r) => ({ id: r.id, home: r.home_id, away: r.away_id, status: r.status, result: r.result }));
};
