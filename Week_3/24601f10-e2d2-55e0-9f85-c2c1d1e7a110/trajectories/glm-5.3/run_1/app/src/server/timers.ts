import { all, one, withTransaction } from "./db.js";
import { config } from "./config.js";
import { serverNowMs } from "./auth.js";
import * as T from "./tournaments.js";
import { recordMessage } from "./live.js";
import { broadcastStandings, maybeFinish } from "./matches.js";

/**
 * Apply due deadlines at least once a second and immediately after a clock
 * move: auto-confirm of reported matches, overdue flags, check-in close.
 */
export async function runDeadlines(): Promise<void> {
  const now = serverNowMs();
  // 1. auto-confirm reported matches whose confirm window has passed
  const due = await all<{ id: string; tournament_id: string }>(
    `SELECT id, tournament_id FROM matches
     WHERE state = 'reported' AND report->>'auto_confirm_at' IS NOT NULL
       AND (report->>'auto_confirm_at')::timestamptz <= to_timestamp($1/1000.0)`,
    [now]
  );
  for (const m of due) {
    await autoConfirm(m.id, m.tournament_id);
  }
  // 2. check-in close at the close time
  const closing = await all<{ id: string }>(
    `SELECT id FROM tournaments WHERE state = 'checkin_open' AND checkin_closes_at IS NOT NULL AND checkin_closes_at <= to_timestamp($1/1000.0)`,
    [now]
  );
  for (const c of closing) {
    const t = await T.getTournamentRow(c.id);
    if (!t) continue;
    await withTransaction(async (tx) => {
      await tx.query(`UPDATE tournaments SET state = 'checkin_closed' WHERE id = $1`, [c.id]);
    });
    await recordMessage(c.id, "announcement", { text: "Check-in is closed." });
    await T.broadcastTournament(c.id);
  }
  // 3. overdue flags: called matches past the match limit, and Swiss rounds past the round time
  await applyOverdue();
}

async function autoConfirm(matchId: string, tournamentId: string): Promise<void> {
  const t = await T.getTournamentRow(tournamentId);
  if (!t) return;
  const updated = await withTransaction(async (tx) => {
    const m = await tx.one<{ id: string; report: { upper_games: number; lower_games: number }; state: string }>(
      `SELECT id, report, state FROM matches WHERE id = $1 FOR UPDATE`,
      [matchId]
    );
    if (!m || m.state !== "reported" || !m.report) return null;
    const u = m.report.upper_games;
    const l = m.report.lower_games;
    await tx.query(
      `UPDATE matches SET state = 'confirmed', upper_games = $2, lower_games = $3, winner = $4,
       overdue = false, version = version + 1, updated_by = 'system' WHERE id = $1`,
      [matchId, u, l, u > l ? "upper" : l > u ? "lower" : "draw"]
    );
    return { u, l };
  });
  if (!updated) return;
  // advance and broadcast through the same effects as a manual confirm
  const { applyResultEffects } = await import("./matches.js");
  const fresh = await one<import("./brackets.js").MatchRow>(`SELECT * FROM matches WHERE id = $1`, [matchId]);
  if (!fresh) return;
  await withTransaction(async (tx) => {
    await applyResultEffects(tx, fresh, t);
  });
  const nameOf = T.makeNameLookup(await T.getEntrantRows(tournamentId));
  await recordMessage(tournamentId, "match.updated", { match: T.toMatch(fresh, nameOf, true) });
  await broadcastStandings(t);
  await maybeFinish(t);
  await T.broadcastTournament(tournamentId);
}

async function applyOverdue(): Promise<void> {
  const now = serverNowMs();
  // called matches past the match limit
  const calledDue = await all<{ id: string; tournament_id: string }>(
    `SELECT id, tournament_id FROM matches
     WHERE state = 'called' AND called_at IS NOT NULL AND overdue = false
       AND called_at <= to_timestamp($1/1000.0) - ($2/1000.0) * interval '1 second'`,
    [now, config.matchLimitMs]
  );
  for (const m of calledDue) {
    await setOverdue(m.id, m.tournament_id, true);
  }
  const calledClear = await all<{ id: string; tournament_id: string }>(
    `SELECT id, tournament_id FROM matches
     WHERE state = 'called' AND called_at IS NOT NULL AND overdue = true
       AND called_at > to_timestamp($1/1000.0) - ($2/1000.0) * interval '1 second'`,
    [now, config.matchLimitMs]
  );
  for (const m of calledClear) {
    await setOverdue(m.id, m.tournament_id, false);
  }
  // Swiss: every pending or called match of the current round past the round time
  const swiss = await all<{ id: string }>(
    `SELECT DISTINCT t.id FROM tournaments t WHERE t.state = 'running' AND t.format = 'swiss'`
  );
  for (const s of swiss) {
    const t = await T.getTournamentRow(s.id);
    if (!t) continue;
    const matches = await T.getMatchRows(s.id);
    const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
    const latest = rounds[rounds.length - 1] ?? 0;
    if (latest === 0) continue;
    const roundMatches = matches.filter((m) => m.round === latest);
    const pairedAt = roundMatches[0]?.paired_at;
    if (!pairedAt) continue;
    const elapsed = now - new Date(pairedAt).getTime();
    const due = elapsed >= config.swissRoundMs;
    for (const m of roundMatches) {
      if (m.state !== "pending" && m.state !== "called") continue;
      if (m.overdue !== due) {
        await setOverdue(m.id, s.id, due);
      }
    }
  }
}

/** Overdue never changes the match's version or updated_by. */
async function setOverdue(matchId: string, tournamentId: string, overdue: boolean): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.query(`UPDATE matches SET overdue = $2 WHERE id = $1`, [matchId, overdue]);
  });
  const fresh = await one<import("./brackets.js").MatchRow>(`SELECT * FROM matches WHERE id = $1`, [matchId]);
  if (!fresh) return;
  const nameOf = T.makeNameLookup(await T.getEntrantRows(tournamentId));
  // organizer-only change: send to organizers only
  await recordMessage(tournamentId, "match.updated", { match: T.toMatch(fresh, nameOf, true), organizer_only: true });
}
