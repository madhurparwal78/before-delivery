import {
  asNumber,
  asRecord,
  asString,
  err,
  type Ctx,
} from "./http.js";
import { copy } from "./copy.js";
import { newId, newViewerCode } from "./ids.js";
import { computeMatch, loadMatch, specOf, type ComputedMatch, type InningsRow, type LoadedMatch } from "./match.js";
import { buildScorecard } from "./scorecard.js";
import { buildState, teamJsonOf } from "./state.js";
import type { AppDeps } from "./api.js";
import { allowedWicketsOn, isLegal, type Extra, type WicketKind } from "./laws.js";

// The pen: exactly one scoring page holds it, kept in Valkey while its socket is open.

export interface PenCheck {
  penId: string | null;
  holder: string | null;
}

export const penKey = (matchId: string): string => `pen:${matchId}`;

export const holderOf = async (deps: AppDeps, matchId: string): Promise<{ penId: string | null; holder: string | null }> => {
  const raw = await deps.services.pen.get(penKey(matchId));
  if (raw === null) return { penId: null, holder: null };
  const sep = raw.indexOf("|");
  return { penId: sep === -1 ? raw : raw.slice(0, sep), holder: sep === -1 ? null : raw.slice(sep + 1) };
};

export const requirePen = async (deps: AppDeps, ctx: Ctx, matchId: string): Promise<void> => {
  const { penId, holder } = await holderOf(deps, matchId);
  const presented = ctx.req.headers["x-pen"];
  const presentedStr = typeof presented === "string" ? presented : Array.isArray(presented) ? presented[0] : null;
  if (penId === null || presentedStr !== penId) {
    throw err(409, "PEN_HELD", penId === null ? copy.penFree : copy.penHeld(holder ?? "Another scorer"), {
      holder,
    });
  }
};

// ---------- match creation and visibility ----------

export const canOpenMatch = (loaded: LoadedMatch, userId: string): boolean =>
  loaded.match.organiser_id === userId || true; // replaced below by scorer check

export const loadOpenMatch = async (deps: AppDeps, ctx: Ctx, matchId: string): Promise<LoadedMatch> => {
  const loaded = await loadMatch(deps.db, matchId);
  if (loaded === null) throw err(404, "NOT_FOUND", copy.notFound);
  const isOrganiser = loaded.match.organiser_id === ctx.session!.id;
  if (!isOrganiser) {
    const scorer = await deps.db.query(
      `SELECT 1 FROM match_scorers WHERE match_id = $1 AND user_id = $2`,
      [matchId, ctx.session!.id],
    );
    if (scorer.length === 0) throw err(404, "NOT_FOUND", copy.notFound);
  }
  return loaded;
};

export const loadOrganiserMatch = async (deps: AppDeps, ctx: Ctx, matchId: string): Promise<LoadedMatch> => {
  const loaded = await loadMatch(deps.db, matchId);
  if (loaded === null || loaded.match.organiser_id !== ctx.session!.id) throw err(404, "NOT_FOUND", copy.notFound);
  return loaded;
};

export const createMatch = async (deps: AppDeps, ctx: Ctx): Promise<unknown> => {
  const body = asRecord(ctx.body);
  const home = asString(body.home);
  const away = asString(body.away);
  const overs = asNumber(body.overs);
  const playersPerSide = asNumber(body.players_per_side);
  const superOver = body.super_over === true;
  const battingFirst = asString(body.batting_first);
  const tournament = asString(body.tournament);
  const xiRaw = asRecord(body.xi);

  const fields: Record<string, string> = {};
  if (overs === null || !Number.isInteger(overs) || overs < 1 || overs > 50) fields.overs = copy.oversField;
  if (playersPerSide === null || !Number.isInteger(playersPerSide) || playersPerSide < 2 || playersPerSide > 11)
    fields.players_per_side = copy.playersPerSideField;

  // Teams must belong to the organiser.
  for (const teamId of [home, away]) {
    if (!teamId) continue;
    const owned = await deps.db.query(`SELECT 1 FROM teams WHERE id = $1 AND organiser_id = $2`, [teamId, ctx.session!.id]);
    if (owned.length === 0) throw err(404, "NOT_FOUND", copy.notFound);
  }
  if (!home || !away || home === away) {
    fields.home = "Enter a name.";
  }

  // Tournament settings
  let tournamentId: string | null = null;
  if (tournament !== null && tournament !== undefined && tournament !== "") {
    const t = await deps.db.query<{ organiser_id: string; overs: number; players_per_side: number; super_over: boolean }>(
      `SELECT organiser_id, overs, players_per_side, super_over FROM tournaments WHERE id = $1`,
      [tournament],
    );
    if (t.length === 0 || t[0].organiser_id !== ctx.session!.id) throw err(404, "NOT_FOUND", copy.notFound);
    tournamentId = tournament;
    if (overs !== null) fields.overs = "";
    // Picking a tournament fixes overs, players per side and super over.
    const rec = t[0];
    if (overs !== rec.overs || playersPerSide !== rec.players_per_side || superOver !== rec.super_over) {
      // The client sends the tournament's values; otherwise refuse.
      fields.tournament = copy.teamsNotInOneGroup;
    }
    // Both teams in one group
    const groupTeams = await deps.db.query<{ group_id: string; team_id: string }>(
      `SELECT g.group_id, g.team_id FROM tournament_group_teams g JOIN tournament_groups tg ON tg.id = g.group_id WHERE tg.tournament_id = $1`,
      [tournament],
    );
    const homeGroup = groupTeams.find((g) => g.team_id === home)?.group_id;
    const awayGroup = groupTeams.find((g) => g.team_id === away)?.group_id;
    if (!homeGroup || !awayGroup || homeGroup !== awayGroup) {
      fields.tournament = copy.teamsNotInOneGroup;
    }
  }

  // XI checks
  const xi: Record<string, string[]> = {};
  for (const teamId of [home ?? "", away ?? ""]) {
    if (!teamId) continue;
    const list = Array.isArray(xiRaw[teamId]) ? (xiRaw[teamId] as unknown[]).map((p) => asString(p) ?? "") : [];
    xi[teamId] = list;
    if (list.length !== playersPerSide) fields.xi = copy.xiField(playersPerSide ?? 0);
    for (const pid of list) {
      const ok = await deps.db.query(`SELECT 1 FROM players WHERE id = $1 AND team_id = $2`, [pid, teamId]);
      if (ok.length === 0) fields.xi = copy.xiField(playersPerSide ?? 0);
    }
  }
  if (Object.keys(fields).some((k) => fields[k] !== "")) {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) if (v !== "") clean[k] = v;
    throw err(422, "VALIDATION", copy.fieldErrorsSummary, { fields: clean });
  }

  const id = newId();
  const viewerCode = newViewerCode();
  await deps.db.withTransaction(async (client) => {
    await client.query(
      `INSERT INTO matches (id, organiser_id, home_team_id, away_team_id, tournament_id, overs, players_per_side, super_over, batting_first, viewer_link, viewer_code, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, 'ready')`,
      [id, ctx.session!.id, home, away, tournamentId, overs, playersPerSide, superOver, battingFirst ?? home, viewerCode],
    );
    for (const [teamId, list] of Object.entries(xi)) {
      for (let i = 0; i < list.length; i++) {
        await client.query(
          `INSERT INTO match_xi (match_id, team_id, player_id, batting_order) VALUES ($1, $2, $3, $4)`,
          [id, teamId, list[i], i],
        );
      }
    }
  });
  return matchJson(deps, id);
};

export const matchJson = async (deps: AppDeps, matchId: string): Promise<unknown> => {
  const loaded = await loadMatch(deps.db, matchId);
  if (!loaded) throw err(404, "NOT_FOUND", copy.notFound);
  const scorers = await deps.db.query<{ display_name: string }>(
    `SELECT u.display_name FROM match_scorers s JOIN users u ON u.id = s.user_id WHERE s.match_id = $1 ORDER BY u.display_name`,
    [matchId],
  );
  return {
    id: loaded.match.id,
    title: `${loaded.home.name} v ${loaded.away.name}`,
    status: loaded.match.status,
    home: teamJsonOf(loaded.home),
    away: teamJsonOf(loaded.away),
    overs: loaded.match.overs,
    players_per_side: loaded.match.players_per_side,
    super_over: loaded.match.super_over,
    tournament: loaded.match.tournament_id,
    viewer_link: loaded.match.viewer_link,
    viewer_code: loaded.match.viewer_code,
    scorers: scorers.map((s) => ({ display_name: s.display_name })),
  };
};

// ---------- innings / overs / deliveries ----------

const currentInnings = (computed: ComputedMatch): InningsRow | null => computed.current;

const bowlingNeeded = (loaded: LoadedMatch, computed: ComputedMatch): boolean => {
  const current = computed.current;
  if (!current) return false;
  const replay = computed.replays.get(current.id)!;
  if (replay.innings_ended) return false;
  const overStarts = loaded.overStarts.get(current.id) ?? [];
  const overNumber = Math.floor(replay.legal_balls / 6) + 1;
  return overStarts.find((o) => o.over_number === overNumber) === undefined;
};

export const startInnings = async (deps: AppDeps, ctx: Ctx): Promise<unknown> => {
  const matchId = ctx.params.id;
  await requirePen(deps, ctx, matchId);
  const loaded = await loadOpenMatch(deps, ctx, matchId);
  const computed = computeMatch(loaded);
  const body = asRecord(ctx.body);
  const striker = asString(body.striker);
  const nonStriker = asString(body.non_striker);
  const bowler = asString(body.bowler);

  const status = computed.status;
  if (status === "innings_1" || status === "innings_2" || status === "super_over") {
    throw err(409, "INNINGS_IN_PROGRESS", copy.inningsAlreadyStarted);
  }
  if (status === "result" || status === "tied") throw err(409, "MATCH_OVER", copy.matchOver);

  const battingTeamIdFor = (state: string): string =>
    state === "ready" ? loaded.match.batting_first : loaded.match.batting_first === loaded.home.id ? loaded.away.id : loaded.home.id;
  let battingTeamId = battingTeamIdFor(status);
  let bowlingTeamId = battingTeamId === loaded.home.id ? loaded.away.id : loaded.home.id;
  let label: string;
  let superOverNumber = 0;
  let seq: number;

  if (status === "ready") {
    label = "1";
    seq = 1;
  } else if (status === "innings_break") {
    label = "2";
    seq = 2;
  } else {
    // super_over_break: start (or continue) super overs
    const lastSuper = computed.innings.filter((i) => i.super_over_number > 0);
    const nextNumber = lastSuper.length === 0 ? 1 : (lastSuper[lastSuper.length - 1]?.super_over_number ?? 0) + 1;
    // After the first half of a super over, the second half follows.
    const lastIsFirstHalf = lastSuper.length > 0 && lastSuper[lastSuper.length - 1].label.endsWith("-1");
    superOverNumber = lastIsFirstHalf ? lastSuper[lastSuper.length - 1].super_over_number : nextNumber;
    const isSecondHalf = lastIsFirstHalf;
    if (isSecondHalf) {
      label = `so${superOverNumber}-2`;
      const firstHalf = lastSuper[lastSuper.length - 1];
      battingTeamId = firstHalf.bowling_team_id;
      bowlingTeamId = firstHalf.batting_team_id;
      seq = computed.innings.length + 1;
    } else {
      label = `so${superOverNumber}-1`;
      // In super over 1 the side that batted second in the match bats first;
      // in each later super over, the side that batted second in the previous super over.
      const matchSecond = loaded.match.batting_first === loaded.home.id ? loaded.away.id : loaded.home.id;
      const previousSuper = lastSuper.length > 0 ? lastSuper[lastSuper.length - 1] : null;
      battingTeamId = previousSuper
        ? previousSuper.label.endsWith("-2")
          ? previousSuper.bowling_team_id
          : previousSuper.batting_team_id
        : matchSecond;
      bowlingTeamId = battingTeamId === loaded.home.id ? loaded.away.id : loaded.home.id;
      seq = computed.innings.length + 1;
    }
  }

  // Validation: striker and non-striker from the batting XI, bowler from the bowling XI.
  const battingXi = loaded.xi.get(battingTeamId) ?? [];
  const bowlingXi = loaded.xi.get(bowlingTeamId) ?? [];
  const fields: Record<string, string> = {};
  if (!striker || !battingXi.some((p) => p.id === striker)) fields.striker = copy.newBatterInvalid;
  if (!nonStriker || !battingXi.some((p) => p.id === nonStriker)) fields.non_striker = copy.newBatterInvalid;
  if (!bowler || !bowlingXi.some((p) => p.id === bowler)) fields.bowler = copy.newBatterInvalid;
  if (Object.keys(fields).length > 0) throw err(422, "VALIDATION", copy.fieldErrorsSummary, { fields });

  // Super-over bowler barred from the previous super over.
  if (superOverNumber > 1 && bowler !== null) {
    const previous = computed.innings.find((i) => i.super_over_number === superOverNumber - 1 && i.label.endsWith("-1"));
    if (previous) {
      const prevReplay = computed.replays.get(previous.id);
      if (prevReplay && prevReplay.over_bowlers.includes(bowler)) {
        const short = loaded.players.get(bowler)?.short_name ?? "";
        throw err(422, "BOWLER_BARRED", copy.bowlerSuperOver(short));
      }
    }
  }

  const inningsId = newId();
  await deps.db.withTransaction(async (client) => {
    await client.query(
      `INSERT INTO innings (id, match_id, label, batting_team_id, bowling_team_id, striker, non_striker, bowler, super_over_number, started_at, seq)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [inningsId, matchId, label, battingTeamId, bowlingTeamId, striker, nonStriker, bowler, superOverNumber, new Date(), seq],
    );
    await client.query(`INSERT INTO over_starts (id, innings_id, over_number, bowler) VALUES ($1, $2, 1, $3)`, [newId(), inningsId, bowler]);
    await client.query(`UPDATE matches SET status = $2 WHERE id = $1`, [matchId, superOverNumber > 0 ? "super_over" : label === "1" ? "innings_1" : "innings_2"]);
  });
  return stateResponse(deps, matchId, { kind: "innings", seq: null });
};

export const startOver = async (deps: AppDeps, ctx: Ctx): Promise<unknown> => {
  const matchId = ctx.params.id;
  await requirePen(deps, ctx, matchId);
  const loaded = await loadOpenMatch(deps, ctx, matchId);
  const computed = computeMatch(loaded);
  const body = asRecord(ctx.body);
  const bowler = asString(body.bowler);

  const current = currentInnings(computed);
  if (!current) throw err(409, "NEEDS_INNINGS", copy.startInningsFirst);
  const status = computed.status;
  if (status === "result" || status === "tied") throw err(409, "MATCH_OVER", copy.matchOver);
  const replay = computed.replays.get(current.id)!;
  if (replay.innings_ended) throw err(409, "INNINGS_OVER", copy.inningsOver);
  if (!bowlingNeeded(loaded, computed)) throw err(409, "OVER_IN_PROGRESS", copy.overAlreadyStarted);

  const bowlingXi = loaded.xi.get(current.bowling_team_id) ?? [];
  const short = loaded.players.get(bowler ?? "")?.short_name ?? "";
  const overNumber = Math.floor(replay.legal_balls / 6) + 1;
  const overStarts = loaded.overStarts.get(current.id) ?? [];
  const lastBowler = overStarts.length > 0 ? overStarts[overStarts.length - 1].bowler : null;

  if (!bowler || !bowlingXi.some((p) => p.id === bowler)) {
    throw err(422, "VALIDATION", copy.fieldErrorsSummary, { fields: { bowler: copy.newBatterInvalid } });
  }
  // Consecutive check first, then limit.
  if (current.super_over_number === 0) {
    if (lastBowler === bowler) throw err(422, "BOWLER_CONSECUTIVE", copy.bowlerConsecutive(short));
    const limit = Math.ceil(loaded.match.overs / 5);
    const bf = replay.bowlers.get(bowler);
    if (bf && Math.floor(bf.legal_balls / 6) >= limit) throw err(422, "BOWLER_LIMIT", copy.bowlerLimit(short, limit));
  } else if (lastBowler === bowler) {
    throw err(422, "BOWLER_CONSECUTIVE", copy.bowlerConsecutive(short));
  }

  await deps.db.query(
    `INSERT INTO over_starts (id, innings_id, over_number, bowler) VALUES ($1, $2, $3, $4)`,
    [newId(), current.id, overNumber, bowler],
  );
  return stateResponse(deps, matchId, { kind: "over", seq: null });
};

export const recordDelivery = async (deps: AppDeps, ctx: Ctx): Promise<unknown> => {
  const matchId = ctx.params.id;
  await requirePen(deps, ctx, matchId);
  const loaded = await loadOpenMatch(deps, ctx, matchId);
  const computed = computeMatch(loaded);
  const body = asRecord(ctx.body);
  const expectedSeq = asNumber(body.expected_seq);
  const extra = (asString(body.extra) ?? "none") as Extra;
  const runs = asNumber(body.runs) ?? 0;
  const wicketRaw = body.wicket;

  const current = currentInnings(computed);
  const status = computed.status;
  if (!current) throw err(409, "NEEDS_INNINGS", copy.startInningsFirst);
  if (status === "result" || status === "tied") throw err(409, "MATCH_OVER", copy.matchOver);
  const replay = computed.replays.get(current.id)!;
  if (replay.innings_ended) throw err(409, "INNINGS_OVER", copy.inningsOver);
  if (bowlingNeeded(loaded, computed)) throw err(409, "NEEDS_BOWLER", copy.chooseBowlerFirst);

  // Stale check before rule checks.
  const nextSeq = (replay.last_seq ?? 0) + 1;
  if (expectedSeq !== nextSeq) {
    throw err(409, "STALE_DELIVERY", copy.staleDelivery, { seq: replay.last_seq ?? 0 });
  }

  // Body validation
  const fields: Record<string, string> = {};
  if (!Number.isInteger(runs) || runs < 0 || runs > 6) fields.runs = copy.runsField;
  if ((extra === "bye" || extra === "leg-bye") && runs < 1) {
    throw err(422, "BYES_NEED_RUNS", copy.byesNeedRuns);
  }
  if (Object.keys(fields).length > 0) throw err(422, "VALIDATION", copy.fieldErrorsSummary, { fields });

  let wicket: { kind: WicketKind; fielder: string | null; batter_out: "striker" | "non-striker"; new_batter: string | null } | null = null;
  if (wicketRaw !== null && wicketRaw !== undefined) {
    const rec = asRecord(wicketRaw);
    const kind = asString(rec.kind) as WicketKind | null;
    if (kind === null || !["bowled", "caught", "lbw", "stumped", "hit-wicket", "run-out"].includes(kind)) {
      throw err(422, "VALIDATION", copy.fieldErrorsSummary, { fields: { wicket: copy.runsField } });
    }
    const fielder = asString(rec.fielder) ?? null;
    const batterOut = (asString(rec.batter_out) ?? "striker") as "striker" | "non-striker";
    const newBatter = asString(rec.new_batter) ?? null;
    if (kind !== "run-out" && runs !== 0) {
      throw err(422, "VALIDATION", copy.fieldErrorsSummary, { fields: { runs: copy.runsField } });
    }
    if (kind === "run-out" && (runs < 0 || runs > 3)) {
      throw err(422, "VALIDATION", copy.fieldErrorsSummary, { fields: { runs: copy.runsField } });
    }
    const allowed = allowedWicketsOn(extra, replay.free_hit);
    if (!allowed.includes(kind)) {
      throw err(
        422,
        "WICKET_NOT_ALLOWED",
        replay.free_hit ? copy.freeHitOnlyRunOut : copy.wicketNotAllowed(kind),
      );
    }
    const bowlingXi = loaded.xi.get(current.bowling_team_id) ?? [];
    if ((kind === "caught" || kind === "stumped" || kind === "run-out") && (!fielder || !bowlingXi.some((p) => p.id === fielder))) {
      throw err(422, "VALIDATION", copy.fieldErrorsSummary, { fields: { wicket: copy.newBatterInvalid } });
    }
    // new_batter required unless the wicket ends the innings.
    const waiting = [...replay.yet_to_bat, ...replay.retired_hurt];
    const wicketsAfter = replay.wickets + 1;
    const endsInnings = wicketsAfter >= specOf(loaded, current, [], []).max_wickets;
    if (newBatter === null && !endsInnings) {
      throw err(422, "NEW_BATTER_INVALID", copy.newBatterInvalid);
    }
    if (newBatter !== null && !waiting.includes(newBatter)) {
      throw err(422, "NEW_BATTER_INVALID", copy.newBatterInvalid);
    }
    wicket = { kind, fielder, batter_out: batterOut, new_batter: newBatter };
  }

  const striker = replay.striker;
  if (striker === null) throw err(409, "NEEDS_INNINGS", copy.startInningsFirst);
  const bowlerOfOver = currentBowler(loaded, current, replay);

  await deps.db.query(
    `INSERT INTO deliveries (id, innings_id, match_id, seq, striker, bowler, extra, runs, wicket_kind, wicket_fielder, wicket_batter_out, wicket_new_batter)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      newId(), current.id, matchId, nextSeq, striker, bowlerOfOver, extra, runs,
      wicket?.kind ?? null, wicket?.fielder ?? null, wicket?.batter_out ?? null, wicket?.new_batter ?? null,
    ],
  );
  await syncMatchResult(deps, matchId);
  return stateResponse(deps, matchId, { kind: "delivery", seq: nextSeq });
};

const currentBowler = (loaded: LoadedMatch, current: InningsRow, replay: { legal_balls: number }): string => {
  const overStarts = loaded.overStarts.get(current.id) ?? [];
  const overNumber = Math.floor(replay.legal_balls / 6) + 1;
  const match2 = overStarts.find((o) => o.over_number === overNumber);
  if (match2) return match2.bowler;
  return overStarts[overStarts.length - 1].bowler;
};

export const changeDelivery = async (deps: AppDeps, ctx: Ctx): Promise<unknown> => {
  const matchId = ctx.params.id;
  await requirePen(deps, ctx, matchId);
  const loaded = await loadOpenMatch(deps, ctx, matchId);
  const computed = computeMatch(loaded);
  const seq = Number(ctx.params.seq);
  const body = asRecord(ctx.body);
  const extra = (asString(body.extra) ?? "none") as Extra;
  const runs = asNumber(body.runs) ?? 0;

  const current = currentInnings(computed);
  if (!current) throw err(404, "NOT_FOUND", copy.notFound);
  const deliveries = loaded.deliveries.get(current.id) ?? [];
  const target = deliveries.find((d) => d.seq === seq);
  if (!target) throw err(404, "NOT_FOUND", copy.notFound);

  if (!Number.isInteger(runs) || runs < 0 || runs > 6) {
    throw err(422, "VALIDATION", copy.fieldErrorsSummary, { fields: { runs: copy.runsField } });
  }
  if ((extra === "bye" || extra === "leg-bye") && runs < 1) {
    throw err(422, "BYES_NEED_RUNS", copy.byesNeedRuns);
  }

  // A change must keep the delivery legal or not legal.
  const wasLegal = isLegal(target.extra as Extra);
  const nowLegal = isLegal(extra);
  if (wasLegal !== nowLegal) {
    throw err(422, "CHANGE_MOVES_OVERS", copy.changeMovesOvers);
  }
  // The wicket on this delivery must stay possible.
  if (target.wicket_kind) {
    const allowed = allowedWicketsOn(extra, false);
    if (!allowed.includes(target.wicket_kind as WicketKind)) {
      throw err(422, "CHANGE_BREAKS_WICKET", copy.changeBreaksThisWicket(target.wicket_kind));
    }
  }
  // A later wicket must not become impossible by a new free hit.
  const laterWickets = deliveries.filter((d) => d.seq > seq && d.wicket_kind && d.wicket_kind !== "run-out");
  if (extra === "no-ball" || target.extra === "no-ball") {
    // Simulate: apply the change and replay.
    const simDeliveries = deliveries.map((d) => (d.seq === seq ? { ...d, extra, runs } : d));
    const simLoaded: LoadedMatch = {
      ...loaded,
      deliveries: new Map(loaded.deliveries).set(current.id, simDeliveries),
    };
    const simComputed = computeMatch(simLoaded);
    const simReplay = simComputed.replays.get(current.id)!;
    for (const d of laterWickets) {
      if (d.wicket_kind === "run-out") continue;
      const item = simReplay.commentary.find((c) => c.kind === "delivery" && c.seq === d.seq);
      if (item && item.free_hit) {
        throw err(422, "CHANGE_BREAKS_WICKET", copy.changeBreaksLaterWicket(d.seq, d.wicket_kind!));
      }
    }
    // Also check this delivery's own wicket under the new free-hit flag.
    const thisItem = simReplay.commentary.find((c) => c.kind === "delivery" && c.seq === seq);
    if (thisItem && thisItem.free_hit && target.wicket_kind && target.wicket_kind !== "run-out") {
      throw err(422, "CHANGE_BREAKS_WICKET", copy.changeBreaksThisWicket(target.wicket_kind));
    }
  }

  await deps.db.query(
    `UPDATE deliveries SET extra = $1, runs = $2 WHERE innings_id = $3 AND seq = $4`,
    [extra, runs, current.id, seq],
  );
  await syncMatchResult(deps, matchId);
  return stateResponse(deps, matchId, { kind: "change", seq });
};

export const undoLast = async (deps: AppDeps, ctx: Ctx): Promise<unknown> => {
  const matchId = ctx.params.id;
  await requirePen(deps, ctx, matchId);
  const loaded = await loadOpenMatch(deps, ctx, matchId);

  const computed = computeMatch(loaded);
  const current = computed.current;
  if (!current) throw err(409, "NOTHING_TO_UNDO", copy.nothingToUndo);
  const deliveries = loaded.deliveries.get(current.id) ?? [];
  const retirements = loaded.retirements.get(current.id) ?? [];
  const overStarts = loaded.overStarts.get(current.id) ?? [];

  const lastSeqOfAll = Math.max(
    deliveries.length > 0 ? deliveries[deliveries.length - 1].seq : 0,
    retirements.length > 0 ? retirements[retirements.length - 1].seq : 0,
  );

  if (lastSeqOfAll > 0) {
    const lastRetirement = retirements.find((r) => r.seq === lastSeqOfAll);
    if (lastRetirement) {
      await deps.db.query(`DELETE FROM retirements WHERE innings_id = $1 AND seq = $2`, [current.id, lastSeqOfAll]);
      const short = loaded.players.get(lastRetirement.batter)?.short_name ?? "";
      await syncMatchResult(deps, matchId);
      return stateResponse(deps, matchId, { kind: "undo", seq: lastSeqOfAll, undid: "retirement", short });
    }
    await deps.db.query(`DELETE FROM deliveries WHERE innings_id = $1 AND seq = $2`, [current.id, lastSeqOfAll]);
    await syncMatchResult(deps, matchId);
    return stateResponse(deps, matchId, { kind: "undo", seq: lastSeqOfAll });
  }

  // No delivery in this innings yet: the over's bowler goes with the previous delivery.
  const overNumber = overStarts.length > 0 ? overStarts[overStarts.length - 1].over_number : 0;
  if (overNumber > 0) {
    await deps.db.query(`DELETE FROM over_starts WHERE innings_id = $1 AND over_number = $2`, [current.id, overNumber]);
    // The previous delivery of the previous over: the current innings is the same one.
    if (deliveries.length > 0) {
      const prev = deliveries[deliveries.length - 1];
      await deps.db.query(`DELETE FROM deliveries WHERE innings_id = $1 AND seq = $2`, [current.id, prev.seq]);
    }
    await syncMatchResult(deps, matchId);
    return stateResponse(deps, matchId, { kind: "undo", seq: null });
  }

  // This innings has no delivery and no bowler choice: undo the innings start together
  // with the last delivery of the finished innings, which reopens.
  const previous = computed.previous;
  if (previous) {
    const prevDeliveries = loaded.deliveries.get(previous.id) ?? [];
    await deps.db.query(`DELETE FROM innings WHERE id = $1`, [current.id]);
    if (prevDeliveries.length > 0) {
      const prev = prevDeliveries[prevDeliveries.length - 1];
      await deps.db.query(`DELETE FROM deliveries WHERE innings_id = $1 AND seq = $2`, [previous.id, prev.seq]);
    }
    await syncMatchResult(deps, matchId);
    return stateResponse(deps, matchId, { kind: "undo", seq: null });
  }
  throw err(409, "NOTHING_TO_UNDO", copy.nothingToUndo);
};

export const retireBatter = async (deps: AppDeps, ctx: Ctx): Promise<unknown> => {
  const matchId = ctx.params.id;
  await requirePen(deps, ctx, matchId);
  const loaded = await loadOpenMatch(deps, ctx, matchId);
  const computed = computeMatch(loaded);
  const body = asRecord(ctx.body);
  const batter = asString(body.batter);
  const newBatter = asString(body.new_batter);

  const current = currentInnings(computed);
  if (!current) throw err(409, "NEEDS_INNINGS", copy.startInningsFirst);
  const status = computed.status;
  if (status === "result" || status === "tied") throw err(409, "MATCH_OVER", copy.matchOver);
  const replay = computed.replays.get(current.id)!;
  if (replay.innings_ended) throw err(409, "INNINGS_OVER", copy.inningsOver);

  if (batter !== replay.striker && batter !== replay.non_striker) {
    throw err(422, "VALIDATION", copy.fieldErrorsSummary, { fields: { batter: copy.newBatterInvalid } });
  }
  const waiting = [...replay.yet_to_bat, ...replay.retired_hurt];
  if (!newBatter || !waiting.includes(newBatter)) {
    throw err(422, "NO_BATTER_LEFT", copy.noBatterLeft);
  }

  const seq = (replay.last_seq ?? 0) + 1;
  await deps.db.query(
    `INSERT INTO retirements (id, innings_id, match_id, seq, batter, new_batter) VALUES ($1, $2, $3, $4, $5, $6)`,
    [newId(), current.id, matchId, seq, batter, newBatter],
  );
  await syncMatchResult(deps, matchId);
  return stateResponse(deps, matchId, { kind: "retirement", seq });
};

// Keeps the stored status and result in step with the laws engine after each change.
export const syncMatchResult = async (deps: AppDeps, matchId: string): Promise<void> => {
  const loaded = await loadMatch(deps.db, matchId);
  if (!loaded) return;
  const computed = computeMatch(loaded);
  await deps.db.query(`UPDATE matches SET status = $2, result = $3 WHERE id = $1`, [matchId, computed.status, computed.result]);
};

export const stateResponse = async (
  deps: AppDeps,
  matchId: string,
  event: { kind: string; seq: number | null; undid?: "retirement"; short?: string },
): Promise<unknown> => {
  const loaded = await loadMatch(deps.db, matchId);
  if (!loaded) throw err(404, "NOT_FOUND", copy.notFound);
  const computed = computeMatch(loaded);
  const state = buildState(loaded, computed);
  publishState(deps, loaded, state, event);
  return state;
};

export const publishState = (
  deps: AppDeps,
  loaded: LoadedMatch,
  state: unknown,
  event: { kind: string; seq: number | null },
): void => {
  const message = JSON.stringify({ type: "state", event, state });
  void deps.services.bus.publish(`match:${loaded.match.id}`, message);
  if (loaded.match.tournament_id && (event.kind === "delivery" || event.kind === "change" || event.kind === "undo")) {
    void publishTournamentTables(deps, loaded.match.tournament_id);
  }
};

export const publishTournamentTables = async (deps: AppDeps, tournamentId: string): Promise<void> => {
  const { tournamentJson } = await import("./api.js");
  const json = (await tournamentJson(deps, tournamentId)) as { groups: unknown };
  const message = JSON.stringify({ type: "table", tournament: tournamentId, groups: json.groups });
  await deps.services.bus.publish(`tournament:${tournamentId}`, message);
};

export const scorecardResponse = async (deps: AppDeps, matchId: string): Promise<unknown> => {
  const loaded = await loadMatch(deps.db, matchId);
  if (!loaded) throw err(404, "NOT_FOUND", copy.notFound);
  const computed = computeMatch(loaded);
  return buildScorecard(loaded, computed);
};
