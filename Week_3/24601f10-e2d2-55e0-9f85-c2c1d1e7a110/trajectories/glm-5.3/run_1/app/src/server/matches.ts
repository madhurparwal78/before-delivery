import { withTransaction, one } from "./db.js";
import { errors, ApiError } from "./errors.js";
import { config } from "./config.js";
import { consumeMatchRate, isoNow, newId } from "./auth.js";
import type { Match } from "../shared/types.js";
import type { MatchRow, EntrantRow } from "./brackets.js";
import { applyAdvance, recomputeByeState } from "./brackets.js";
import {
  getTournamentRow,
  getEntrantRows,
  getMatchRows,
  makeNameLookup,
  toMatch,
  broadcastTournament,
  type TournamentRow,
} from "./tournaments.js";
import { recordMessage } from "./live.js";
import { computeStandings } from "./standings.js";

export interface MatchWriteContext {
  tournament: TournamentRow;
  user: { id: string; username: string };
  isOrganizer: boolean;
  entrantRow: EntrantRow | null;
  skipRateLimit?: boolean;
}

export async function loadMatchContext(
  tournament: TournamentRow,
  user: { id: string; username: string }
): Promise<MatchWriteContext> {
  const entrants = await getEntrantRows(tournament.id);
  const entrantRow = entrants.find((e) => e.username === user.username) ?? null;
  const isOrganizer =
    tournament.organizer_id === user.id ||
    (await one<{ user_id: string }>(`SELECT user_id FROM co_organizers WHERE tournament_id = $1 AND user_id = $2`, [
      tournament.id,
      user.id,
    ])) !== null;
  return { tournament, user, isOrganizer, entrantRow };
}

function scoreFields(upper: unknown, lower: unknown): { upper_games: number; lower_games: number } {
  const u = Number(upper);
  const l = Number(lower);
  const fields: Record<string, string> = {};
  if (!Number.isInteger(u) || u < 0 || u > 99) fields.upper_games = "Enter a whole number from 0 to 99.";
  if (!Number.isInteger(l) || l < 0 || l > 99) fields.lower_games = "Enter a whole number from 0 to 99.";
  if (Object.keys(fields).length > 0) throw errors.validation(fields);
  return { upper_games: u, lower_games: l };
}

function requireWinnerRules(format: string, u: number, l: number): void {
  if (u === 0 && l === 0) throw errors.validationMsg("A score needs at least one game.");
  if ((format === "single_elimination" || format === "double_elimination") && u === l) {
    throw errors.validationMsg("Elimination matches need a winner.");
  }
}

export async function announce(tournamentId: string, sentences: string[]): Promise<void> {
  const text = sentences.filter((s) => s.length > 0).join(". ");
  if (text) await recordMessage(tournamentId, "announcement", { text: text.endsWith(".") ? text : text });
}

export function advanceSentences(
  format: string,
  label: string,
  winnerName: string,
  loserName: string | null
): string[] {
  const out: string[] = [];
  const [region, round] = labelParse(label);
  if (format === "single_elimination") {
    out.push(`${winnerName} advances to round ${round}`);
  } else if (format === "double_elimination") {
    if (region === "winners") {
      out.push(`${winnerName} advances to winners round ${round}`);
      if (loserName) out.push(`${loserName} drops to losers round ${dropRoundFor(label)}`);
    } else if (region === "losers") {
      out.push(`${winnerName} advances to losers round ${round}`);
    }
  }
  return out;
}

function labelParse(label: string): ["winners" | "losers" | "final" | "main", number] {
  if (label.startsWith("Winners round ")) {
    return ["winners", Number(label.slice("Winners round ".length).split(",")[0])];
  }
  if (label.startsWith("Losers round ")) {
    return ["losers", Number(label.slice("Losers round ".length).split(",")[0])];
  }
  if (label === "Grand final") return ["final", 1];
  if (label === "Grand final reset") return ["final", 2];
  return ["main", Number(label.slice("Round ".length).split(",")[0])];
}

function dropRoundFor(label: string): number {
  // loser of winners round k drops into losers round 2k-2 (k>=2) or losers round 1 (k=1)
  const round = Number(label.slice("Winners round ".length).split(",")[0]);
  return round === 1 ? 1 : 2 * round - 2;
}

function staleMatchError(m: MatchRow): ApiError {
  const score = m.upper_games === null || m.lower_games === null ? "not played" : `${m.upper_games}-${m.lower_games}`;
  const who = m.updated_by ?? "system";
  return errors.staleMatch(who, score, toMatchSafe(m));
}

async function broadcastMatchUpdate(tournamentId: string, match: MatchRow): Promise<void> {
  const entrants = await getEntrantRows(tournamentId);
  const nameOf = makeNameLookup(entrants);
  await recordMessage(tournamentId, "match.updated", { match: toMatch(match, nameOf, true) });
}

export async function callMatch(matchId: string, version: number, ctx: MatchWriteContext): Promise<MatchRow> {
  return writeMatch(matchId, ctx, version, async (m, tx) => {
    if (!ctx.isOrganizer) throw errors.forbiddenTournament();
    if (m.state === "bye" || m.state === "not_needed" || m.state === "waiting" || !m.upper_entrant_id || !m.lower_entrant_id) {
      throw errors.ws("This match is not ready to play.");
    }
    if (m.state === "reported") throw errors.ws("You already reported this match.");
    if (m.state === "disputed") throw errors.ws("This match is disputed. An organizer will resolve it.");
    if (m.state === "confirmed" || m.state === "resolved") throw errors.ws("This match already has a result.");
    const now = isoNow();
    await tx.query(`UPDATE matches SET state = 'called', called_at = $2, version = version + 1, updated_by = $3, overdue = false WHERE id = $1`, [
      m.id,
      now,
      ctx.user.username,
    ]);
    return (await tx.one<MatchRow>(`SELECT * FROM matches WHERE id = $1`, [m.id]))!;
  });
}

export async function reportMatch(
  matchId: string,
  body: Record<string, unknown>,
  ctx: MatchWriteContext
): Promise<MatchRow> {
  const { upper_games, lower_games } = scoreFields(body["upper_games"], body["lower_games"]);
  requireWinnerRules(ctx.tournament.format, upper_games, lower_games);
  // A report from the opponent of the current reporter on a reported match is
  // their answer to it, whatever version it carries, so the version check is
  // skipped for that case and checked inside the callback otherwise.
  return writeMatch(matchId, ctx, null, async (m, tx) => {
    const me = ctx.entrantRow;
    const isOpponentAnswer =
      m.state === "reported" && me !== null && m.report !== null && m.report.by !== me.name &&
      (me.id === m.upper_entrant_id || me.id === m.lower_entrant_id);
    const sentVersion = Number(body["version"] ?? 0);
    if (!isOpponentAnswer && m.version !== sentVersion) {
      throw staleMatchError(m);
    }
    if (!ctx.isOrganizer && !(me && (me.id === m.upper_entrant_id || me.id === m.lower_entrant_id))) {
      throw errors.forbiddenReport();
    }
    if (m.state === "bye" || m.state === "not_needed" || m.state === "waiting" || !m.upper_entrant_id || !m.lower_entrant_id) {
      throw errors.ws("This match is not ready to play.");
    }
    const isEntrant = me !== null && (me.id === m.upper_entrant_id || me.id === m.lower_entrant_id);
    if (isEntrant) {
      if (m.state === "reported") {
        if (m.report && m.report.by === me.name) {
          throw errors.ws("You already reported this match.");
        }
        // opponent's answer to the current report: same score confirms, different disputes
        const now = isoNow();
        const report = m.report!;
        if (report.upper_games === upper_games && report.lower_games === lower_games) {
          return applyConfirm(tx, m, upper_games, lower_games, ctx);
        }
        return applyDispute(tx, m, upper_games, lower_games, ctx, now);
      }
      if (m.state === "disputed") throw errors.ws("This match is disputed. An organizer will resolve it.");
      if (m.state === "confirmed" || m.state === "resolved") throw errors.ws("This match already has a result.");
      const now = isoNow();
      const autoConfirm = new Date(new Date(now).getTime() + config.confirmWindowMs).toISOString();
      await tx.query(
        `UPDATE matches SET state = 'reported', upper_games = NULL, lower_games = NULL,
         report = $2, overdue = false, version = version + 1, updated_by = $3 WHERE id = $1`,
        [m.id, JSON.stringify({ by: me.name, upper_games, lower_games, reported_at: now, auto_confirm_at: autoConfirm }), ctx.user.username]
      );
      return (await tx.one<MatchRow>(`SELECT * FROM matches WHERE id = $1`, [m.id]))!;
    }
    // organizer path
    if (m.state === "disputed") throw errors.ws("This match is disputed. An organizer will resolve it.");
    if (m.state === "confirmed" || m.state === "resolved") throw errors.ws("This match already has a result.");
    return applyOrganizerResult(tx, m, upper_games, lower_games, ctx);
  });
}

async function applyOrganizerResult(
  tx: import("./db.js").Tx,
  m: MatchRow,
  u: number,
  l: number,
  ctx: MatchWriteContext
): Promise<MatchRow> {
  const now = isoNow();
  await tx.query(
    `UPDATE matches SET state = 'confirmed', upper_games = $2, lower_games = $3, winner = $4, overdue = false,
     report = COALESCE(report, $5), version = version + 1, updated_by = $6 WHERE id = $1`,
    [
      m.id,
      u,
      l,
      u > l ? "upper" : l > u ? "lower" : "draw",
      m.report ?? JSON.stringify({ by: "", upper_games: u, lower_games: l, reported_at: now, auto_confirm_at: now }),
      ctx.user.username,
    ]
  );
  const fresh = (await tx.one<MatchRow>(`SELECT * FROM matches WHERE id = $1`, [m.id]))!;
  await applyResultEffects(tx, fresh, ctx.tournament);
  return fresh;
}

async function applyConfirm(
  tx: import("./db.js").Tx,
  m: MatchRow,
  u: number,
  l: number,
  ctx: MatchWriteContext
): Promise<MatchRow> {
  await tx.query(
    `UPDATE matches SET state = 'confirmed', upper_games = $2, lower_games = $3, winner = $4, overdue = false,
     version = version + 1, updated_by = $5 WHERE id = $1`,
    [m.id, u, l, u > l ? "upper" : l > u ? "lower" : "draw", ctx.user.username]
  );
  const fresh = (await tx.one<MatchRow>(`SELECT * FROM matches WHERE id = $1`, [m.id]))!;
  await applyResultEffects(tx, fresh, ctx.tournament);
  return fresh;
}

async function applyDispute(
  tx: import("./db.js").Tx,
  m: MatchRow,
  u: number,
  l: number,
  ctx: MatchWriteContext,
  now: string
): Promise<MatchRow> {
  const report = m.report!;
  if (report.upper_games === u && report.lower_games === l) {
    return applyConfirm(tx, m, u, l, ctx);
  }
  await tx.query(
    `UPDATE matches SET state = 'disputed', dispute = $2, version = version + 1, updated_by = $3 WHERE id = $1`,
    [m.id, JSON.stringify({ by: ctx.entrantRow!.name, upper_games: u, lower_games: l, disputed_at: now }), ctx.user.username]
  );
  return (await tx.one<MatchRow>(`SELECT * FROM matches WHERE id = $1`, [m.id]))!;
}

export async function confirmMatch(matchId: string, version: number, ctx: MatchWriteContext): Promise<MatchRow> {
  return writeMatch(matchId, ctx, version, async (m, tx) => {
    if (!m.report || m.state !== "reported") throw errors.ws("There is no report to answer.");
    const isEntrant = ctx.entrantRow !== null && (ctx.entrantRow.id === m.upper_entrant_id || ctx.entrantRow.id === m.lower_entrant_id);
    if (ctx.isOrganizer && !isEntrant) {
      return applyConfirm(tx, m, m.report.upper_games, m.report.lower_games, ctx);
    }
    if (!isEntrant) throw errors.forbiddenReport();
    if (m.report.by === ctx.entrantRow!.name) throw errors.forbiddenSelfConfirm();
    return applyConfirm(tx, m, m.report.upper_games, m.report.lower_games, ctx);
  });
}

export async function disputeMatch(
  matchId: string,
  body: Record<string, unknown>,
  ctx: MatchWriteContext
): Promise<MatchRow> {
  const { upper_games, lower_games } = scoreFields(body["upper_games"], body["lower_games"]);
  requireWinnerRules(ctx.tournament.format, upper_games, lower_games);
  const sentVersion = Number(body["version"] ?? 0);
  return writeMatch(matchId, ctx, sentVersion, async (m, tx) => {
    if (!m.report || m.state !== "reported") throw errors.ws("There is no report to answer.");
    const me = ctx.entrantRow;
    const isEntrant = me !== null && (me.id === m.upper_entrant_id || me.id === m.lower_entrant_id);
    if (!ctx.isOrganizer && !isEntrant) throw errors.forbiddenReport();
    if (isEntrant && m.report.by === me.name) throw errors.forbiddenSelfConfirm();
    if (m.report.upper_games === upper_games && m.report.lower_games === lower_games) {
      throw errors.validationMsg("Change the score to dispute it.");
    }
    const now = isoNow();
    await tx.query(
      `UPDATE matches SET state = 'disputed', dispute = $2, version = version + 1, updated_by = $3 WHERE id = $1`,
      [m.id, JSON.stringify({ by: me?.name ?? ctx.user.username, upper_games, lower_games, disputed_at: now }), ctx.user.username]
    );
    return (await tx.one<MatchRow>(`SELECT * FROM matches WHERE id = $1`, [m.id]))!;
  });
}

export async function resolveMatch(
  matchId: string,
  body: Record<string, unknown>,
  ctx: MatchWriteContext
): Promise<MatchRow> {
  const { upper_games, lower_games } = scoreFields(body["upper_games"], body["lower_games"]);
  requireWinnerRules(ctx.tournament.format, upper_games, lower_games);
  const sentVersion = Number(body["version"] ?? 0);
  return writeMatch(matchId, ctx, sentVersion, async (m, tx) => {
    if (!ctx.isOrganizer) throw errors.forbiddenResolve();
    // a resolve that arrives after the dispute was already resolved
    if (m.state === "resolved" && m.dispute) {
      throw errors.alreadyResolved(m.updated_by ?? "system", m.upper_games ?? 0, m.lower_games ?? 0, toMatchSafe(m));
    }
    if (m.state !== "disputed") throw errors.ws("There is no open dispute.");
    await tx.query(
      `UPDATE matches SET state = 'resolved', upper_games = $2, lower_games = $3, winner = $4, overdue = false,
       version = version + 1, updated_by = $5 WHERE id = $1`,
      [m.id, upper_games, lower_games, upper_games > lower_games ? "upper" : lower_games > upper_games ? "lower" : "draw", ctx.user.username]
    );
    const fresh = (await tx.one<MatchRow>(`SELECT * FROM matches WHERE id = $1`, [m.id]))!;
    await applyResultEffects(tx, fresh, ctx.tournament);
    return fresh;
  });
}

function toMatchSafe(m: MatchRow): Match {
  return {
    id: m.id,
    tournament_id: m.tournament_id,
    label: m.label,
    bracket: m.bracket,
    round: m.round,
    number: m.number,
    upper: m.upper_entrant_id ? { entrant_id: m.upper_entrant_id, name: "" } : m.upper_is_bye ? { bye: true } : null,
    lower: m.lower_entrant_id ? { entrant_id: m.lower_entrant_id, name: "" } : m.lower_is_bye ? { bye: true } : null,
    state: m.state,
    upper_games: m.upper_games,
    lower_games: m.lower_games,
    winner: (m.winner as Match["winner"]) ?? null,
    report: m.report ?? null,
    dispute: m.dispute ?? null,
    called_at: m.called_at ?? null,
    version: m.version,
  };
}

async function writeMatch(
  matchId: string,
  ctx: MatchWriteContext,
  expectedVersion: number | null,
  fn: (m: MatchRow, tx: import("./db.js").Tx) => Promise<MatchRow>
): Promise<MatchRow> {
  if (ctx.tournament.state !== "running") {
    throw errors.ws(
      ctx.tournament.state === "finished"
        ? "This tournament is finished. Its results can no longer change."
        : "The tournament is not running."
    );
  }
  if (!ctx.skipRateLimit) await consumeMatchRate(ctx.user.id);
  await withTransaction(async (tx) => {
    const m = (await tx.one<MatchRow>(`SELECT * FROM matches WHERE id = $1 FOR UPDATE`, [matchId]))!;
    if (expectedVersion !== null && m.version !== expectedVersion) {
      throw staleMatchError(m);
    }
    await fn(m, tx);
  });
  const fresh = await one<MatchRow>(`SELECT * FROM matches WHERE id = $1`, [matchId]);
  await postWriteEffects(ctx.tournament, fresh!);
  return fresh!;
}

async function postWriteEffects(t: TournamentRow, match: MatchRow): Promise<void> {
  await broadcastMatchUpdate(t.id, match);
  const finished = await maybeFinish(t);
  if (!finished && (t.format === "round_robin" || t.format === "swiss")) {
    await broadcastStandings(t);
  }
  await broadcastTournament(t.id);
}

export async function broadcastStandings(t: TournamentRow): Promise<void> {
  if (t.format !== "round_robin" && t.format !== "swiss") return;
  const s = await computeStandings(t.id, t.format);
  await recordMessage(t.id, "standings.updated", { rows: s.rows });
}

/** Place the winner (and loser in double elimination) and broadcast announcements. */
export async function applyResultEffects(tx: import("./db.js").Tx, m: MatchRow, t: TournamentRow): Promise<void> {
  if (m.winner === null) return;
  const entrants = await getEntrantRows(t.id);
  const byId = new Map(entrants.map((e) => [e.id, e]));
  const winnerId = m.winner === "upper" ? m.upper_entrant_id : m.winner === "lower" ? m.lower_entrant_id : null;
  const loserId = m.winner === "upper" ? m.lower_entrant_id : m.winner === "lower" ? m.upper_entrant_id : null;
  const winnerName = winnerId ? (byId.get(winnerId)?.name ?? "") : "";
  const loserName = loserId ? (byId.get(loserId)?.name ?? "") : null;
  const now = isoNow();
  await applyAdvance(tx, m.id, {
    winner_side: (m.winner as "upper" | "lower") ?? "draw",
    winner_entrant_id: winnerId,
    loser_entrant_id: loserId,
  });
  // bye propagation on the receiving matches
  const targets = await tx.all<{ to_match: string }>(`SELECT to_match FROM feed_edges WHERE from_match = $1`, [m.id]);
  for (const t2 of targets) {
    await recomputeByeState(tx, t2.to_match, now);
  }
  // double elimination: grand final handling
  if (t.format === "double_elimination" && m.bracket === "final" && m.round === 1) {
    if (m.winner === "lower") {
      await tx.query(`UPDATE matches SET state = 'pending', updated_by = 'system', version = version + 1 WHERE id = (SELECT id FROM matches WHERE tournament_id = $1 AND bracket = 'final' AND round = 2)`, [t.id]);
      await recordMessage(t.id, "announcement", { text: "Grand final reset needed" });
    } else {
      await tx.query(`UPDATE matches SET state = 'not_needed', updated_by = 'system', version = version + 1 WHERE id = (SELECT id FROM matches WHERE tournament_id = $1 AND bracket = 'final' AND round = 2)`, [t.id]);
    }
  }
  const sentences = advanceSentences(t.format, m.label, winnerName, loserName);
  if (sentences.length > 0) await announce(t.id, sentences);
}

export async function maybeFinish(t: TournamentRow): Promise<boolean> {
  const matches = await getMatchRows(t.id);
  let done = false;
  if (t.format === "single_elimination") {
    const final = matches.find((m) => m.bracket === "main" && isLastRound(matches, m));
    done = final !== undefined && (final.state === "confirmed" || final.state === "resolved");
  } else if (t.format === "double_elimination") {
    const gf = matches.find((m) => m.bracket === "final" && m.round === 1);
    const gfr = matches.find((m) => m.bracket === "final" && m.round === 2);
    done =
      (gf !== undefined && gf.winner === "upper") ||
      (gfr !== undefined && (gfr.state === "confirmed" || gfr.state === "resolved"));
  } else if (t.format === "round_robin") {
    done = matches.every((m) => hasResult(m));
  } else {
    // Swiss finishes when every match of the last planned round has a result
    const latest = Math.max(...matches.map((m) => m.round), 0);
    done = latest > 0 && latest === (t.swiss_rounds ?? 0) && matches.filter((m) => m.round === latest).every(hasResult);
  }
  if (!done) return false;
  await finishTournament(t.id);
  return true;
}

function isLastRound(matches: MatchRow[], m: MatchRow): boolean {
  return !matches.some((x) => x.bracket === "main" && x.round === m.round + 1);
}

function hasResult(m: MatchRow): boolean {
  return m.state === "confirmed" || m.state === "resolved" || m.state === "bye" || m.state === "not_needed";
}

export async function finishTournament(tournamentId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const t = (await getTournamentRow(tournamentId))!;
    if (t.state === "finished") return;
    await tx.query(`UPDATE tournaments SET state = 'finished', finished_at = $2 WHERE id = $1`, [tournamentId, isoNow()]);
  });
  const t = (await getTournamentRow(tournamentId))!;
  await broadcastTournament(tournamentId);
  const champion = await computeChampion(t);
  if (champion) await announce(tournamentId, [`${champion} wins the tournament`]);
  await writeHistory(t);
}

async function computeChampion(t: TournamentRow): Promise<string | null> {
  const matches = await getMatchRows(t.id);
  if (t.format === "single_elimination" || t.format === "double_elimination") {
    let finalMatch: MatchRow | undefined;
    if (t.format === "double_elimination") {
      const gfr = matches.find((m) => m.bracket === "final" && m.round === 2);
      finalMatch = gfr?.state === "not_needed" ? matches.find((m) => m.bracket === "final" && m.round === 1) : gfr;
    } else {
      finalMatch = matches.find((m) => m.bracket === "main" && isLastRound(matches, m));
    }
    if (!finalMatch || !finalMatch.winner || finalMatch.winner === "draw") return null;
    const winnerId = finalMatch.winner === "upper" ? finalMatch.upper_entrant_id : finalMatch.lower_entrant_id;
    const e = await one<{ name: string }>(`SELECT name FROM entrants WHERE id = $1`, [winnerId]);
    return e?.name ?? null;
  }
  const s = await computeStandings(t.id, t.format);
  return s.rows[0]?.name ?? null;
}

/** At finish, the server writes one history row per linked player, exactly once. */
export async function writeHistory(t: TournamentRow): Promise<void> {
  const placements = await computePlacements(t);
  const entrants = await getEntrantRows(t.id);
  const byId = new Map(entrants.map((e) => [e.id, e]));
  const finishedOn = formatFinishDate(t);
  for (const p of placements) {
    const e = byId.get(p.entrant_id);
    if (!e?.username) continue;
    await withTransaction(async (tx) => {
      const existing = await tx.one<{ id: string }>(`SELECT id FROM history_rows WHERE user_id = (SELECT id FROM users WHERE username = $1) AND tournament_id = $2`, [e.username, t.id]);
      if (existing) return;
      await tx.query(
        `INSERT INTO history_rows (id, user_id, tournament_id, tournament_name, place, field_size, finished_on)
         VALUES ($1, (SELECT id FROM users WHERE username = $2), $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, tournament_id) DO NOTHING`,
        [newId(), e.username, t.id, t.name, p.place, t.field_size ?? entrants.length, finishedOn]
      );
    });
  }
}

function formatFinishDate(t: TournamentRow): string {
  // YYYY-MM-DD in the tournament's time zone
  const finished = t.finished_at ?? isoNow();
  const date = new Date(finished);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: t.time_zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return parts;
}

export interface Placement {
  entrant_id: string;
  place: number;
}

export async function computePlacements(t: TournamentRow): Promise<Placement[]> {
  const matches = await getMatchRows(t.id);
  if (t.format === "single_elimination" || t.format === "double_elimination") {
    // Entrants knocked out in the same match round share a place, equal to 1
    // plus the number of entrants knocked out later or never.
    let championId: string | null = null;
    if (t.format === "single_elimination") {
      const final = matches.find((m) => m.bracket === "main" && isLastRound(matches, m));
      championId = final?.winner === "upper" ? final.upper_entrant_id : final?.winner === "lower" ? final.lower_entrant_id : null;
    } else {
      const gfr = matches.find((m) => m.bracket === "final" && m.round === 2);
      const gf = matches.find((m) => m.bracket === "final" && m.round === 1);
      const finalMatch = gfr?.state === "not_needed" ? gf : gfr;
      championId =
        finalMatch?.winner === "upper"
          ? finalMatch.upper_entrant_id
          : finalMatch?.winner === "lower"
            ? finalMatch.lower_entrant_id
            : null;
    }
    // The later a loss, the better the place. A loss's stage rank: grand final
    // reset 4, grand final 3, losers rounds 2, main (winners) rounds 1.
    const rankOfLoss = (m: MatchRow): [number, number] => {
      if (m.bracket === "final") return [m.round === 2 ? 4 : 3, m.round];
      if (m.bracket === "losers") return [2, m.round];
      return [1, m.round];
    };
    const lossEntries: { entrant_id: string; sortKey: [number, number] }[] = [];
    for (const m of matches) {
      if (m.winner === null || m.winner === "draw" || m.state === "bye") continue;
      const loserId = m.winner === "upper" ? m.lower_entrant_id : m.upper_entrant_id;
      if (!loserId || loserId === championId) continue;
      lossEntries.push({ entrant_id: loserId, sortKey: rankOfLoss(m) });
    }
    lossEntries.sort((a, b) => b.sortKey[0] - a.sortKey[0] || b.sortKey[1] - a.sortKey[1]);
    const out: Placement[] = [];
    let place = 2;
    let i = 0;
    while (i < lossEntries.length) {
      let j = i;
      while (j < lossEntries.length && sameKey(lossEntries[j]!.sortKey, lossEntries[i]!.sortKey)) j++;
      for (let k = i; k < j; k++) out.push({ entrant_id: lossEntries[k]!.entrant_id, place });
      place += j - i;
      i = j;
    }
    if (championId) out.push({ entrant_id: championId, place: 1 });
    return out;
  }
  const s = await computeStandings(t.id, t.format);
  return s.rows.map((r) => ({ entrant_id: r.entrant_id, place: r.place }));
}

function sameKey(a: [number, number], b: [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
