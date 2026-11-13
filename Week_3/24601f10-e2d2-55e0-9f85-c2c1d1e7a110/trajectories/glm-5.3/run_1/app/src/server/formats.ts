import type { Tx } from "./db.js";
import { newId } from "./auth.js";
import type { EntrantRow } from "./brackets.js";
import { matchLabel } from "./brackets.js";

import { errors } from "./errors.js";
import type { TournamentRow } from "./tournaments.js";

/** Round robin: seat entrants by seed in m positions, m rounded up to even with a bye seat last. */
export async function buildRoundRobin(tx: Tx, tournamentId: string, entrants: EntrantRow[], nowIso: string): Promise<void> {
  const m = entrants.length % 2 === 0 ? entrants.length : entrants.length + 1;
  const positions: (EntrantRow | null)[] = new Array(m).fill(null);
  entrants.forEach((e, i) => (positions[i] = e));
  const half = m / 2;
  const rounds = m - 1;
  for (let r = 1; r <= rounds; r++) {
    let matchNo = 0;
    for (let i = 1; i <= half; i++) {
      const a = positions[i - 1];
      const b = positions[m - i];
      matchNo += 1;
      const upperIsBye = a === null;
      const lowerIsBye = b === null;
      const id = newId();
      await tx.query(
        `INSERT INTO matches (id, tournament_id, bracket, round, number, label, upper_entrant_id, upper_is_bye, lower_entrant_id, lower_is_bye, state, paired_at)
         VALUES ($1,$2,'main',$3,$4,$5,$6,$7,$8,$9,'pending',$10)`,
        [
          id,
          tournamentId,
          r,
          matchNo,
          matchLabel("main", r, matchNo),
          a ? a.id : null,
          upperIsBye,
          b ? b.id : null,
          lowerIsBye,
          nowIso,
        ]
      );
      if (upperIsBye !== lowerIsBye) {
        // one side is the bye seat: a bye card worth nothing
        await tx.query(
          `UPDATE matches SET state = 'bye', winner = $2, updated_by = 'system', version = version + 1 WHERE id = $1`,
          [id, upperIsBye ? "lower" : "upper"]
        );
      }
    }
    // rotate: position 1 stays; last moves to position 2, others shift right
    const fixed = positions[0];
    const rest = positions.slice(1);
    rest.unshift(rest.pop()!);
    positions.splice(0, positions.length, fixed!, ...rest);
  }
}

export function swissRoundsCount(field: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(2, field))));
}

export interface Pairing {
  upper: string;
  lower: string;
}

/** Pair the next Swiss round. Returns entrant id pairs and bye entrant id. */
export async function pairSwissRound(
  tx: Tx,
  t: TournamentRow,
  entrants: EntrantRow[],
  round: number,
  nowIso: string
): Promise<void> {
  const prev = await tx.all<{ upper_entrant_id: string | null; lower_entrant_id: string | null; winner: string | null }>(
    `SELECT upper_entrant_id, lower_entrant_id, winner FROM matches WHERE tournament_id = $1 AND bracket = 'main'`,
    [t.id]
  );
  const points = new Map<string, number>();
  for (const e of entrants) points.set(e.id, 0);
  const played = new Set<string>();
  const byes = new Set<string>();
  const byeWins: string[] = [];
  for (const m of prev) {
    if (m.upper_entrant_id && m.lower_entrant_id) {
      played.add(key(m.upper_entrant_id, m.lower_entrant_id));
      const winner = m.winner;
      if (winner === "upper") points.set(m.upper_entrant_id, (points.get(m.upper_entrant_id) ?? 0) + 3);
      else if (winner === "lower") points.set(m.lower_entrant_id, (points.get(m.lower_entrant_id) ?? 0) + 3);
      else if (winner === "draw") {
        points.set(m.upper_entrant_id, (points.get(m.upper_entrant_id) ?? 0) + 1);
        points.set(m.lower_entrant_id, (points.get(m.lower_entrant_id) ?? 0) + 1);
      }
    } else {
      // bye: 2-0 win worth 3 points, opponent 0
      const who = m.upper_entrant_id ?? m.lower_entrant_id;
      if (who) {
        points.set(who, (points.get(who) ?? 0) + 3);
        byes.add(who);
        byeWins.push(who);
      }
    }
  }
  const rank = (a: EntrantRow, b: EntrantRow): number => {
    const pa = points.get(a.id) ?? 0;
    const pb = points.get(b.id) ?? 0;
    if (pa !== pb) return pb - pa;
    return a.seed - b.seed;
  };
  const sorted = [...entrants].sort(rank);
  let byeEntrant: EntrantRow | null = null;
  let pool = sorted;
  if (sorted.length % 2 === 1) {
    const noBye = sorted.filter((e) => !byes.has(e.id));
    byeEntrant = noBye.length > 0 ? noBye[noBye.length - 1]! : sorted[sorted.length - 1]!;
    pool = sorted.filter((e) => e.id !== byeEntrant!.id);
  }
  // Round 1: the remaining 2h entrants pair seed rank i against i+h as match i.
  // Later rounds: repeatedly take the highest-ranked unpaired entrant and pair
  // them with the highest-ranked unpaired entrant they have not played.
  const pairs: Pairing[] =
    round === 1
      ? pool.slice(0, pool.length / 2).map((e, i) => ({ upper: e.id, lower: pool[i + pool.length / 2]!.id }))
      : pairByRank(pool, played);
  let matchNo = 0;
  for (const p of pairs) {
    matchNo += 1;
    await insertSwissMatch(tx, t.id, round, matchNo, p.upper, p.lower, nowIso, false);
  }
  if (byeEntrant) {
    matchNo += 1;
    await insertSwissMatch(tx, t.id, round, matchNo, byeEntrant.id, null, nowIso, true);
  }
}

async function insertSwissMatch(
  tx: Tx,
  tournamentId: string,
  round: number,
  number: number,
  upper: string,
  lower: string | null,
  nowIso: string,
  isBye: boolean
): Promise<void> {
  const id = newId();
  await tx.query(
    `INSERT INTO matches (id, tournament_id, bracket, round, number, label, upper_entrant_id, upper_is_bye, lower_entrant_id, lower_is_bye, state, paired_at)
     VALUES ($1,$2,'main',$3,$4,$5,$6,false,$7,$8,$9,$10)`,
    [
      id,
      tournamentId,
      round,
      number,
      matchLabel("main", round, number),
      upper,
      lower,
      lower === null,
      isBye ? "bye" : "pending",
      nowIso,
    ]
  );
  if (isBye) {
    await tx.query(
      `UPDATE matches SET state = 'bye', winner = 'upper', upper_games = 2, lower_games = 0, updated_by = 'system', version = version + 1 WHERE id = $1`,
      [id]
    );
  }
}

function key(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Greedy pairing with backtracking, per the published rule. */
export function pairByRank(pool: EntrantRow[], played: Set<string>): Pairing[] {
  const used = new Set<string>();
  const order = pool; // already ranked
  const chosen: { upper: string; lower: string }[] = [];

  const tryPair = (idx: number): boolean => {
    // find first unused entrant by rank
    let i = idx;
    while (i < order.length && used.has(order[i]!.id)) i++;
    if (i >= order.length) return true; // all paired
    const upper = order[i]!;
    for (let j = i + 1; j < order.length; j++) {
      const lower = order[j]!;
      if (used.has(lower.id)) continue;
      if (played.has(key(upper.id, lower.id))) continue;
      used.add(upper.id);
      used.add(lower.id);
      chosen.push({ upper: upper.id, lower: lower.id });
      if (tryPair(i + 1)) return true;
      chosen.pop();
      used.delete(upper.id);
      used.delete(lower.id);
    }
    return false;
  };

  if (!tryPair(0)) throw errors.ws("No pairing without a rematch exists.");
  return chosen;
}

export async function allMatchesHaveResult(tx: Tx, tournamentId: string, round: number): Promise<boolean> {
  const rows = await tx.all<{ state: string }>(
    `SELECT state FROM matches WHERE tournament_id = $1 AND bracket = 'main' AND round = $2`,
    [tournamentId, round]
  );
  return rows.every((m) => m.state === "confirmed" || m.state === "resolved" || m.state === "bye" || m.state === "not_needed");
}
