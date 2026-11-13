import type { Tx } from "./db.js";
import { newId } from "./auth.js";
import type { Match, SlotValue, BracketName, MatchState } from "../shared/types.js";
import { bracketSize, slotOrder } from "../shared/bracket.js";

export interface MatchRow {
  id: string;
  tournament_id: string;
  bracket: BracketName;
  round: number;
  number: number;
  label: string;
  upper_entrant_id: string | null;
  upper_is_bye: boolean;
  lower_entrant_id: string | null;
  lower_is_bye: boolean;
  state: MatchState;
  upper_games: number | null;
  lower_games: number | null;
  winner: string | null;
  report: Match["report"];
  dispute: Match["dispute"];
  called_at: string | null;
  overdue: boolean;
  version: number;
  updated_by: string | null;
  paired_at: string | null;
}

export interface EntrantRow {
  id: string;
  tournament_id: string;
  name: string;
  seed: number;
  username: string | null;
  checked_in: boolean;
}

export interface FeedEdge {
  from_match: string;
  to_match: string;
  side: "upper" | "lower";
  kind: "winner" | "loser";
}

export function matchLabel(bracket: BracketName, round: number, number: number): string {
  if (bracket === "final") {
    return round === 1 ? "Grand final" : "Grand final reset";
  }
  if (bracket === "winners") return `Winners round ${round}, match ${number}`;
  if (bracket === "losers") return `Losers round ${round}, match ${number}`;
  return `Round ${round}, match ${number}`;
}

async function insertMatch(
  tx: Tx,
  tournamentId: string,
  bracket: BracketName,
  round: number,
  number: number,
  upper: SlotValue,
  lower: SlotValue,
  pairedAt: string | null
): Promise<string> {
  const id = newId();
  await tx.query(
    `INSERT INTO matches (id, tournament_id, bracket, round, number, label, upper_entrant_id, upper_is_bye, lower_entrant_id, lower_is_bye, state, paired_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      tournamentId,
      bracket,
      round,
      number,
      matchLabel(bracket, round, number),
      upper && "entrant_id" in upper ? upper.entrant_id : null,
      upper !== null && "bye" in upper,
      lower && "entrant_id" in lower ? lower.entrant_id : null,
      lower !== null && "bye" in lower,
      "pending",
      pairedAt,
    ]
  );
  return id;
}

function byeSlot(): SlotValue {
  return { bye: true };
}

function seedSlot(entrant: EntrantRow | undefined): SlotValue {
  if (!entrant) return byeSlot();
  return { entrant_id: entrant.id, name: entrant.name };
}

export interface FeedTarget {
  to_match: string;
  side: "upper" | "lower";
}

/** Build a single-elimination bracket. Returns matches inserted with feed edges. */
export async function buildSingleElimination(
  tx: Tx,
  tournamentId: string,
  entrants: EntrantRow[],
  nowIso: string
): Promise<void> {
  const size = bracketSize(entrants.length);
  const slots = slotOrder(size);
  const bySeed = new Map(entrants.map((e) => [e.seed, e]));
  const rounds = Math.log2(size);
  const matchIds: string[][] = [];
  for (let r = 1; r <= rounds; r++) {
    const count = size / Math.pow(2, r);
    matchIds.push([]);
    for (let m = 1; m <= count; m++) {
      let upper: SlotValue = null;
      let lower: SlotValue = null;
      if (r === 1) {
        upper = seedSlot(bySeed.get(slots[2 * m - 2] ?? 0));
        lower = seedSlot(bySeed.get(slots[2 * m - 1] ?? 0));
      }
      const id = await insertMatch(tx, tournamentId, "main", r, m, upper, lower, nowIso);
      matchIds[r - 1]!.push(id);
    }
  }
  for (let r = 1; r < rounds; r++) {
    for (let m = 1; m <= matchIds[r - 1]!.length; m++) {
      const from = matchIds[r - 1]![m - 1]!;
      const to = matchIds[r]![Math.ceil(m / 2) - 1]!;
      const side = m % 2 === 1 ? "upper" : "lower";
      await tx.query(
        `INSERT INTO feed_edges (tournament_id, from_match, to_match, side, kind) VALUES ($1,$2,$3,$4,'winner')
         ON CONFLICT (tournament_id, from_match, to_match, side) DO NOTHING`,
        [tournamentId, from, to, side]
      );
    }
  }
  // A bye match is won by its entrant at start and that entrant is placed in round 2.
  for (let m = 1; m <= size / 2; m++) {
    const upperSlot = bySeed.get(slots[2 * m - 2] ?? 0);
    const lowerSlot = bySeed.get(slots[2 * m - 1] ?? 0);
    if (upperSlot && !lowerSlot) {
      await autoByeWin(tx, matchIds[0]![m - 1]!, "upper", upperSlot);
    } else if (!upperSlot && lowerSlot) {
      await autoByeWin(tx, matchIds[0]![m - 1]!, "lower", lowerSlot);
    }
  }
}

async function autoByeWin(
  tx: Tx,
  matchId: string,
  winnerSide: "upper" | "lower",
  entrant: EntrantRow
): Promise<void> {
  await tx.query(`UPDATE matches SET state = 'bye', winner = $2, upper_games = NULL, lower_games = NULL, updated_by = 'system', version = version + 1 WHERE id = $1`, [
    matchId,
    winnerSide,
  ]);
  // push the entrant into the next slot
  await applyAdvance(tx, matchId, { winner_side: winnerSide, winner_entrant_id: entrant.id, loser_entrant_id: null });
}

export interface AdvanceInfo {
  winner_side: "upper" | "lower" | "draw";
  winner_entrant_id: string | null;
  loser_entrant_id: string | null;
}

export async function applyAdvance(tx: Tx, matchId: string, adv: AdvanceInfo): Promise<void> {
  const edges = await tx.all<{ to_match: string; side: "upper" | "lower"; kind: string }>(
    `SELECT to_match, side, kind FROM feed_edges WHERE from_match = $1`,
    [matchId]
  );
  for (const e of edges) {
    const col = e.side === "upper" ? "upper_entrant_id" : "lower_entrant_id";
    if (e.kind === "slot_upper" || e.kind === "slot_lower") {
      // slot copy: the grand final reset keeps the same entrants in the same sides
      const src = e.kind === "slot_upper" ? "upper_entrant_id" : "lower_entrant_id";
      const row = await tx.one<{ occupant: string | null }>(`SELECT ${src} as occupant FROM matches WHERE id = $1`, [
        matchId,
      ]);
      await tx.query(`UPDATE matches SET ${col} = $2 WHERE id = $1`, [e.to_match, row?.occupant ?? null]);
    } else if (e.kind === "winner" && adv.winner_entrant_id) {
      await tx.query(`UPDATE matches SET ${col} = $2 WHERE id = $1`, [e.to_match, adv.winner_entrant_id]);
    } else if (e.kind === "loser" && adv.loser_entrant_id) {
      await tx.query(`UPDATE matches SET ${col} = $2 WHERE id = $1`, [e.to_match, adv.loser_entrant_id]);
    }
  }
}

/** Build a double-elimination bracket. */
export async function buildDoubleElimination(
  tx: Tx,
  tournamentId: string,
  entrants: EntrantRow[],
  nowIso: string
): Promise<void> {
  const size = bracketSize(entrants.length);
  const slots = slotOrder(size);
  const bySeed = new Map(entrants.map((e) => [e.seed, e]));
  const wRounds = Math.log2(size);
  const winners: string[][] = [];
  const losers: string[][] = [];
  for (let r = 1; r <= wRounds; r++) {
    const count = size / Math.pow(2, r);
    winners.push([]);
    for (const m of Array.from({ length: count }, (_, i) => i + 1)) {
      let upper: SlotValue = null;
      let lower: SlotValue = null;
      if (r === 1) {
        upper = seedSlot(bySeed.get(slots[2 * m - 2] ?? 0));
        lower = seedSlot(bySeed.get(slots[2 * m - 1] ?? 0));
      }
      const id = await insertMatch(tx, tournamentId, "winners", r, m, upper, lower, nowIso);
      winners[r - 1]!.push(id);
    }
  }
  // Losers rounds: for winners rounds k >= 2, the drop-in round is losers round 2k-2.
  // Losers round structure: L1 (from W1 losers), then 2, 3, ... up to 2*wRounds-2.
  const lRounds = 2 * wRounds - 2;
  for (let r = 1; r <= lRounds; r++) {
    // Losers rounds halve every two rounds: L1 and L2 have size/4 matches,
    // L3 and L4 size/8, and so on. A drop-in round (even) has as many matches
    // as the losers round before it.
    const count = size / Math.pow(2, Math.ceil(r / 2) + 1);
    losers.push([]);
    for (const m of Array.from({ length: count }, (_, i) => i + 1)) {
      const id = await insertMatch(tx, tournamentId, "losers", r, m, null, null, nowIso);
      losers[r - 1]!.push(id);
    }
  }
  const gf = await insertMatch(tx, tournamentId, "final", 1, 1, null, null, nowIso);
  const gfr = await insertMatch(tx, tournamentId, "final", 2, 1, null, null, nowIso);
  await tx.query(`UPDATE matches SET state = 'waiting' WHERE id = $1`, [gfr]);
  // feed edges: winners
  for (let r = 1; r < wRounds; r++) {
    for (let m = 1; m <= winners[r - 1]!.length; m++) {
      const from = winners[r - 1]![m - 1]!;
      const to = winners[r]![Math.ceil(m / 2) - 1]!;
      const side = m % 2 === 1 ? "upper" : "lower";
      await tx.query(
        `INSERT INTO feed_edges (tournament_id, from_match, to_match, side, kind) VALUES ($1,$2,$3,$4,'winner')`,
        [tournamentId, from, to, side]
      );
    }
  }
  // winners finals winner -> grand final upper
  await tx.query(
    `INSERT INTO feed_edges (tournament_id, from_match, to_match, side, kind) VALUES ($1,$2,$3,'upper','winner')`,
    [tournamentId, winners[wRounds - 1]![0]!, gf]
  );
  // The reset keeps the same two entrants in the same sides: the grand final's
  // upper slot feeds the reset's upper slot, its lower the reset's lower.
  await tx.query(
    `INSERT INTO feed_edges (tournament_id, from_match, to_match, side, kind) VALUES ($1,$2,$3,'upper','slot_upper')`,
    [tournamentId, gf, gfr]
  );
  await tx.query(
    `INSERT INTO feed_edges (tournament_id, from_match, to_match, side, kind) VALUES ($1,$2,$3,'lower','slot_lower')`,
    [tournamentId, gf, gfr]
  );
  // losers of winners round 1 -> losers round 1
  for (let m = 1; m <= winners[0]!.length; m++) {
    const from = winners[0]![m - 1]!;
    const to = losers[0]![Math.ceil(m / 2) - 1]!;
    const side = m % 2 === 1 ? "upper" : "lower";
    await tx.query(
      `INSERT INTO feed_edges (tournament_id, from_match, to_match, side, kind) VALUES ($1,$2,$3,$4,'loser')`,
      [tournamentId, from, to, side]
    );
  }
  // for k >= 2, losers of winners round k drop into losers round 2k-2 (reversed match order).
  for (let k = 2; k <= wRounds; k++) {
    const M = winners[k - 1]!.length;
    const dropRound = 2 * k - 2;
    for (let m = 1; m <= M; m++) {
      const from = winners[k - 1]![m - 1]!;
      const to = losers[dropRound - 1]![M - m]!;
      await tx.query(
        `INSERT INTO feed_edges (tournament_id, from_match, to_match, side, kind) VALUES ($1,$2,$3,'lower','loser')`,
        [tournamentId, from, to]
      );
    }
  }
  // winners within losers bracket
  for (let r = 1; r < lRounds; r++) {
    for (let m = 1; m <= losers[r - 1]!.length; m++) {
      const from = losers[r - 1]![m - 1]!;
      const isDropIn = (r + 1) % 2 === 0 && r + 1 >= 2;
      const toIdx = isDropIn ? m - 1 : Math.ceil(m / 2) - 1;
      const to = losers[r]![toIdx]!;
      const side: "upper" | "lower" = (r + 1) % 2 === 0 ? "upper" : m % 2 === 1 ? "upper" : "lower";
      await tx.query(
        `INSERT INTO feed_edges (tournament_id, from_match, to_match, side, kind) VALUES ($1,$2,$3,$4,'winner')`,
        [tournamentId, from, to, side]
      );
    }
  }
  // losers final winner -> grand final lower
  await tx.query(
    `INSERT INTO feed_edges (tournament_id, from_match, to_match, side, kind) VALUES ($1,$2,$3,'lower','winner')`,
    [tournamentId, losers[lRounds - 1]![0]!, gf]
  );
  // initial bye propagation for round 1 bye matches
  for (let m = 1; m <= winners[0]!.length; m++) {
    const upperSlot = bySeed.get(slots[2 * m - 2] ?? 0);
    const lowerSlot = bySeed.get(slots[2 * m - 1] ?? 0);
    if (upperSlot && !lowerSlot) {
      await autoByeWin(tx, winners[0]![m - 1]!, "upper", upperSlot);
    } else if (!upperSlot && lowerSlot) {
      await autoByeWin(tx, winners[0]![m - 1]!, "lower", lowerSlot);
    } else if (!upperSlot && !lowerSlot) {
      // two byes: not needed, passes a bye forward
      await tx.query(
        `UPDATE matches SET state = 'not_needed', winner = NULL, upper_is_bye = true, lower_is_bye = true, updated_by = 'system', version = version + 1 WHERE id = $1`,
        [winners[0]![m - 1]!]
      );
      await propagateBye(tx, winners[0]![m - 1]!, nowIso);
    }
  }
}

async function propagateBye(tx: Tx, matchId: string, nowIso: string): Promise<void> {
  const edges = await tx.all<{ to_match: string; side: "upper" | "lower"; kind: string }>(
    `SELECT to_match, side, kind FROM feed_edges WHERE from_match = $1`,
    [matchId]
  );
  for (const e of edges) {
    const col = e.side === "upper" ? "upper_entrant_id" : "lower_entrant_id";
    const byeCol = e.side === "upper" ? "upper_is_bye" : "lower_is_bye";
    if (e.kind === "winner" || e.kind === "loser") {
      await tx.query(`UPDATE matches SET ${col} = NULL, ${byeCol} = true WHERE id = $1`, [e.to_match]);
      await recomputeByeState(tx, e.to_match, nowIso);
    }
  }
}

async function recomputeByeState(tx: Tx, matchId: string, nowIso: string): Promise<void> {
  const m = await tx.one<{
    id: string;
    upper_entrant_id: string | null;
    upper_is_bye: boolean;
    lower_entrant_id: string | null;
    lower_is_bye: boolean;
    state: MatchState;
  }>(
    `SELECT id, upper_entrant_id, upper_is_bye, lower_entrant_id, lower_is_bye, state FROM matches WHERE id = $1`,
    [matchId]
  );
  if (!m) return;
  if (m.upper_is_bye && m.lower_is_bye) {
    await tx.query(
      `UPDATE matches SET state = 'not_needed', winner = NULL, updated_by = 'system', version = version + 1 WHERE id = $1`,
      [matchId]
    );
    await propagateBye(tx, matchId, nowIso);
  } else if (m.upper_is_bye && m.lower_entrant_id) {
    await tx.query(
      `UPDATE matches SET state = 'bye', winner = 'lower', updated_by = 'system', version = version + 1 WHERE id = $1`,
      [matchId]
    );
    await applyAdvance(tx, matchId, { winner_side: "lower", winner_entrant_id: m.lower_entrant_id, loser_entrant_id: null });
  } else if (m.lower_is_bye && m.upper_entrant_id) {
    await tx.query(
      `UPDATE matches SET state = 'bye', winner = 'upper', updated_by = 'system', version = version + 1 WHERE id = $1`,
      [matchId]
    );
    await applyAdvance(tx, matchId, { winner_side: "upper", winner_entrant_id: m.upper_entrant_id, loser_entrant_id: null });
  }
}

export { recomputeByeState, propagateBye };
