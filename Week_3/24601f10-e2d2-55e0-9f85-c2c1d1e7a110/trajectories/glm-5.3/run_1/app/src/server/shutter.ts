import { withTransaction, one } from "./db.js";
import { errors } from "./errors.js";
import { isoNow } from "./auth.js";
import { randomBytes } from "node:crypto";
import type { MatchRow } from "./brackets.js";
import { applyAdvance, recomputeByeState } from "./brackets.js";
import {
  getEntrantRows,
  getMatchRows,
  makeNameLookup,
  toMatch,
  broadcastTournament,
  type TournamentRow,
} from "./tournaments.js";
import { recordMessage } from "./live.js";
import { broadcastStandings } from "./matches.js";

export interface Dependents {
  match_id: string;
  label: string;
  state: string;
  distance: number;
  bracketRank: number;
  round: number;
  number: number;
}

/** Compute the dependent set of a proposed result change, in reset order. */
export function computeDependentSet(
  edited: MatchRow,
  matches: MatchRow[],
  edges: { from_match: string; to_match: string; side: string; kind: string }[]
): Dependents[] {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const feedsOf = new Map<string, { to_match: string; side: string; kind: string }[]>();
  for (const e of edges) {
    const g = feedsOf.get(e.from_match) ?? [];
    g.push(e);
    feedsOf.set(e.from_match, g);
  }
  // slot provenance: which edge feeds each (match, side)
  const slotSource = new Map<string, { from: string; kind: string }>();
  for (const e of edges) {
    slotSource.set(`${e.to_match}:${e.side}`, { from: e.from_match, kind: e.kind });
  }

  const set = new Map<string, { distance: number; bracketRank: number; round: number; number: number; label: string; state: string }>();
  const propagate = (matchId: string, distance: number): void => {
    const feeds = feedsOf.get(matchId) ?? [];
    for (const f of feeds) {
      const target = byId.get(f.to_match);
      if (!target) continue;
      if (set.has(target.id)) continue;
      const source = slotSource.get(`${target.id}:${f.side}`);
      if (!source) continue;
      // A match joins the set when the slot fed from the edited match or from a
      // match already in the set currently holds an entrant or a bye.
      const holds = f.side === "upper" ? target.upper_entrant_id !== null || target.upper_is_bye : target.lower_entrant_id !== null || target.lower_is_bye;
      if (!holds) continue;
      set.set(target.id, {
        distance,
        bracketRank: bracketRankOf(target.bracket),
        round: target.round,
        number: target.number,
        label: target.label,
        state: target.state,
      });
      propagate(target.id, distance + 1);
    }
  };
  propagate(edited.id, 1);
  return [...set.entries()]
    .map(([match_id, v]) => ({ match_id, ...v }))
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        a.bracketRank - b.bracketRank ||
        a.round - b.round ||
        a.number - b.number
    );
}

export function bracketRankOf(b: string): number {
  return b === "winners" ? 0 : b === "losers" ? 1 : b === "final" ? 2 : 3;
}

export interface PreviewResult {
  dependents: { match_id: string; label: string; state: string }[];
  count: number;
  confirmed_count: number;
  preview_token: string;
}

export async function editPreview(
  matchId: string,
  body: { upper_games: number; lower_games: number; version: number },
  tournament: TournamentRow,
  isOrganizer: boolean
): Promise<PreviewResult> {
  if (!isOrganizer) throw errors.forbiddenTournament();
  if (tournament.state !== "running") {
    throw errors.ws(
      tournament.state === "finished"
        ? "This tournament is finished. Its results can no longer change."
        : "The tournament is not running."
    );
  }
  const matches = await getMatchRows(tournament.id);
  const edited = matches.find((m) => m.id === matchId);
  if (!edited) throw errors.notFoundTournament();
  if (edited.state !== "confirmed" && edited.state !== "resolved") {
    throw errors.ws("Only confirmed or resolved results can be edited.");
  }
  const edges = await getEdges(tournament.id);
  const winnerChanges = winnerDiffers(edited, body.upper_games, body.lower_games);
  let deps: Dependents[] = [];
  if (winnerChanges) {
    deps = computeDependentSet(edited, matches, edges);
  }
  const versions: Record<string, number> = {};
  versions[edited.id] = edited.version;
  for (const d of deps) versions[d.match_id] = byIdVersion(matches, d.match_id);
  const token = randomBytes(16).toString("base64url");
  await withTransaction(async (tx) => {
    await tx.query(`DELETE FROM previews WHERE created_at < now() - interval '1 hour'`);
    await tx.query(
      `INSERT INTO previews (token, tournament_id, match_id, upper_games, lower_games, dependents, versions) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [token, tournament.id, matchId, body.upper_games, body.lower_games, JSON.stringify(deps.map((d) => d.match_id)), JSON.stringify(versions)]
    );
  });
  const confirmedCount = deps.filter((d) => {
    const m = matches.find((x) => x.id === d.match_id);
    return m?.state === "confirmed" || m?.state === "resolved";
  }).length;
  return {
    dependents: deps.map((d) => ({ match_id: d.match_id, label: d.label, state: d.state })),
    count: deps.length,
    confirmed_count: confirmedCount,
    preview_token: token,
  };
}

function byIdVersion(matches: MatchRow[], id: string): number {
  return matches.find((m) => m.id === id)?.version ?? 0;
}

function winnerDiffers(edited: MatchRow, u: number, l: number): boolean {
  const current = edited.winner;
  const proposed = u > l ? "upper" : l > u ? "lower" : "draw";
  return current !== proposed;
}

export async function getEdges(
  tournamentId: string
): Promise<{ from_match: string; to_match: string; side: string; kind: string }[]> {
  const { all } = await import("./db.js");
  return all(`SELECT from_match, to_match, side, kind FROM feed_edges WHERE tournament_id = $1`, [tournamentId]);
}

export async function commitEdit(
  matchId: string,
  body: { upper_games: number; lower_games: number; preview_token: string },
  tournament: TournamentRow,
  isOrganizer: boolean,
  username: string
): Promise<{ match: MatchRow; reset: string[] }> {
  if (!isOrganizer) throw errors.forbiddenTournament();
  if (tournament.state !== "running") {
    throw errors.ws(
      tournament.state === "finished"
        ? "This tournament is finished. Its results can no longer change."
        : "The tournament is not running."
    );
  }
  const preview = await one<{
    token: string;
    tournament_id: string;
    match_id: string;
    upper_games: number;
    lower_games: number;
    dependents: string[];
    versions: Record<string, number>;
  }>(`SELECT * FROM previews WHERE token = $1`, [body.preview_token]);
  if (!preview || preview.tournament_id !== tournament.id || preview.match_id !== matchId) {
    throw errors.stalePreview();
  }
  if (preview.upper_games !== body.upper_games || preview.lower_games !== body.lower_games) {
    throw errors.stalePreview();
  }
  const matches = await getMatchRows(tournament.id);
  const edited = matches.find((m) => m.id === matchId);
  if (!edited) throw errors.notFoundTournament();
  if (edited.state !== "confirmed" && edited.state !== "resolved") {
    throw errors.ws("Only confirmed or resolved results can be edited.");
  }
  // recompute the set and versions
  const edges = await getEdges(tournament.id);
  const winnerChanges = winnerDiffers(edited, body.upper_games, body.lower_games);
  let deps: Dependents[] = [];
  if (winnerChanges) deps = computeDependentSet(edited, matches, edges);
  const previewIds = preview.dependents;
  const currentIds = deps.map((d) => d.match_id);
  if (JSON.stringify(previewIds) !== JSON.stringify(currentIds)) {
    throw errors.stalePreview();
  }
  for (const [id, v] of Object.entries(preview.versions)) {
    const m = matches.find((x) => x.id === id);
    if (!m || m.version !== v) throw errors.stalePreview();
  }
  const now = isoNow();
  const resetIds: string[] = [];
  await withTransaction(async (tx) => {
    // 1. every match in the set loses entrants that came through a fed slot
    for (const d of deps) {
      const target = matches.find((x) => x.id === d.match_id)!;
      const upperFed = edges.find((e) => e.to_match === target.id && e.side === "upper");
      const lowerFed = edges.find((e) => e.to_match === target.id && e.side === "lower");
      const upperFromSet = upperFed && (upperFed.from_match === edited.id || previewIds.includes(upperFed.from_match));
      const lowerFromSet = lowerFed && (lowerFed.from_match === edited.id || previewIds.includes(lowerFed.from_match));
      const upperCol = upperFromSet ? "upper_entrant_id = NULL, upper_is_bye = false" : "";
      const lowerCol = lowerFromSet ? "lower_entrant_id = NULL, lower_is_bye = false" : "";
      const cols = [upperCol, lowerCol].filter(Boolean).join(", ");
      const resetState = target.bracket === "final" && target.round === 2 ? "waiting" : "pending";
      await tx.query(
        `UPDATE matches SET ${cols.length > 0 ? cols + ", " : ""}report = NULL, dispute = NULL, upper_games = NULL, lower_games = NULL,
         winner = NULL, state = $2, version = version + 1, updated_by = $3 WHERE id = $1`,
        [target.id, resetState, "system"]
      );
      resetIds.push(target.id);
    }
    // 2. the edited match takes the new score
    await tx.query(
      `UPDATE matches SET upper_games = $2, lower_games = $3, winner = $4, version = version + 1, updated_by = $5 WHERE id = $1`,
      [matchId, body.upper_games, body.lower_games, body.upper_games > body.lower_games ? "upper" : body.lower_games > body.upper_games ? "lower" : "draw", username]
    );
    const fresh = (await tx.one<MatchRow>(`SELECT * FROM matches WHERE id = $1`, [matchId]))!;
    const loserId = fresh.winner === "upper" ? fresh.lower_entrant_id : fresh.winner === "lower" ? fresh.upper_entrant_id : null;
    await applyAdvance(tx, matchId, {
      winner_side: (fresh.winner as "upper" | "lower") ?? "draw",
      winner_entrant_id: fresh.winner === "upper" ? fresh.upper_entrant_id : fresh.winner === "lower" ? fresh.lower_entrant_id : null,
      loser_entrant_id: loserId,
    });
    const targets = await tx.all<{ to_match: string }>(`SELECT to_match FROM feed_edges WHERE from_match = $1`, [matchId]);
    for (const t of targets) {
      await recomputeByeState(tx, t.to_match, now);
    }
    await tx.query(`DELETE FROM previews WHERE token = $1`, [body.preview_token]);
  });
  const fresh = (await one<MatchRow>(`SELECT * FROM matches WHERE id = $1`, [matchId]))!;
  // 3. broadcast: matches.reset with the set in reset order, then match.updated
  const allMatches = await getMatchRows(tournament.id);
  const entrants = await getEntrantRows(tournament.id);
  const nameOf = makeNameLookup(entrants);
  if (resetIds.length > 0) {
    const resetRows = resetIds.map((id) => allMatches.find((m) => m.id === id)!);
    await recordMessage(tournament.id, "matches.reset", {
      matches: resetRows.map((m) => toMatch(m, nameOf, true)),
    });
  }
  await recordMessage(tournament.id, "match.updated", { match: toMatch(fresh, nameOf, true) });
  if (resetIds.length > 0) {
    await recordMessage(tournament.id, "announcement", {
      text: resetIds.length === 1 ? "1 match reset" : `${resetIds.length} matches reset`,
    });
  }
  await broadcastStandings(tournament);
  await broadcastTournament(tournament.id);
  return { match: fresh, reset: resetIds };
}
