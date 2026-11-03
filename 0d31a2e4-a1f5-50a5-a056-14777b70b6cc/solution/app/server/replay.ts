// Replays: every frame is re-simulated from the stored seed, starters, effective inputs and forfeits.
import { query } from "./db.js";
import { ApiError, fieldError } from "./errors.js";
import { route } from "./http.js";
import { positiveId, type StoredRound, storedRound } from "./matches.js";
import { usersById } from "./users.js";
import { type ForfeitEntry, type Frame, type InputEntry, ReplayedRound } from "../shared/sim.js";
import { hueOf, LOBBY_SIZE, MAX_BUTTONS, MAX_SEED, type RoundKind, timeLimitTicks } from "../shared/rules.js";

const SIMULATE_LIMIT = 256 * 1024;
const MAX_INPUTS = 6000;
const CACHE_SIZE = 64;
const replays = new Map<number, ReplayedRound>();

async function recorded(roundId: number): Promise<{ inputs: InputEntry[]; forfeits: ForfeitEntry[] }> {
  const inputs = await query("SELECT tick, user_id, buttons FROM round_inputs WHERE round_id = $1 ORDER BY tick, user_id", [roundId]);
  const forfeits = await query("SELECT tick, user_id FROM round_forfeits WHERE round_id = $1 ORDER BY tick, user_id", [roundId]);
  return {
    inputs: inputs.map((row) => ({ tick: Number(row["tick"]), userId: Number(row["user_id"]), buttons: Number(row["buttons"]) })),
    forfeits: forfeits.map((row) => ({ tick: Number(row["tick"]), userId: Number(row["user_id"]) })),
  };
}

async function replayOf(round: StoredRound): Promise<ReplayedRound> {
  const cached = replays.get(round.id);
  if (cached !== undefined) return cached;
  const { inputs, forfeits } = await recorded(round.id);
  const replay = new ReplayedRound(round.kind, round.seed, round.starters, inputs, forfeits);
  replays.set(round.id, replay);
  if (replays.size > CACHE_SIZE) {
    const oldest = replays.keys().next().value;
    if (oldest !== undefined) replays.delete(oldest);
  }
  return replay;
}

async function resolvedRound(params: string[]): Promise<StoredRound> {
  const round = await storedRound(positiveId(params[0]), positiveId(params[1]));
  if (round === undefined) throw new ApiError("round_not_found");
  if (round.state !== "resolved") throw new ApiError("round_not_resolved");
  return round;
}

async function withPlayers(frame: Frame): Promise<object> {
  const users = await usersById(frame.beans.map((bean) => bean.userId));
  return {
    ...frame,
    beans: frame.beans.map((bean) => ({
      userId: bean.userId, handle: users.get(bean.userId)?.handle ?? null, hue: hueOf(bean.userId),
      x: bean.x, y: bean.y, z: bean.z, state: bean.state, rank: bean.rank, finishTick: bean.finishTick, marker: bean.marker,
    })),
  };
}

function tickParam(raw: string | null, lastTick: number): number {
  if (raw === null || !/^\d+$/.test(raw) || Number(raw) > lastTick) throw new ApiError("tick_out_of_range");
  return Number(raw);
}

route("GET", "/api/matches/:id/rounds/:n/frames", "session", async ({ params, query: search }) => {
  const round = await resolvedRound(params);
  const replay = await replayOf(round);
  const frame = replay.frame(tickParam(search.get("tick"), replay.lastTick));
  return {
    status: 200,
    body: { matchId: positiveId(params[0]), round: round.n, kind: round.kind, ...(await withPlayers(frame)) },
  };
});

route("GET", "/api/matches/:id/rounds/:n/inputs", "session", async ({ params }) => {
  const round = await resolvedRound(params);
  const { inputs, forfeits } = await recorded(round.id);
  return { status: 200, body: { kind: round.kind, seed: round.seed, starters: round.starters, inputs, forfeits } };
});

function isInteger(value: unknown, low: number, high: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= low && value <= high;
}

function records(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "object" && item !== null && !Array.isArray(item))) return null;
  return value as Record<string, unknown>[];
}

interface SimulateRequest {
  kind: RoundKind;
  seed: number;
  starters: number[];
  inputs: InputEntry[];
  forfeits: ForfeitEntry[];
}

function parseSimulation(body: Record<string, unknown>): SimulateRequest {
  const kind = body["kind"];
  if (kind !== "race" && kind !== "survival" && kind !== "final") throw fieldError({ kind: "Choose race, survival or final." });
  const seed = body["seed"];
  if (!isInteger(seed, 0, MAX_SEED)) throw fieldError({ seed: "Use a whole number from 0 to 4294967295." });
  const starters = body["starters"];
  if (!Array.isArray(starters) || starters.length < 1 || starters.length > LOBBY_SIZE
    || !starters.every((id) => isInteger(id, 1, 2 ** 31 - 1)) || new Set(starters).size !== starters.length) {
    throw fieldError({ starters: "List 1 to 12 different player ids." });
  }
  const ids = new Set(starters as number[]);
  const limit = timeLimitTicks(kind);
  const inputs = records(body["inputs"]);
  const seen = new Set<string>();
  if (inputs === null || inputs.length > MAX_INPUTS || !inputs.every((input) => {
    const key = `${String(input["tick"])}:${String(input["userId"])}`;
    const valid = isInteger(input["tick"], 0, limit) && ids.has(Number(input["userId"])) && isInteger(input["buttons"], 0, MAX_BUTTONS)
      && !seen.has(key);
    seen.add(key);
    return valid;
  })) {
    throw fieldError({ inputs: "Use at most 6000 inputs from starters, inside the time limit, one per tick and player." });
  }
  const forfeits = body["forfeits"] === undefined ? [] : records(body["forfeits"]);
  const forfeited = new Set<number>();
  if (forfeits === null || !forfeits.every((forfeit) => {
    const userId = Number(forfeit["userId"]);
    const valid = isInteger(forfeit["tick"], 1, limit) && ids.has(userId) && !forfeited.has(userId);
    forfeited.add(userId);
    return valid;
  })) {
    throw fieldError({ forfeits: "Use at most one forfeit per starter, inside the time limit." });
  }
  return {
    kind,
    seed,
    starters: starters as number[],
    inputs: inputs.map((input) => ({ tick: Number(input["tick"]), userId: Number(input["userId"]), buttons: Number(input["buttons"]) })),
    forfeits: forfeits.map((forfeit) => ({ tick: Number(forfeit["tick"]), userId: Number(forfeit["userId"]) })),
  };
}

route("POST", "/api/simulate", "session", async ({ body }) => {
  const request = parseSimulation(body);
  const replay = new ReplayedRound(request.kind, request.seed, request.starters, request.inputs, request.forfeits);
  const tick = body["tick"] === undefined ? replay.lastTick : body["tick"];
  if (!isInteger(tick, 0, replay.lastTick)) throw fieldError({ tick: `Use a tick from 0 to ${replay.lastTick}.` });
  return {
    status: 200,
    body: {
      kind: request.kind, seed: request.seed, slots: replay.slots, lastTick: replay.lastTick, results: replay.results,
      frame: await withPlayers(replay.frame(tick)),
    },
  };
}, SIMULATE_LIMIT);
