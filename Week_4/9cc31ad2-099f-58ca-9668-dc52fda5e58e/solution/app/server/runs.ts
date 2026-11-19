import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  AI_DRIVERS, DEFAULT_LAPS, LAYOUTS, MAX_LAPS, STOCK, aiTrack, carModel, createCar, openLapInvalid,
  referenceInputs, simulate, stepLimit, stepsToMs, tunedStats,
  type CarStats, type InputEvent, type LapResult, type LayoutId, type Mode, type Stages,
} from "../shared/model.js";
import { offerBoardEntry } from "./boards.js";
import {
  eligible, eventById, eventPoints, layoutOpen, leagueOpen, loadOwned, loadStanding, offeredLoaner, recordEventPoints,
} from "./championship.js";
import type { Transaction } from "./db.js";
import { errors, isRecord } from "./http.js";
import { addMovement } from "./ledger.js";
import { runPayout } from "./payouts.js";
import { Hub } from "./push.js";
import { readReplay } from "./replay.js";
import { StorageUnavailable } from "./s3.js";
import type { Services } from "./main.js";

type RunStatus = "started" | "submitted" | "held" | "verifying" | "verified" | "rejected";
const MODES: readonly Mode[] = ["practice", "circuit", "drift", "time-trial"];
const PUT_TIMEOUT_MS = 1200;

interface AiEntry {
  name: string;
  carId: string;
  paceFactor: number;
}

interface RunResult {
  lapResults: LapResult[];
  raceMs: number;
  bestLapMs: number | null;
  driftScore: number | null;
  coinsCollected: number | null;
  position: number | null;
  clean: boolean;
  topSpeedMps: number;
}

interface RunRow {
  [key: string]: unknown;
  id: string;
  player_id: string;
  seed: string;
  layout_id: LayoutId;
  mode: Mode;
  car_id: string;
  event_id: string | null;
  laps: number;
  step_limit: number;
  loaner: boolean;
  car_stats: CarStats;
  car_stages: Stages;
  ai: AiEntry[];
  status: RunStatus;
  reason: string | null;
  pending_bytes: Buffer | null;
  body_sha256: string | null;
  result: RunResult | null;
  payout: number | null;
}

interface RunRequest {
  readonly layoutId?: unknown;
  readonly mode?: unknown;
  readonly carId?: unknown;
  readonly eventId?: unknown;
  readonly laps?: unknown;
  readonly loaner?: unknown;
}

const replayKey = (runId: string) => `replays/${runId}.json`;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

// Checks a run request in the published precedence: unknown resources, locks and conflicts,
// then validation. Returns the run to create.
async function planRun(services: Services, playerId: string, body: unknown) {
  const request: RunRequest = isRecord(body) ? body : {};
  const loaner = request.loaner === true;
  const owned = await loadOwned(services.db, playerId);
  const standing = await loadStanding(services.db, playerId);

  const event = typeof request.eventId === "string" ? eventById(request.eventId) : undefined;
  if (typeof request.eventId === "string" && !event) throw errors.notFound();
  const ownedCar = typeof request.carId === "string" ? owned.find((car) => car.carId === request.carId) : undefined;
  if (!loaner && typeof request.carId === "string" && !ownedCar) throw errors.notFound();

  const layoutId = event ? event.layoutId : request.layoutId;
  const mode = event ? event.mode : request.mode;
  const validLayout = typeof layoutId === "string" && layoutId in LAYOUTS;
  if (event && !leagueOpen(event.league, standing)) throw errors.locked("LEAGUE_LOCKED", "Complete the Rookie league first.");
  if (validLayout && !layoutOpen(layoutId as LayoutId, standing)) throw errors.locked("LAYOUT_LOCKED", "Complete the Rookie league to unlock this map.");

  let carId: string;
  let stages: Stages;
  if (loaner) {
    const offered = event ? offeredLoaner(event, owned) : null;
    if (!offered) throw errors.conflict("LOANER_NOT_OFFERED", "This event does not offer a loaner to you.");
    carId = offered;
    stages = { ...STOCK };
  } else {
    if (event && ownedCar && !eligible(event, ownedCar.carId, ownedCar.stages)) {
      throw errors.conflict("CAR_NOT_ELIGIBLE", "This car is not eligible for the event.");
    }
    if (!ownedCar) throw errors.invalid({ carId: "Choose one of your cars." });
    carId = ownedCar.carId;
    stages = ownedCar.stages;
  }

  const fields: Record<string, string> = {};
  if (!validLayout) fields.layoutId = "Unknown layout.";
  if (typeof mode !== "string" || !MODES.includes(mode as Mode)) fields.mode = "Unknown mode.";
  let laps = event ? event.laps : DEFAULT_LAPS[(mode as Mode)] ?? 1;
  if (!event && request.laps !== undefined) {
    const lapsOk = Number.isInteger(request.laps) && (mode === "practice" || mode === "time-trial")
      ? (request.laps as number) >= 1 && (request.laps as number) <= MAX_LAPS
      : request.laps === laps;
    if (lapsOk) laps = request.laps as number;
    else fields.laps = "Lap count is outside this mode's range.";
  }
  if (Object.keys(fields).length) throw errors.invalid(fields);

  const model = carModel(carId)!;
  const stats = tunedStats(model.stats, stages);
  const ai: AiEntry[] = mode === "circuit"
    ? AI_DRIVERS.map((driver) => ({ name: driver.name, carId: event?.aiCarId ?? carId, paceFactor: driver.pacePercent / 100 }))
    : [];
  return {
    playerId, layoutId: layoutId as LayoutId, mode: mode as Mode, carId, laps, loaner, stats, stages, ai,
    eventId: event?.eventId ?? null,
  };
}

type RunPlan = Awaited<ReturnType<typeof planRun>>;

async function insertRun(services: Services, plan: RunPlan) {
  const { playerId, layoutId, mode, carId, laps, loaner, stats, stages, ai } = plan;
  const runId = randomUUID();
  const seed = randomBytes(16).toString("hex");
  const limit = stepLimit(mode, laps);
  await services.db.query(
    `INSERT INTO runs (id, player_id, seed, layout_id, mode, car_id, event_id, laps, step_limit, loaner, car_stats, car_stages, ai, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'started')`,
    [runId, playerId, seed, layoutId, mode, carId, plan.eventId, laps, limit, loaner,
      JSON.stringify(stats), JSON.stringify(stages), JSON.stringify(ai)]);
  return { runId, seed, layoutId, mode, carId, laps, stepLimit: limit, loaner, car: { stats, stages }, ai };
}

export async function createRun(services: Services, playerId: string, body: unknown) {
  return insertRun(services, await planRun(services, playerId, body));
}

async function setStatus(tx: Transaction, run: RunRow, status: RunStatus, extra = "", params: unknown[] = []): Promise<void> {
  await tx.query(`UPDATE runs SET status = $2${extra} WHERE id = $1`, [run.id, status, ...params]);
  await Hub.queue(tx, { to: run.player_id, push: { type: "run", runId: run.id, status } });
}

// Stores the finish body as the replay object, then moves the run to verifying (or held when
// storage is unreachable). A byte-identical repeat answers with the current status.
export async function finishRun(services: Services, playerId: string, runId: string, bytes: Buffer) {
  const digest = sha256(bytes);
  return services.db.transaction(async (tx) => {
    const [run] = await tx.query<RunRow>("SELECT * FROM runs WHERE id = $1 FOR UPDATE", [runId]);
    if (!run || run.player_id !== playerId) throw errors.notFound();
    if (run.status !== "started") {
      if (run.body_sha256 === digest) return { runId, status: run.status };
      throw errors.conflict("ALREADY_SUBMITTED", "This run was already finished with a different replay.");
    }
    await setStatus(tx, run, "submitted", ", body_sha256 = $3, pending_bytes = $4", [digest, bytes]);
    try {
      await services.store.put(replayKey(runId), bytes, digest, PUT_TIMEOUT_MS);
      await setStatus(tx, run, "verifying", ", stored_at = clock_timestamp()");
      return { runId, status: "verifying" as const };
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
      await setStatus(tx, run, "held");
      return { runId, status: "held" as const };
    }
  });
}

// Moves held runs on once storage takes the object again.
export async function retryHeld(services: Services): Promise<void> {
  const held = await services.db.query<{ id: string }>("SELECT id FROM runs WHERE status = 'held' ORDER BY created_at LIMIT 20");
  for (const { id } of held) {
    const stored = await services.db.transaction(async (tx) => {
      const [run] = await tx.query<RunRow>("SELECT * FROM runs WHERE id = $1 AND status = 'held' FOR UPDATE SKIP LOCKED", [id]);
      if (!run) return true;
      try {
        await services.store.put(replayKey(id), run.pending_bytes!, run.body_sha256!, PUT_TIMEOUT_MS);
      } catch {
        return false;
      }
      await setStatus(tx, run, "verifying", ", stored_at = clock_timestamp()");
      return true;
    });
    if (!stored) return;
  }
}

function judge(run: RunRow, bytes: Buffer): { reason: string } | { result: RunResult; everyLapValid: boolean } {
  const verdict = readReplay(bytes, run.seed, run.step_limit);
  if (!verdict.ok) return { reason: verdict.reason };
  const layout = LAYOUTS[run.layout_id];
  const car = simulate(createCar(layout, run.car_stats, run.mode, run.laps), verdict.inputs, run.step_limit);
  if (!car.finished) return { reason: "did_not_finish" };
  const valid = car.lapResults.filter((lap) => lap.valid).map((lap) => lap.lapMs);
  let position: number | null = null;
  if (run.mode === "circuit") {
    position = 1 + run.ai.filter((entry) => {
      const model = carModel(entry.carId)!;
      return aiTrack(layout, model.stats, run.laps, Math.round(entry.paceFactor * 100)).finishSteps < car.steps;
    }).length;
  }
  return {
    result: {
      lapResults: car.lapResults,
      raceMs: stepsToMs(car.steps),
      bestLapMs: valid.length ? Math.min(...valid) : null,
      driftScore: run.mode === "drift" ? car.driftScore : null,
      coinsCollected: run.mode === "practice" || run.mode === "circuit" ? car.coins : null,
      position,
      clean: car.clean,
      topSpeedMps: car.topSpeed,
    },
    // A drift stage that ends on its timer is judged on its unfinished lap too.
    everyLapValid: car.lapResults.every((lap) => lap.valid) && !openLapInvalid(car),
  };
}

// Replays one stored run and applies its verdict: payouts, board and championship, once,
// inside the player's serialisation point.
async function verifyRun(services: Services, runId: string, playerId: string): Promise<void> {
  await services.db.withPlayer(playerId, async (tx) => {
    const [run] = await tx.query<RunRow>(
      "SELECT * FROM runs WHERE id = $1 AND status = 'verifying' FOR UPDATE SKIP LOCKED", [runId]);
    if (!run) return;
    const verdict = judge(run, run.pending_bytes!);
    if ("reason" in verdict) {
      await setStatus(tx, run, "rejected", ", reason = $3, pending_bytes = NULL, verified_at = clock_timestamp()", [verdict.reason]);
      return;
    }
    const { result, everyLapValid } = verdict;
    const event = run.event_id ? eventById(run.event_id) : undefined;
    const [player] = await tx.query<{ guided_paid: boolean }>("SELECT guided_paid FROM players WHERE id = $1", [playerId]);
    const [best] = await tx.query<{ best_ms: number }>(
      "SELECT best_ms FROM time_trial_bests WHERE player_id = $1 AND layout_id = $2", [playerId, run.layout_id]);
    const guided = run.event_id === "guided-first-race";
    const payout = runPayout({
      mode: run.mode, position: result.position, clean: result.clean, driftScore: result.driftScore ?? 0,
      coinsCollected: result.coinsCollected ?? 0, lapResults: result.lapResults, loaner: run.loaner,
      guidedFirstRace: guided, guidedAlreadyPaid: player.guided_paid, timeTrialBestMs: best?.best_ms ?? null,
    });
    if (guided) await tx.query("UPDATE players SET guided_paid = true WHERE id = $1", [playerId]);
    if (payout.timeTrialBestMs !== null) {
      await tx.query(
        `INSERT INTO time_trial_bests VALUES ($1,$2,$3) ON CONFLICT (player_id, layout_id) DO UPDATE SET best_ms = EXCLUDED.best_ms`,
        [playerId, run.layout_id, payout.timeTrialBestMs]);
    }
    await setStatus(tx, run, "verified", ", result = $3, payout = $4, pending_bytes = NULL, verified_at = clock_timestamp()",
      [JSON.stringify(result), payout.pickups + payout.result]);
    if (payout.pickups > 0) await addMovement(tx, { playerId, kind: "pickups", amount: payout.pickups, runId });
    if (payout.result > 0) await addMovement(tx, { playerId, kind: "result", amount: payout.result, runId });

    const carClass = carModel(run.car_id)!.class;
    const entry = { layoutId: run.layout_id, class: carClass, playerId, runId, carId: run.car_id,
      topSpeedMps: result.topSpeedMps, replaySha256: run.body_sha256! };
    if (run.mode === "time-trial" && result.bestLapMs !== null) {
      await offerBoardEntry(tx, { ...entry, mode: "time-trial", value: result.bestLapMs });
    } else if (run.mode === "circuit" && everyLapValid) {
      await offerBoardEntry(tx, { ...entry, mode: "circuit", value: result.raceMs });
    } else if (run.mode === "drift" && everyLapValid) {
      await offerBoardEntry(tx, { ...entry, mode: "drift", value: result.driftScore ?? 0 });
    }
    if (event?.league) {
      const points = eventPoints(event, {
        position: result.position, driftScore: result.driftScore ?? 0,
        validLapsMs: result.lapResults.filter((lap) => lap.valid).map((lap) => lap.lapMs),
      });
      await recordEventPoints(tx, playerId, event, points);
    }
  });
}

// Verifies every run whose object has been stored for at least VERIFY_DELAY_MS.
export async function verifyDue(services: Services): Promise<void> {
  const due = await services.db.query<{ id: string; player_id: string }>(
    `SELECT id, player_id FROM runs WHERE status = 'verifying'
       AND stored_at <= clock_timestamp() - make_interval(secs => $1::double precision / 1000) ORDER BY stored_at LIMIT 20`,
    [services.config.verifyDelayMs]);
  await Promise.all(due.map((run) => verifyRun(services, run.id, run.player_id)));
}

async function readRun(services: Services, viewerId: string, runId: string) {
  const [run] = await services.db.query<RunRow & { name: string }>(
    "SELECT r.*, p.name FROM runs r JOIN players p ON p.id = r.player_id WHERE r.id = $1", [runId]);
  if (!run || (run.player_id !== viewerId && run.status !== "verified")) throw errors.notFound();
  return run;
}

export async function runBody(services: Services, viewerId: string, runId: string) {
  const run = await readRun(services, viewerId, runId);
  const result = run.result;
  return {
    runId: run.id, playerId: run.player_id, name: run.name, status: run.status, reason: run.reason,
    layoutId: run.layout_id, mode: run.mode, carId: run.car_id, eventId: run.event_id, loaner: run.loaner,
    car: { stats: run.car_stats, stages: run.car_stages },
    lapResults: result?.lapResults ?? null, raceMs: result?.raceMs ?? null, bestLapMs: result?.bestLapMs ?? null,
    driftScore: result?.driftScore ?? null, coinsCollected: result?.coinsCollected ?? null,
    position: result?.position ?? null, clean: result?.clean ?? null, payout: run.payout,
    topSpeedMps: result?.topSpeedMps ?? null, replaySha256: run.body_sha256,
  };
}

export async function replayFile(services: Services, viewerId: string, runId: string) {
  const run = await readRun(services, viewerId, runId);
  if (run.status === "started") throw errors.notFound();
  let bytes: Buffer | null;
  try {
    bytes = await services.store.get(replayKey(runId));
  } catch {
    throw errors.replayStorage();
  }
  if (!bytes) throw errors.notFound();
  return { bytes, digest: run.body_sha256! };
}

const COAST: InputEvent[] = [{ step: 0, throttle: 1, brake: 0, drift: 0, lane: "middle" }];

// Grading: creates a run like POST /v1/runs, writes its replay with the chosen driver and sends
// it through the same finish pipeline.
export async function gradingRace(services: Services, playerId: string, body: unknown) {
  const request = isRecord(body) ? body : {};
  const driver = request.driver;
  const known = driver === "reference" || driver === "coast" || (driver === "inputs" && Array.isArray(request.inputs));
  const plan = await planRun(services, playerId, request);
  if (!known) throw errors.invalid({ driver: "Choose reference, coast or inputs with an inputs list." });
  const run = await insertRun(services, plan);
  const layout = LAYOUTS[run.layoutId];
  const inputs = driver === "reference" ? referenceInputs(layout, run.car.stats, run.mode, run.laps)
    : driver === "coast" ? COAST : request.inputs;
  await finishRun(services, playerId, run.runId, Buffer.from(JSON.stringify({ seed: run.seed, inputs })));
  return { runId: run.runId };
}
