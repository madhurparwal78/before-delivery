import {
  type CarClass,
  LAYOUTS,
  carSpec,
  findEvent,
  isBoardMode,
  statsWithStages,
} from '../shared/catalogue.js';
import { AiCar, type Contender, rankContenders, replayInputs } from '../shared/race-model.js';
import {
  readReplayEvents,
  readReplayStructure,
  seedMatches,
} from '../shared/replay-file.js';
import {
  GUIDED_FIRST_RACE_COINS,
  applyLoaner,
  circuitEventPoints,
  circuitResultCoins,
  driftEventPoints,
  driftResultCoins,
  timeTrialCoins,
  timeTrialEventPoints,
} from '../shared/payouts.js';
import { config } from './config.js';
import { db, one, withPlayerLock, type Queryable } from './db.js';
import { writeMovement } from './ledger.js';
import { pushBoard, pushToPlayer } from './pushes.js';
import { readBoard, recordBoardValue } from './boards.js';
import { pushChampionship, recordEventPoints } from './championship.js';
import { ReplayStorageUnavailable, putReplay, sha256Hex } from './storage.js';
import { STOCK_STAGES, aiEntriesFor, loadRun, runConfig, type RunRow } from './runs.js';

const HELD_SWEEP_MS = 3000;
const FINISH_STORE_TIMEOUT_MS = 1200;

export function replayKey(runId: string): string {
  return `replays/${runId}.json`;
}

async function setStatus(runId: string, playerId: string, status: string): Promise<void> {
  await db.query('update runs set status = $2 where run_id = $1', [runId, status]);
  pushToPlayer(playerId, { type: 'run', runId, status });
}

/** Stores the submitted bytes, then moves the run on only once storage confirms them. */
export async function submitFinish(
  run: RunRow,
  bytes: Buffer,
): Promise<{ runId: string; status: string }> {
  const sha256 = sha256Hex(bytes);
  await db.query(
    `update runs set replay_bytes = $2, replay_sha256 = $3, status = 'submitted', submitted_at = now()
     where run_id = $1`,
    [run.run_id, bytes, sha256],
  );
  pushToPlayer(run.player_id, { type: 'run', runId: run.run_id, status: 'submitted' });

  const stored = await storeReplay(run.run_id, bytes, sha256);
  if (!stored) {
    await setStatus(run.run_id, run.player_id, 'held');
    return { runId: run.run_id, status: 'held' };
  }
  await db.query('update runs set replay_stored = true where run_id = $1', [run.run_id]);
  await setStatus(run.run_id, run.player_id, 'verifying');
  scheduleVerification(run.run_id);
  return { runId: run.run_id, status: 'verifying' };
}

async function storeReplay(runId: string, bytes: Buffer, sha256: string): Promise<boolean> {
  try {
    await putReplay(replayKey(runId), bytes, sha256, FINISH_STORE_TIMEOUT_MS);
    return true;
  } catch (error) {
    if (error instanceof ReplayStorageUnavailable) return false;
    throw error;
  }
}

export function scheduleVerification(runId: string): void {
  setTimeout(() => {
    void verifyRun(runId).catch((error) => {
      console.error('verification failed', runId, error);
    });
  }, config.verifyDelayMs).unref();
}

/** Picks up held runs by itself once replay storage returns. */
export function startHeldSweeper(): void {
  setInterval(() => {
    void sweepHeldRuns().catch((error) => console.error('held sweep failed', error));
  }, HELD_SWEEP_MS).unref();
}

async function sweepHeldRuns(): Promise<void> {
  const { rows } = await db.query<{
    run_id: string;
    player_id: string;
    replay_bytes: Buffer;
    replay_sha256: string;
  }>(
    `select run_id, player_id, replay_bytes, replay_sha256 from runs
     where status = 'held' order by submitted_at asc limit 20`,
  );
  for (const row of rows) {
    const stored = await storeReplay(row.run_id, row.replay_bytes, row.replay_sha256);
    if (!stored) return;
    await db.query(
      `update runs set replay_stored = true, status = 'verifying' where run_id = $1 and status = 'held'`,
      [row.run_id],
    );
    pushToPlayer(row.player_id, { type: 'run', runId: row.run_id, status: 'verifying' });
    scheduleVerification(row.run_id);
  }
}

interface ReplayVerdict {
  reason: 'invalid_inputs' | 'seed_mismatch' | 'did_not_finish' | null;
  results: RunResults | null;
}

export interface RunResults {
  lapResults: { lapMs: number; valid: boolean; offTrackSteps: number; sectorsMs: number[] }[];
  raceMs: number;
  bestLapMs: number | null;
  driftScore: number | null;
  coinsCollected: number;
  position: number | null;
  clean: boolean;
  topSpeedMps: number;
}

/** Replays the stored bytes. The first failing check decides the reason. */
function judgeReplay(run: RunRow, bytes: Buffer): ReplayVerdict {
  const structure = readReplayStructure(bytes);
  if (!structure.ok) return { reason: 'invalid_inputs', results: null };
  if (!seedMatches(structure.structure, run.seed)) {
    return { reason: 'seed_mismatch', results: null };
  }
  const events = readReplayEvents(structure.structure, run.step_limit);
  if (!events.ok) return { reason: 'invalid_inputs', results: null };

  const sim = replayInputs(runConfig(run), events.inputs);
  if (run.mode !== 'drift' && !sim.reachedEnd) {
    return { reason: 'did_not_finish', results: null };
  }

  let position: number | null = null;
  if (run.mode === 'circuit') {
    const layout = LAYOUTS[run.layout_id];
    const contenders: Contender[] = [
      {
        name: 'player',
        isPlayer: true,
        lapsCompleted: sim.lapsCompleted,
        lapPos: sim.lapPos,
        finishStep: sim.stepsCompleted,
      },
      ...aiEntriesFor(run.mode, run.event_id, run.car_id).map((entry) => {
        const car = new AiCar(entry.name, entry.carId, entry.paceFactor, {
          layout,
          stats: statsWithStages(entry.carId, STOCK_STAGES),
          mode: run.mode,
          laps: run.laps,
          stepLimit: run.step_limit,
        });
        return {
          name: entry.name,
          isPlayer: false,
          lapsCompleted: run.laps,
          lapPos: 0,
          finishStep: car.finishStep,
        };
      }),
    ];
    position = rankContenders(contenders).findIndex((entry) => entry.isPlayer) + 1;
  }

  return {
    reason: null,
    results: {
      lapResults: sim.lapResults.map((lap) => ({
        lapMs: lap.lapMs,
        valid: lap.valid,
        offTrackSteps: lap.offTrackSteps,
        sectorsMs: lap.sectorsMs,
      })),
      raceMs: sim.raceMs,
      bestLapMs: sim.bestLapMs,
      driftScore: run.mode === 'drift' ? sim.driftScore : null,
      coinsCollected: sim.coinsCollected,
      position,
      clean: sim.clean,
      topSpeedMps: sim.topSpeedMps,
    },
  };
}

export async function verifyRun(runId: string): Promise<void> {
  const run = await loadRun(db, runId);
  if (!run || run.status !== 'verifying') return;
  const bytesRow = await one<{ replay_bytes: Buffer }>(
    db,
    'select replay_bytes from runs where run_id = $1',
    [runId],
  );
  const bytes = bytesRow?.replay_bytes;
  if (!bytes) return;

  const verdict = judgeReplay(run, bytes);
  if (verdict.reason !== null) {
    await db.query(
      `update runs set status = 'rejected', reason = $2, verified_at = now() where run_id = $1`,
      [runId, verdict.reason],
    );
    pushToPlayer(run.player_id, { type: 'run', runId, status: 'rejected' });
    return;
  }

  const results = verdict.results!;
  await withPlayerLock(run.player_id, async (tx) => {
    const fresh = await one<{ status: string }>(tx, 'select status from runs where run_id = $1', [
      runId,
    ]);
    if (!fresh || fresh.status !== 'verifying') return;
    const payout = await payRun(tx, run, results);
    await tx.query(
      `update runs set status = 'verified', lap_results = $2, race_ms = $3, best_lap_ms = $4,
         drift_score = $5, coins_collected = $6, position = $7, clean = $8, payout = $9,
         top_speed_mps = $10, verified_at = now()
       where run_id = $1`,
      [
        runId,
        JSON.stringify(results.lapResults),
        results.raceMs,
        results.bestLapMs,
        results.driftScore,
        results.coinsCollected,
        results.position,
        results.clean,
        payout,
        results.topSpeedMps,
      ],
    );
    await updateBoard(tx, run, results);
    await updateChampionship(tx, run, results);
  });
  pushToPlayer(run.player_id, { type: 'run', runId, status: 'verified' });
}

async function payRun(tx: Queryable, run: RunRow, results: RunResults): Promise<number> {
  let total = 0;
  if (
    (run.mode === 'practice' || run.mode === 'circuit') &&
    results.coinsCollected > 0
  ) {
    await writeMovement(tx, {
      playerId: run.player_id,
      kind: 'pickups',
      amount: results.coinsCollected,
      runId: run.run_id,
    });
    total += results.coinsCollected;
  }

  let resultCoins = 0;
  if (run.mode === 'circuit' && results.position !== null) {
    resultCoins = circuitResultCoins(results.position, results.clean);
  } else if (run.mode === 'drift') {
    resultCoins = driftResultCoins(results.driftScore ?? 0);
  } else if (run.mode === 'time-trial') {
    const previous = await one<{ best: number | null }>(
      tx,
      `select min(best_lap_ms) as best from runs
       where player_id = $1 and layout_id = $2 and mode = 'time-trial'
         and status = 'verified' and best_lap_ms is not null and run_id <> $3`,
      [run.player_id, run.layout_id, run.run_id],
    );
    const validLaps = results.lapResults.filter((lap) => lap.valid).map((lap) => lap.lapMs);
    resultCoins = timeTrialCoins(validLaps, previous?.best ?? null).coins;
  }
  if (run.event_id === 'guided-first-race') {
    const earlier = await one<{ run_id: string }>(
      tx,
      `select run_id from runs where player_id = $1 and event_id = 'guided-first-race'
         and status = 'verified' and run_id <> $2 limit 1`,
      [run.player_id, run.run_id],
    );
    if (!earlier) resultCoins += GUIDED_FIRST_RACE_COINS;
  }
  resultCoins = applyLoaner(resultCoins, run.loaner);

  if (resultCoins > 0) {
    await writeMovement(tx, {
      playerId: run.player_id,
      kind: 'result',
      amount: resultCoins,
      runId: run.run_id,
    });
    total += resultCoins;
  }
  return total;
}

function boardValue(run: RunRow, results: RunResults): number | null {
  if (run.mode === 'time-trial') return results.bestLapMs;
  if (run.mode === 'circuit') {
    return results.lapResults.every((lap) => lap.valid) ? results.raceMs : null;
  }
  if (run.mode === 'drift') {
    return results.lapResults.every((lap) => lap.valid) ? (results.driftScore ?? 0) : null;
  }
  return null;
}

async function updateBoard(tx: Queryable, run: RunRow, results: RunResults): Promise<void> {
  if (!isBoardMode(run.mode)) return;
  const value = boardValue(run, results);
  if (value === null) return;
  const className: CarClass = carSpec(run.car_id).class;
  const improved = await recordBoardValue(tx, {
    layoutId: run.layout_id,
    mode: run.mode,
    class: className,
    playerId: run.player_id,
    runId: run.run_id,
    carId: run.car_id,
    value,
    topSpeedMps: results.topSpeedMps,
  });
  if (!improved) return;
  const board = await readBoard(tx, run.layout_id, run.mode, className, run.player_id);
  const row = board.rows.find((entry) => entry.playerId === run.player_id);
  if (row) pushBoard(run.layout_id, run.mode, className, row);
}

async function updateChampionship(
  tx: Queryable,
  run: RunRow,
  results: RunResults,
): Promise<void> {
  if (run.event_id === null) return;
  const event = findEvent(run.event_id);
  if (!event || event.leagueId === null) return;
  let points = 0;
  if (event.mode === 'circuit') points = circuitEventPoints(results.position ?? 0);
  else if (event.mode === 'drift') points = driftEventPoints(results.driftScore ?? 0);
  else if (event.mode === 'time-trial') points = timeTrialEventPoints(results.bestLapMs);
  await recordEventPoints(tx, run.player_id, run.event_id, points);
  await pushChampionship(tx, run.player_id);
}
