import type { Pool } from "pg";
import type { RoundKind } from "../../shared/domain.js";
import { roundDef, roundName, slotsFor } from "../../shared/domain.js";
import { ApiError, err, isRecord } from "../http.js";
import { simulateRound, timeLimitTicks, type InputEntry, type SimResultEntry } from "../sim/sim.js";
import { generateCourse } from "../sim/course.js";

export type RoundRecord = {
  match_id: number;
  n: number;
  kind: RoundKind;
  seed: number;
  state: "pending" | "running" | "resolved";
  slots: number;
  starters: number[];
  last_tick: number | null;
};

export async function loadMatch(pool: Pool, matchId: number) {
  const match = await pool.query<{ id: number; name: string; state: string; lobby_id: number; started_at: Date; finished_at: Date | null; winner_id: number | null }>(
    "SELECT id, name, state, lobby_id, started_at, finished_at, winner_id FROM matches WHERE id = $1",
    [matchId]
  );
  const matchRow = match.rows[0];
  if (!matchRow) throw new ApiError(404, "match_not_found", "That match doesn't exist.");
  const rounds = await pool.query<RoundRecord>(
    "SELECT match_id, n, kind, seed, state, slots, starters, last_tick FROM rounds WHERE match_id = $1 ORDER BY n",
    [matchId]
  );
  const participants = await pool.query<{ id: number; handle: string }>(
    `SELECT DISTINCT u.id, u.handle
       FROM users u
       JOIN rounds r ON r.match_id = $1 AND r.n = 1 AND u.id = ANY (r.starters)
      ORDER BY u.id`,
    [matchId]
  );
  const roundViews = [];
  for (const round of rounds.rows) {
    const results =
      round.state === "resolved"
        ? await pool.query<{ user_id: number; outcome: string; finish_tick: number | null; eliminated_tick: number | null; position: number }>(
            "SELECT user_id, outcome, finish_tick, eliminated_tick, position FROM round_results WHERE match_id = $1 AND round_n = $2 ORDER BY position",
            [matchId, round.n]
          )
        : null;
    roundViews.push({
      n: round.n,
      kind: round.kind,
      name: roundName(round.n),
      seed: round.seed,
      state: round.state,
      starters: round.starters,
      slots: round.slots,
      lastTick: round.last_tick,
      results: results
        ? results.rows.map((row) => ({
            userId: row.user_id,
            outcome: row.outcome as "qualified" | "eliminated",
            finishTick: row.finish_tick,
            eliminatedTick: row.eliminated_tick,
            position: row.position
          }))
        : []
    });
  }
  return {
    match: {
      id: matchRow.id,
      name: matchRow.name,
      state: matchRow.state as "running" | "finished",
      lobbyId: matchRow.lobby_id,
      startedAt: matchRow.started_at.toISOString(),
      finishedAt: matchRow.finished_at ? matchRow.finished_at.toISOString() : null,
      winnerId: matchRow.winner_id,
      participants: participants.rows.map((row) => ({ id: row.id, handle: row.handle })),
      rounds: roundViews
    }
  };
}

/** Re-simulates a resolved round from its stored seed, inputs and forfeits. */
export async function resimulateRound(pool: Pool, matchId: number, roundN: number) {
  const round = await pool.query<RoundRecord>(
    "SELECT match_id, n, kind, seed, state, slots, starters, last_tick FROM rounds WHERE match_id = $1 AND n = $2",
    [matchId, roundN]
  );
  const roundRow = round.rows[0];
  if (!roundRow) throw new ApiError(404, "round_not_found", "That round doesn't exist.");
  if (roundRow.state !== "resolved" || roundRow.last_tick === null) {
    throw new ApiError(409, "round_not_resolved", "That round hasn't finished yet.");
  }
  const inputs = await pool.query<{ tick: number; user_id: number; buttons: number }>(
    "SELECT tick, user_id, buttons FROM round_inputs WHERE match_id = $1 AND round_n = $2 ORDER BY tick, user_id",
    [matchId, roundN]
  );
  const forfeits = await pool.query<{ tick: number; user_id: number }>(
    "SELECT tick, user_id FROM forfeits WHERE match_id = $1 AND round_n = $2 ORDER BY tick, user_id",
    [matchId, roundN]
  );
  const sim = simulateRound({
    kind: roundRow.kind,
    seed: roundRow.seed,
    starters: roundRow.starters,
    inputs: inputs.rows.map((row) => ({ tick: row.tick, userId: row.user_id, buttons: row.buttons })),
    forfeits: forfeits.rows.map((row) => ({ tick: row.tick, userId: row.user_id })),
    recordFrames: true
  });
  return { round: roundRow, sim };
}

export async function framesAtTick(
  pool: Pool,
  matchId: number,
  roundN: number,
  rawTick: string | null,
  handles: Map<number, string>
) {
  const { round, sim } = await resimulateRound(pool, matchId, roundN);
  if (sim.lastTick === null) throw err("server_error");
  const lastTick = sim.lastTick;
  if (rawTick === null || rawTick === undefined || !/^-?\d+$/.test(rawTick)) {
    throw new ApiError(422, "tick_out_of_range", "Tick is out of range.");
  }
  const tick = Number(rawTick);
  if (tick < 0 || tick > lastTick) {
    throw new ApiError(422, "tick_out_of_range", "Tick is out of range.");
  }
  const frame = sim.frames.get(tick);
  if (!frame) throw err("server_error");
  const slotsLeft = frame.slotsLeft;
  const markers = markersForLastTick(sim.results, frame.beans.map((b) => b.userId));
  const lastFrame = sim.frames.get(lastTick);
  const qualifiedByLast = new Set(
    lastFrame ? lastFrame.beans.filter((b) => b.state === "qualified").map((b) => b.userId) : []
  );
  return {
    matchId,
    round: roundN,
    kind: round.kind,
    tick,
    lastTick,
    slots: round.slots,
    slotsLeft,
    beans: frame.beans
      .sort((a, b) => a.rank - b.rank)
      .map((bean) => {
        const finishTick =
          bean.state === "qualified" && bean.finishTick !== null && bean.finishTick <= tick ? bean.finishTick : null;
        return {
          userId: bean.userId,
          handle: handles.get(bean.userId) ?? null,
          x: bean.x,
          y: bean.y,
          z: bean.z,
          state: bean.state,
          rank: bean.rank,
          finishTick,
          marker: tick === lastTick ? (markers.get(bean.userId) ?? null) : null
        };
      })
      .map((bean) => ({ ...bean, qualifiedByLast: qualifiedByLast.has(bean.userId) }))
  };
}

/** last_slot goes to the lowest-ranked qualifier, first_out to the bean ranked right after it. */
function markersForLastTick(results: SimResultEntry[], userIds: number[]): Map<number, "last_slot" | "first_out"> {
  void userIds;
  const map = new Map<number, "last_slot" | "first_out">();
  const ranked = [...results].sort((a, b) => a.position - b.position);
  const qualifiers = ranked.filter((r) => r.outcome === "qualified");
  const lastQualifier = qualifiers[qualifiers.length - 1];
  if (lastQualifier) map.set(lastQualifier.userId, "last_slot");
  const index = lastQualifier ? ranked.findIndex((r) => r.userId === lastQualifier.userId) : -1;
  const firstOut = index >= 0 ? (ranked[index + 1] ?? null) : (ranked[0] ?? null);
  if (firstOut) map.set(firstOut.userId, "first_out");
  return map;
}

export async function exportInputs(pool: Pool, matchId: number, roundN: number) {
  const round = await pool.query<RoundRecord>(
    "SELECT match_id, n, kind, seed, state, slots, starters, last_tick FROM rounds WHERE match_id = $1 AND n = $2",
    [matchId, roundN]
  );
  const roundRow = round.rows[0];
  if (!roundRow) throw new ApiError(404, "round_not_found", "That round doesn't exist.");
  if (roundRow.state !== "resolved") throw new ApiError(409, "round_not_resolved", "That round hasn't finished yet.");
  const inputs = await pool.query<{ tick: number; user_id: number; buttons: number }>(
    "SELECT tick, user_id, buttons FROM round_inputs WHERE match_id = $1 AND round_n = $2 ORDER BY tick, user_id",
    [matchId, roundN]
  );
  const forfeits = await pool.query<{ tick: number; user_id: number }>(
    "SELECT tick, user_id FROM forfeits WHERE match_id = $1 AND round_n = $2 ORDER BY tick, user_id",
    [matchId, roundN]
  );
  return {
    kind: roundRow.kind,
    seed: roundRow.seed,
    starters: roundRow.starters,
    inputs: inputs.rows.map((row) => ({ tick: row.tick, userId: row.user_id, buttons: row.buttons })),
    forfeits: forfeits.rows.map((row) => ({ tick: row.tick, userId: row.user_id }))
  };
}

/** POST /api/simulate — the same simulation as live rounds, on demand. */
export function runSimulate(body: unknown): {
  kind: RoundKind;
  seed: number;
  slots: number;
  lastTick: number;
  results: SimResultEntry[];
  frame: { tick: number; lastTick: number; slots: number; slotsLeft: number; beans: unknown[] };
} {
  if (!isRecord(body)) throw new ApiError(422, "validation_failed", "Check the request.");
  const kind = body["kind"];
  if (kind !== "race" && kind !== "survival" && kind !== "final") {
    throw new ApiError(422, "validation_failed", "Check the request.", { kind: "Kind must be race, survival or final." });
  }
  const seed = body["seed"];
  if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
    throw new ApiError(422, "validation_failed", "Check the request.", { seed: "Seed must be from 0 to 4294967295." });
  }
  const starters = body["starters"];
  if (!Array.isArray(starters) || starters.length < 1 || starters.length > 12 || !starters.every((id) => typeof id === "number" && Number.isInteger(id) && id > 0) || new Set(starters).size !== starters.length) {
    throw new ApiError(422, "validation_failed", "Check the request.", { starters: "Starters must be 1 to 12 distinct ids." });
  }
  const rawInputs = body["inputs"];
  const inputs: InputEntry[] = [];
  if (rawInputs !== undefined) {
    if (!Array.isArray(rawInputs) || rawInputs.length > 6000) {
      throw new ApiError(422, "validation_failed", "Check the request.", { inputs: "Too many inputs." });
    }
    const seen = new Set<string>();
    for (const entry of rawInputs) {
      if (!isRecord(entry)) throw new ApiError(422, "validation_failed", "Check the request.", { inputs: "Inputs are malformed." });
      const tick = entry["tick"];
      const userId = entry["userId"];
      const buttons = entry["buttons"];
      if (typeof tick !== "number" || !Number.isInteger(tick) || tick < 0) {
        throw new ApiError(422, "validation_failed", "Check the request.", { inputs: "Inputs are malformed." });
      }
      if (typeof userId !== "number" || !Number.isInteger(userId) || !starters.includes(userId)) {
        throw new ApiError(422, "validation_failed", "Check the request.", { inputs: "Inputs are malformed." });
      }
      if (typeof buttons !== "number" || !Number.isInteger(buttons) || buttons < 0 || buttons > 63) {
        throw new ApiError(422, "validation_failed", "Check the request.", { inputs: "Inputs are malformed." });
      }
      if (tick > timeLimitTicks(kind)) {
        throw new ApiError(422, "validation_failed", "Check the request.", { inputs: "Inputs are malformed." });
      }
      const key = `${tick}:${userId}`;
      if (seen.has(key)) {
        throw new ApiError(422, "validation_failed", "Check the request.", { inputs: "Two inputs share a tick and user id." });
      }
      seen.add(key);
      inputs.push({ tick, userId, buttons });
    }
  }
  const rawForfeits = body["forfeits"];
  const forfeits: { tick: number; userId: number }[] = [];
  if (rawForfeits !== undefined) {
    if (!Array.isArray(rawForfeits)) {
      throw new ApiError(422, "validation_failed", "Check the request.", { forfeits: "Forfeits are malformed." });
    }
    const seenUsers = new Set<number>();
    for (const entry of rawForfeits) {
      if (!isRecord(entry)) throw new ApiError(422, "validation_failed", "Check the request.", { forfeits: "Forfeits are malformed." });
      const tick = entry["tick"];
      const userId = entry["userId"];
      if (typeof tick !== "number" || !Number.isInteger(tick) || tick < 1 || tick > timeLimitTicks(kind)) {
        throw new ApiError(422, "validation_failed", "Check the request.", { forfeits: "Forfeits are malformed." });
      }
      if (typeof userId !== "number" || !Number.isInteger(userId) || !starters.includes(userId) || seenUsers.has(userId)) {
        throw new ApiError(422, "validation_failed", "Check the request.", { forfeits: "Forfeits are malformed." });
      }
      seenUsers.add(userId);
      forfeits.push({ tick, userId });
    }
  }
  const rawTick = body["tick"];
  if (rawTick !== undefined && rawTick !== null && (typeof rawTick !== "number" || !Number.isInteger(rawTick) || rawTick < 0)) {
    throw new ApiError(422, "validation_failed", "Check the request.", { tick: "Tick is out of range." });
  }

  const sim = simulateRound({ kind, seed, starters, inputs, forfeits, recordFrames: true });
  if (sim.lastTick === null) throw err("server_error");
  const requestedTick = typeof rawTick === "number" ? rawTick : sim.lastTick;
  if (requestedTick > sim.lastTick) {
    throw new ApiError(422, "validation_failed", "Check the request.", { tick: "Tick is out of range." });
  }
  const frame = sim.frames.get(requestedTick);
  if (!frame) throw err("server_error");
  return {
    kind,
    seed,
    slots: sim.slots,
    lastTick: sim.lastTick,
    results: sim.results,
    frame: {
      tick: requestedTick,
      lastTick: sim.lastTick,
      slots: sim.slots,
      slotsLeft: frame.slotsLeft,
      beans: frame.beans
        .sort((a, b) => a.rank - b.rank)
        .map((bean) => ({
          userId: bean.userId,
          handle: null,
          x: bean.x,
          y: bean.y,
          z: bean.z,
          state: bean.state,
          rank: bean.rank,
          finishTick: bean.state === "qualified" && bean.finishTick !== null && bean.finishTick <= requestedTick ? bean.finishTick : null,
          marker: requestedTick === sim.lastTick ? (markersForLastTick(sim.results, starters).get(bean.userId) ?? null) : null
        }))
    }
  };
}

export function roundLimitOf(kind: RoundKind): number {
  return timeLimitTicks(kind);
}

export function simulateForSeed(kind: RoundKind, seed: number, starters: number[], inputs: InputEntry[], forfeits: { tick: number; userId: number }[]) {
  void roundDef;
  void slotsFor;
  void generateCourse;
  return simulateRound({ kind, seed, starters, inputs, forfeits, recordFrames: false });
}
