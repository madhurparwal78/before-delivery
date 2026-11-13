import { asRecord, asString, err, type Ctx } from "./http.js";
import { copy } from "./copy.js";
import { newId, newInviteToken, newSessionToken, newPasswordHash, newViewerCode } from "./ids.js";
import { computeMatch, loadMatch, type InningsRow } from "./match.js";
import { syncMatchResult } from "./scoring.js";
import { allowedWicketsOn, type Extra, type WicketKind } from "./laws.js";
import type { AppDeps } from "./api.js";
import type { Db } from "./db.js";

// Grading routes: with the key they build records exactly as if they had been played.

interface TeamRef {
  id: string;
  key: string;
  players: Map<string, string>;
}

const tokenOf = (part: string, where: string): { extra: Extra; runs: number } => {
  if (/^[0-6]$/.test(part)) return { extra: "none", runs: Number(part) };
  const runs = Number(part.slice(1));
  if (part.length < 2 || Number.isNaN(runs)) {
    throw err(422, "SEED_INVALID", `${where}: ${part} is not a delivery token`);
  }
  switch (part[0]) {
    case "D":
      return { extra: "wide", runs };
    case "N":
      return { extra: "no-ball", runs };
    case "B":
      return { extra: "bye", runs };
    case "L":
      return { extra: "leg-bye", runs };
    default:
      throw err(422, "SEED_INVALID", `${where}: ${part} is not a delivery token`);
  }
};

const WICKETS: WicketKind[] = ["bowled", "caught", "lbw", "stumped", "hit-wicket", "run-out"];

export const seedRoute = async (deps: AppDeps, ctx: Ctx): Promise<unknown> => {
  const body = asRecord(ctx.body);
  const users = Array.isArray(body.users) ? body.users : [];
  const teams = Array.isArray(body.teams) ? body.teams : [];
  const tournaments = Array.isArray(body.tournaments) ? body.tournaments : [];
  const matches = Array.isArray(body.matches) ? body.matches : [];
  const invitations = Array.isArray(body.invitations) ? body.invitations : [];

  const userByKey = new Map<string, { id: string; session: string }>();
  const teamByKey = new Map<string, TeamRef>();
  const tournamentByKey = new Map<string, { id: string }>();
  const matchByKey = new Map<string, { id: string; viewer_code: string }>();
  const invitationByKey = new Map<string, { token: string }>();

  const db = deps.db;

  for (const u of users) {
    const rec = asRecord(u);
    const key = asString(rec.key) ?? "";
    const email = (asString(rec.email) ?? "").trim().toLowerCase();
    const displayName = asString(rec.display_name) ?? "";
    const password = asString(rec.password) ?? "";
    if (!key || !email || !displayName || password.length < 10) {
      throw err(422, "SEED_INVALID", `user ${key || "?"}: incomplete`);
    }
    const hash = newPasswordHash(password);
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)
       ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING id`,
      [newId(), email, hash, displayName],
    );
    const userId = inserted[0].id;
    const token = newSessionToken();
    await db.query(`INSERT INTO sessions (token, user_id) VALUES ($1, $2)`, [token, userId]);
    userByKey.set(key, { id: userId, session: token });
  }

  for (const t of teams) {
    const rec = asRecord(t);
    const key = asString(rec.key) ?? "";
    const organiser = asString(rec.organiser) ?? "";
    const name = asString(rec.name) ?? "";
    const user = userByKey.get(organiser);
    if (!key || !name || !user) throw err(422, "SEED_INVALID", `team ${key || "?"}: incomplete`);
    const teamId = newId();
    await db.query(`INSERT INTO teams (id, organiser_id, name) VALUES ($1, $2, $3)`, [teamId, user.id, name]);
    const players = new Map<string, string>();
    const list = Array.isArray(rec.players) ? rec.players : [];
    for (let i = 0; i < list.length; i++) {
      const pr = asRecord(list[i]);
      const pkey = asString(pr.key) ?? "";
      const pname = (asString(pr.name) ?? "").trim();
      if (!pkey || !pname) throw err(422, "SEED_INVALID", `team ${key} player ${i + 1}: incomplete`);
      const short = (asString(pr.short_name) ?? "").trim() || pname.split(/\s+/).pop()!;
      const clash = await db.query(`SELECT 1 FROM players WHERE team_id = $1 AND short_name = $2`, [teamId, short]);
      if (clash.length > 0) throw err(422, "SEED_INVALID", `team ${key} player ${pkey}: short names clash`);
      const pid = newId();
      await db.query(
        `INSERT INTO players (id, team_id, name, short_name, batting_order) VALUES ($1, $2, $3, $4, $5)`,
        [pid, teamId, pname, short, i],
      );
      players.set(pkey, pid);
    }
    teamByKey.set(key, { id: teamId, key, players });
  }

  for (const t of tournaments) {
    const rec = asRecord(t);
    const key = asString(rec.key) ?? "";
    const organiser = asString(rec.organiser) ?? "";
    const name = asString(rec.name) ?? "";
    const user = userByKey.get(organiser);
    if (!key || !name || !user) throw err(422, "SEED_INVALID", `tournament ${key || "?"}: incomplete`);
    const tournamentId = newId();
    await db.query(
      `INSERT INTO tournaments (id, organiser_id, name, overs, players_per_side, super_over) VALUES ($1, $2, $3, $4, $5, $6)`,
      [tournamentId, user.id, name, Number(rec.overs ?? 20), Number(rec.players_per_side ?? 11), rec.super_over === true],
    );
    const groups = Array.isArray(rec.groups) ? rec.groups : [];
    for (const g of groups) {
      const gr = asRecord(g);
      const gid = newId();
      await db.query(`INSERT INTO tournament_groups (id, tournament_id, name) VALUES ($1, $2, $3)`, [
        gid, tournamentId, asString(gr.name) ?? "Group",
      ]);
      const teamKeys = Array.isArray(gr.teams) ? gr.teams : [];
      for (const tk of teamKeys) {
        const team = teamByKey.get(asString(tk) ?? "");
        if (!team) throw err(422, "SEED_INVALID", `tournament ${key}: unknown team ${tk}`);
        await db.query(`INSERT INTO tournament_group_teams (group_id, team_id) VALUES ($1, $2)`, [gid, team.id]);
      }
    }
    tournamentByKey.set(key, { id: tournamentId });
  }

  for (const m of matches) {
    const rec = asRecord(m);
    const key = asString(rec.key) ?? "";
    const organiser = asString(rec.organiser) ?? "";
    const homeKey = asString(rec.home) ?? "";
    const awayKey = asString(rec.away) ?? "";
    const user = userByKey.get(organiser);
    const home = teamByKey.get(homeKey);
    const away = teamByKey.get(awayKey);
    if (!key || !user || !home || !away || home.id === away.id) {
      throw err(422, "SEED_INVALID", `match ${key || "?"}: incomplete`);
    }
    const overs = Number(rec.overs ?? 20);
    const playersPerSide = Number(rec.players_per_side ?? 11);
    const superOver = rec.super_over === true;
    const battingFirst = teamByKey.get(asString(rec.batting_first) ?? homeKey) ?? home;
    const tournamentKey = asString(rec.tournament);
    const tournament = tournamentKey ? tournamentByKey.get(tournamentKey) : null;
    const matchId = newId();
    const viewerCode = newViewerCode();
    const playedOn = asString(rec.played_on);
    const summary = asRecord(rec.summary);
    const summaryFirst = asRecord(summary.first);
    const summarySecond = asRecord(summary.second);

    await db.query(
      `INSERT INTO matches (id, organiser_id, home_team_id, away_team_id, tournament_id, overs, players_per_side, super_over,
        batting_first, viewer_link, viewer_code, status, played_on,
        summary_first_runs, summary_first_wickets, summary_first_balls, summary_first_all_out,
        summary_second_runs, summary_second_wickets, summary_second_balls, summary_second_all_out, summary_winner)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,'ready',$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        matchId, user.id, home.id, away.id, tournament ? tournament.id : null, overs, playersPerSide, superOver,
        battingFirst.id, viewerCode, playedOn,
        summaryFirst.runs === undefined ? null : Number(summaryFirst.runs),
        summaryFirst.wickets === undefined ? null : Number(summaryFirst.wickets),
        summaryFirst.balls === undefined ? null : Number(summaryFirst.balls),
        summaryFirst.all_out === true,
        summarySecond.runs === undefined ? null : Number(summarySecond.runs),
        summarySecond.wickets === undefined ? null : Number(summarySecond.wickets),
        summarySecond.balls === undefined ? null : Number(summarySecond.balls),
        summarySecond.all_out === true,
        summary.winner === undefined ? null : (teamByKey.get(asString(summary.winner) ?? "")?.id ?? null),
      ],
    );

    const xi = asRecord(rec.xi);
    for (const teamRef of [home, away]) {
      const listRaw = Array.isArray(xi[teamRef.key]) ? xi[teamRef.key] : [];
      const list: unknown[] = listRaw as unknown[];
      if (list.length !== playersPerSide) {
        throw err(422, "SEED_INVALID", `match ${key}: xi for ${teamRef.key} has ${list.length} players`);
      }
      for (let i = 0; i < list.length; i++) {
        const pid = teamRef.players.get(asString(list[i]) ?? "");
        if (!pid) throw err(422, "SEED_INVALID", `match ${key}: unknown player ${list[i]}`);
        await db.query(
          `INSERT INTO match_xi (match_id, team_id, player_id, batting_order) VALUES ($1, $2, $3, $4)`,
          [matchId, teamRef.id, pid, i],
        );
      }
    }

    const scorers = Array.isArray(rec.scorers) ? rec.scorers : [];
    for (const sk of scorers) {
      const scorer = userByKey.get(asString(sk) ?? "");
      if (!scorer) throw err(422, "SEED_INVALID", `match ${key}: unknown scorer ${sk}`);
      await db.query(`INSERT INTO match_scorers (match_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [matchId, scorer.id]);
    }

    const inningsList = Array.isArray(rec.innings) ? rec.innings : [];
    if (inningsList.length > 0) {
      await seedInnings(deps, matchId, inningsList, home, away);
    } else if (summaryFirst.runs !== undefined) {
      await applySummary(db, matchId, summaryFirst, summarySecond, asString(summary.winner), home, away);
    }
    await syncMatchResult(deps, matchId);
    matchByKey.set(key, { id: matchId, viewer_code: viewerCode });
  }

  for (const inv of invitations) {
    const rec = asRecord(inv);
    const key = asString(rec.key) ?? "";
    const matchKey = asString(rec.match) ?? "";
    const email = (asString(rec.email) ?? "").trim().toLowerCase();
    const sentAt = asString(rec.sent_at) ?? "";
    const match = matchByKey.get(matchKey);
    if (!key || !match || !email || !sentAt) throw err(422, "SEED_INVALID", `invitation ${key || "?"}: incomplete`);
    const token = newInviteToken();
    await db.query(`INSERT INTO invitations (token, match_id, email, sent_at) VALUES ($1, $2, $3, $4)`, [
      token, match.id, email, new Date(sentAt),
    ]);
    invitationByKey.set(key, { token });
  }

  return {
    users: mapOf(userByKey, (v) => ({ id: v.id, session: v.session })),
    teams: mapOf(teamByKey, (v) => ({ id: v.id, players: Object.fromEntries([...v.players]) })),
    tournaments: mapOf(tournamentByKey, (v) => ({ id: v.id })),
    matches: mapOf(matchByKey, (v) => ({ id: v.id, viewer_code: v.viewer_code })),
    invitations: mapOf(invitationByKey, (v) => ({ token: v.token })),
  };
};

const mapOf = <V>(src: Map<string, V>, fn: (v: V) => unknown): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of src) out[k] = fn(v);
  return out;
};

// Applies a summary-only finished match: numbers plus a result built by the result rule.
const applySummary = async (
  db: Db,
  matchId: string,
  first: Record<string, unknown>,
  second: Record<string, unknown>,
  winnerKey: string | null,
  home: TeamRef,
  away: TeamRef,
): Promise<void> => {
  const rows = await db.query<{ batting_first: string; home_team_id: string; away_team_id: string; overs: number; players_per_side: number }>(
    `SELECT batting_first, home_team_id, away_team_id, overs, players_per_side FROM matches WHERE id = $1`,
    [matchId],
  );
  const m = rows[0];
  const nameOf = await teamNameOf(db, matchId);
  const firstRuns = Number(first.runs ?? 0);
  const secondRuns = Number(second.runs ?? 0);
  const firstTeam = m.batting_first;
  const secondTeam = firstTeam === m.home_team_id ? m.away_team_id : m.home_team_id;
  const winner =
    winnerKey === home.key ? home.id : winnerKey === away.key ? away.id : null;

  let result: string;
  if (winner === null) {
    result = copy.resultTied;
  } else if (winner === secondTeam) {
    const wicketsLost = Number(second.wickets ?? 0);
    const wicketsInHand = m.players_per_side - 1 - wicketsLost;
    const ballsFaced = Number(second.balls ?? 0);
    const ballsLeft = Math.max(0, m.overs * 6 - ballsFaced);
    result = copy.resultChasingWins(nameOf(secondTeam), wicketsInHand, ballsLeft);
  } else {
    result = copy.resultDefendingWins(nameOf(firstTeam), firstRuns - secondRuns);
  }
  await db.query(`UPDATE matches SET status = 'result', result = $2 WHERE id = $1`, [matchId, result]);
};

const teamNameOf = async (db: Db, matchId: string): Promise<(id: string) => string> => {
  const rows = await db.query<{ home_id: string; home_name: string; away_id: string; away_name: string }>(
    `SELECT m.home_team_id AS home_id, h.name AS home_name, m.away_team_id AS away_id, a.name AS away_name
     FROM matches m JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id WHERE m.id = $1`,
    [matchId],
  );
  const r = rows[0];
  return (id: string): string => (id === r.home_id ? r.home_name : r.away_name);
};

// Replays each seeded innings through the laws engine, exactly as if scored.
const seedInnings = async (
  deps: AppDeps,
  matchId: string,
  inningsList: unknown[],
  home: TeamRef,
  away: TeamRef,
): Promise<void> => {
  const db = deps.db;
  const matchRow = await db.query<{ batting_first: string; home_team_id: string; away_team_id: string; players_per_side: number }>(
    `SELECT batting_first, home_team_id, away_team_id, players_per_side FROM matches WHERE id = $1`,
    [matchId],
  );
  const m = matchRow[0];

  for (let index = 0; index < inningsList.length; index++) {
    const rec = asRecord(inningsList[index]);
    const where = `match innings ${index + 1}`;

    let label: string;
    let superNumber = 0;
    let battingTeamId: string;
    let bowlingTeamId: string;
    if (index === 0) {
      label = "1";
      battingTeamId = m.batting_first;
      bowlingTeamId = battingTeamId === m.home_team_id ? m.away_team_id : m.home_team_id;
    } else if (index === 1) {
      label = "2";
      battingTeamId = m.batting_first === m.home_team_id ? m.away_team_id : m.home_team_id;
      bowlingTeamId = m.batting_first;
    } else {
      const pairIndex = index - 2;
      superNumber = Math.floor(pairIndex / 2) + 1;
      const isSecondHalf = pairIndex % 2 === 1;
      if (isSecondHalf) {
        label = `so${superNumber}-2`;
        const firstHalf = await db.query<{ batting_team_id: string; bowling_team_id: string }>(
          `SELECT batting_team_id, bowling_team_id FROM innings WHERE match_id = $1 AND label = $2`,
          [matchId, `so${superNumber}-1`],
        );
        battingTeamId = firstHalf[0].bowling_team_id;
        bowlingTeamId = firstHalf[0].batting_team_id;
      } else {
        label = `so${superNumber}-1`;
        if (superNumber === 1) {
          battingTeamId = m.batting_first === m.home_team_id ? m.away_team_id : m.home_team_id;
        } else {
          const prev = await db.query<{ bowling_team_id: string }>(
            `SELECT bowling_team_id FROM innings WHERE match_id = $1 AND label = $2`,
            [matchId, `so${superNumber - 1}-2`],
          );
          battingTeamId = prev[0].bowling_team_id;
        }
        bowlingTeamId = battingTeamId === m.home_team_id ? m.away_team_id : m.home_team_id;
      }
    }

    const striker = findPlayerId(asString(rec.striker), home, away);
    const nonStriker = findPlayerId(asString(rec.non_striker), home, away);
    if (!striker || !nonStriker) throw err(422, "SEED_INVALID", `${where}: missing opening batters`);

    // The seed names one bowler per over; over 1's bowler is bowlers[0].
    const bowlers = Array.isArray(rec.bowlers) ? rec.bowlers : [];
    const firstBowler = findPlayerId(asString(bowlers[0]), home, away);
    if (!firstBowler) throw err(422, "SEED_INVALID", `${where}: no bowler for over 1`);

    const inningsId = newId();
    await db.query(
      `INSERT INTO innings (id, match_id, label, batting_team_id, bowling_team_id, striker, non_striker, bowler, super_over_number, started_at, seq)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [inningsId, matchId, label, battingTeamId, bowlingTeamId, striker, nonStriker, firstBowler, superNumber, new Date(), index + 1],
    );

    for (let i = 0; i < bowlers.length; i++) {
      const bowlerId = findPlayerId(asString(bowlers[i]), home, away);
      if (!bowlerId) throw err(422, "SEED_INVALID", `${where}: unknown bowler ${bowlers[i]}`);
      await db.query(`INSERT INTO over_starts (id, innings_id, over_number, bowler) VALUES ($1, $2, $3, $4)`, [
        newId(), inningsId, i + 1, bowlerId,
      ]);
    }

    const deliveries = Array.isArray(rec.deliveries) ? rec.deliveries : [];
    for (let i = 0; i < deliveries.length; i++) {
      const raw = deliveries[i];
      const dRec = typeof raw === "string" ? asRecord({ ball: raw }) : asRecord(raw);
      const token = asString(dRec.ball) ?? "0";
      const whereD = `${where} delivery ${i + 1}`;
      const { extra, runs } = tokenOf(token, whereD);

      const loaded = await loadMatch(db, matchId);
      if (!loaded) throw err(422, "SEED_INVALID", `${whereD}: match missing`);
      const computed = computeMatch(loaded);
      const current = computed.innings.find((inn) => inn.id === inningsId) as InningsRow | undefined;
      if (!current) throw err(422, "SEED_INVALID", `${whereD}: innings missing`);
      const replay = computed.replays.get(inningsId)!;
      if (replay.innings_ended) throw err(422, "SEED_INVALID", `${whereD}: the innings is over`);

      const strikerNow = replay.striker ?? striker;
      if (!strikerNow) throw err(422, "SEED_INVALID", `${whereD}: no batter in`);
      const overNumber = Math.floor(replay.legal_balls / 6) + 1;
      const bowlerRows = await db.query<{ bowler: string }>(
        `SELECT bowler FROM over_starts WHERE innings_id = $1 AND over_number = $2`,
        [inningsId, overNumber],
      );
      const bowler = bowlerRows[0]?.bowler;
      if (!bowler) throw err(422, "SEED_INVALID", `${whereD}: no bowler for over ${overNumber}`);

      const out = asString(dRec.out);
      let wicketValues: [string, string | null, "striker" | "non-striker", string | null] | null = null;
      if (out) {
        if (!WICKETS.includes(out as WicketKind)) throw err(422, "SEED_INVALID", `${whereD}: unknown wicket kind ${out}`);
        const allowed = allowedWicketsOn(extra, replay.free_hit);
        if (!allowed.includes(out as WicketKind)) {
          const reason = replay.free_hit
            ? `match innings ${index + 1} delivery ${i + 1}: ${out} cannot happen on a free hit`
            : `${whereD}: ${out} cannot happen on this delivery`;
          throw err(422, "SEED_INVALID", reason);
        }
        const fielder = findPlayerId(asString(dRec.fielder), home, away);
        const batterOut = (asString(dRec.batter_out) ?? "striker") as "striker" | "non-striker";
        if ((out === "caught" || out === "stumped" || out === "run-out") && !fielder) {
          throw err(422, "SEED_INVALID", `${whereD}: ${out} needs a fielder`);
        }
        let newBatter = findPlayerId(asString(dRec.new_batter), home, away);
        if (!newBatter) {
          const maxWickets = current.super_over_number === 0 ? m.players_per_side - 1 : Math.min(2, m.players_per_side - 1);
          const allOut = replay.wickets + 1 >= maxWickets;
          newBatter = allOut ? null : replay.yet_to_bat[0] ?? null;
        }
        wicketValues = [out, fielder ?? null, batterOut, newBatter];
      }

      const seq = (replay.last_seq ?? 0) + 1;
      await db.query(
        `INSERT INTO deliveries (id, innings_id, match_id, seq, striker, bowler, extra, runs, wicket_kind, wicket_fielder, wicket_batter_out, wicket_new_batter)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          newId(), inningsId, matchId, seq, strikerNow, bowler, extra, runs,
          wicketValues ? wicketValues[0] : null,
          wicketValues ? wicketValues[1] : null,
          wicketValues ? wicketValues[2] : null,
          wicketValues ? wicketValues[3] : null,
        ],
      );
    }

    const retirements = Array.isArray(rec.retirements) ? rec.retirements : [];
    for (const r of retirements) {
      const rr = asRecord(r);
      const batter = findPlayerId(asString(rr.batter), home, away);
      const newBatter = findPlayerId(asString(rr.new_batter), home, away);
      if (!batter || !newBatter) throw err(422, "SEED_INVALID", `${where}: retirement is incomplete`);
      const loaded = await loadMatch(db, matchId);
      if (!loaded) throw err(422, "SEED_INVALID", `${where}: match missing`);
      const computed = computeMatch(loaded);
      const replay = computed.replays.get(inningsId)!;
      const seq = (replay.last_seq ?? 0) + 1;
      await db.query(
        `INSERT INTO retirements (id, innings_id, match_id, seq, batter, new_batter) VALUES ($1, $2, $3, $4, $5, $6)`,
        [newId(), inningsId, matchId, seq, batter, newBatter],
      );
    }
  }
};

const findPlayerId = (key: string | null, home: TeamRef, away: TeamRef): string | null => {
  if (!key) return null;
  return home.players.get(key) ?? away.players.get(key) ?? null;
};

