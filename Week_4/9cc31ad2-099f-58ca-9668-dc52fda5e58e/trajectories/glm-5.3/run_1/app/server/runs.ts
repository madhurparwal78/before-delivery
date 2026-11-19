// Runs: creation, replay storage, verification, payouts, boards and championship.
import type { Db } from './db.js';
import type { Config } from './config.js';
import type { PushHub } from './push.js';
import type { ReplayStore } from './replayStore.js';
import { notFound } from './errors.js';
import { shortId, runSeed, sha256Hex } from './ids.js';
import { balanceOf, writeMovement } from './ledger.js';
import { PlayerLocks } from './locks.js';
import { setupFor, carById, zeroStages, LAYOUTS, EVENTS, CIRCUIT_RESULT_COINS, CLEAN_BONUS_DIVISOR,
  GUIDED_FIRST_RACE_COINS, DRIFT_COIN_CAP, TIME_TRIAL_LAP_COINS, type LayoutId, type ModeId,
  type Stages, stepLimitFor, LEAGUES, LEAGUE_COMPLETE_POINTS, FINALS_REWARD, DEFAULT_LAPS } from '../shared/domain.js';
import { runRace, type Pedals, RaceCar, referenceInputs } from '../shared/raceModel.js';
import { checkReplayTopLevel, checkReplayEvents, inputAtStep, type InputEvent } from '../shared/replay.js';

export interface RunRow {
  runId: string;
  playerId: string;
  layoutId: string;
  mode: string;
  carId: string;
  eventId: string | null;
  loaner: boolean;
  laps: number;
  stepLimit: number;
  seed: string;
  status: string;
  reason: string | null;
  carStats: { accelMps2: number; brakeMps2: number; topMps: number; gripPct: number; laneChangeSteps: number };
  carStages: Stages;
  replaySha: string | null;
}

export interface CreateRunInput {
  layoutId: LayoutId;
  mode: ModeId;
  carId?: string;
  eventId?: string;
  laps?: number;
  loaner?: boolean;
}

export interface CreateRunResult {
  run: RunRow;
  ai: { name: string; carId: string; paceFactor: number }[];
}

/** Creates a run, applying the event, class and league rules. */
export async function createRun(db: Db, playerId: string, input: CreateRunInput): Promise<CreateRunResult> {
  let layoutId = input.layoutId;
  let mode = input.mode;
  let laps = input.laps;
  let eventId = input.eventId ?? null;
  let loaner = input.loaner === true;

  if (eventId !== null) {
    const ev = EVENTS[eventId];
    if (!ev) throw notFound('Unknown event.');
    layoutId = ev.layoutId;
    mode = ev.mode;
    laps = ev.laps;
  } else {
    if (!layoutId || !(layoutId in LAYOUTS)) throw notFound('Unknown map.');
    if (loaner) {
      throw new ApiErrorLite(409, 'LOANER_NOT_OFFERED', 'No event offers a loaner here.');
    }
    if (layoutId === 'quarry-switchbacks') {
      const flags = await playerFlags(db, playerId);
      if (!flags.rookieComplete) throw new ApiErrorLite(403, 'LAYOUT_LOCKED', 'This map is locked.');
    }
  }

  const layout = LAYOUTS[layoutId as LayoutId];
  if (!layout) throw new ApiErrorLite(403, 'LAYOUT_LOCKED', 'This map is locked.');

  // The garage's selected car when the request names none.
  let carId = input.carId ?? '';
  if (!carId) {
    const selR = await db.query(
      'SELECT car_id FROM owned_cars WHERE player_id = $1 AND selected = true', [playerId]);
    carId = selR.rows[0]?.car_id ?? '';
  }
  if (eventId !== null) {
    const ev = EVENTS[eventId];
    const flags = await playerFlags(db, playerId);
    // A locked league answers LEAGUE_LOCKED before the map lock is reached.
    if (ev.league === 'club' && !flags.rookieComplete) {
      throw new ApiErrorLite(403, 'LEAGUE_LOCKED', 'This league is locked.');
    }
    // Quarry Switchbacks is locked until the Rookie league is complete.
    if (layoutId === 'quarry-switchbacks' && !flags.rookieComplete) {
      throw new ApiErrorLite(403, 'LAYOUT_LOCKED', 'This map is locked.');
    }
    if (loaner) {
      const ownsEligible = await ownsEligibleCar(db, playerId, ev.class);
      if (ownsEligible) throw new ApiErrorLite(409, 'LOANER_NOT_OFFERED', 'You own an eligible car.');
      carId = ev.loanerCarId ?? '';
    } else {
      const spec = carById(carId);
      const owned = spec ? await ownsCar(db, playerId, carId) : false;
      if (!owned) throw notFound('Car not owned.');
      if (spec && (spec.class !== ev.class || spec.pi > (ev.class === 'D' ? 299 : ev.class === 'C' ? 499 : 699))) {
        throw new ApiErrorLite(409, 'CAR_NOT_ELIGIBLE', 'That car cannot enter this event.');
      }
    }
  } else {
    const owned = await ownsCar(db, playerId, carId);
    if (!owned) throw notFound('Car not owned.');
  }

  if (laps === undefined) {
    laps = eventId !== null ? EVENTS[eventId].laps : DEFAULT_LAPS[mode];
  }
  const stepLimit = stepLimitFor(mode, laps);

  const spec = carById(carId);
  if (!spec) throw notFound('Car not owned.');
  const stages = await stagesFor(db, playerId, carId);
  const { stats } = setupFor(spec, loaner ? zeroStages() : stages);

  const runId = `run_${shortId(12)}`;
  const seed = runSeed();
  await db.query(
    `INSERT INTO runs (run_id, player_id, layout_id, mode, car_id, event_id, loaner, laps, step_limit, seed, status, car_stats, car_stages)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'started',$11,$12)`,
    [runId, playerId, layoutId, mode, carId, eventId, loaner, laps, stepLimit, seed,
     JSON.stringify(stats), JSON.stringify(loaner ? zeroStages() : stages)]
  );

  let ai: { name: string; carId: string; paceFactor: number }[] = [];
  if (mode === 'circuit') {
    const aiCarIds = eventId !== null ? (EVENTS[eventId].aiCarIds ?? [carId, carId]) : [carId, carId];
    ai = [
      { name: 'Pip Marlowe', carId: aiCarIds[0], paceFactor: 1.15 },
      { name: 'Isa Corrow', carId: aiCarIds[1], paceFactor: 1.04 }
    ];
  }
  return { run: { runId, playerId, layoutId, mode, carId, eventId, loaner, laps, stepLimit, seed, status: 'started', reason: null, carStats: stats, carStages: loaner ? zeroStages() : stages, replaySha: null }, ai };
}

export class ApiErrorLite extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}


export async function ownsCar(db: Db, playerId: string, carId: string): Promise<boolean> {
  const r = await db.query('SELECT 1 FROM owned_cars WHERE player_id = $1 AND car_id = $2', [playerId, carId]);
  return r.rows.length > 0;
}

export async function ownsEligibleCar(db: Db, playerId: string, cls: 'D' | 'C' | 'B'): Promise<boolean> {
  const r = await db.query('SELECT car_id FROM owned_cars WHERE player_id = $1', [playerId]);
  for (const row of r.rows as { car_id: string }[]) {
    const spec = carById(row.car_id);
    if (spec && spec.class === cls && spec.pi <= (cls === 'D' ? 299 : cls === 'C' ? 499 : 699)) {
      // An owned car whose stages push PI over the class top is ineligible.
      const stages = await stagesFor(db, playerId, row.car_id);
      const { pi } = setupFor(spec, stages);
      if (pi <= (cls === 'D' ? 299 : cls === 'C' ? 499 : 699)) return true;
    }
  }
  return false;
}

export async function stagesFor(db: Db, playerId: string, carId: string): Promise<Stages> {
  const r = await db.query('SELECT system, stage FROM car_stages WHERE player_id = $1 AND car_id = $2', [playerId, carId]);
  const stages = zeroStages();
  for (const row of r.rows as { system: string; stage: number }[]) {
    if (['engine', 'tires', 'brakes', 'suspension'].includes(row.system)) {
      stages[row.system as 'engine' | 'tires' | 'brakes' | 'suspension'] = row.stage;
    }
  }
  return stages;
}

export interface PlayerFlags {
  rookieComplete: boolean;
  clubComplete: boolean;
  trophy: boolean;
  guidedPaid: boolean;
}

export async function playerFlags(db: Db, playerId: string): Promise<PlayerFlags> {
  const r = await db.query('SELECT rookie_complete, club_complete, trophy, guided_paid FROM player_flags WHERE player_id = $1', [playerId]);
  if (r.rows.length === 0) {
    return { rookieComplete: false, clubComplete: false, trophy: false, guidedPaid: false };
  }
  const row = r.rows[0];
  return { rookieComplete: row.rookie_complete, clubComplete: row.club_complete, trophy: row.trophy, guidedPaid: row.guided_paid };
}

export interface FinishOutcome {
  runId: string;
  status: 'verifying' | 'held' | 'verified' | 'rejected';
}

/** A finish request: stores the bytes, then moves the run to verifying or held. */
export async function finishRun(db: Db, cfg: Config, store: ReplayStore, locks: PlayerLocks,
                                hub: PushHub, runId: string, playerId: string, bytes: Buffer): Promise<FinishOutcome> {
  const run = await getRun(db, runId, playerId, true);
  if (!run) throw notFound('No such run.');
  if (run.status !== 'started') {
    // A repeat: answer the current status without writing anything.
    return { runId, status: run.status as FinishOutcome['status'] };
  }
  const sha = sha256Hex(bytes);
  await db.query('UPDATE runs SET status = $2, replay_sha = $3, held_bytes = $4 WHERE run_id = $1',
    [runId, 'submitted', sha, bytes]);
  hub.sendToPlayer(playerId, { type: 'run', runId, status: 'submitted' });

  const stored = await store.putReplay(runId, bytes, sha);
  if (stored) {
    await db.query('UPDATE runs SET status = $2, stored_at = now(), held_bytes = NULL WHERE run_id = $1', [runId, 'verifying']);
    hub.sendToPlayer(playerId, { type: 'run', runId, status: 'verifying' });
    scheduleVerify(db, cfg, store, locks, hub, runId, playerId);
    return { runId, status: 'verifying' };
  }
  await db.query('UPDATE runs SET status = $2 WHERE run_id = $1', [runId, 'held']);
  hub.sendToPlayer(playerId, { type: 'run', runId, status: 'held' });
  scheduleHeldRetry(db, cfg, store, locks, hub, runId, playerId);
  return { runId, status: 'held' };
}

const heldRetries = new Set<string>();

function scheduleHeldRetry(db: Db, cfg: Config, store: ReplayStore, locks: PlayerLocks,
                           hub: PushHub, runId: string, playerId: string): void {
  if (heldRetries.has(runId)) return;
  heldRetries.add(runId);
  const tick = async (): Promise<void> => {
    try {
      const run = await getRun(db, runId, playerId, true);
      if (!run || run.status !== 'held') {
        heldRetries.delete(runId);
        return;
      }
      const bytes = await getHeldBytes(db, runId);
      if (!bytes) { heldRetries.delete(runId); return; }
      const ok = await store.putReplay(runId, bytes, run.replaySha ?? sha256Hex(bytes));
      if (ok) {
        heldRetries.delete(runId);
        await db.query('UPDATE runs SET status = $2, stored_at = now(), held_bytes = NULL WHERE run_id = $1', [runId, 'verifying']);
        hub.sendToPlayer(playerId, { type: 'run', runId, status: 'verifying' });
        scheduleVerify(db, cfg, store, locks, hub, runId, playerId);
        return;
      }
    } catch (err) {
      console.error('held retry error', runId, (err as Error).message);
    }
    setTimeout(tick, 5000).unref?.();
  };
  setTimeout(tick, 5000).unref?.();
}

function scheduleVerify(db: Db, cfg: Config, store: ReplayStore, locks: PlayerLocks,
                        hub: PushHub, runId: string, playerId: string): void {
  setTimeout(() => {
    void verifyRun(db, cfg, store, locks, hub, runId, playerId);
  }, cfg.verifyDelayMs).unref?.();
}

/** Verification: replays the stored bytes through the race model. */
export async function verifyRun(db: Db, cfg: Config, store: ReplayStore, locks: PlayerLocks,
                                hub: PushHub, runId: string, playerId: string): Promise<void> {
  await locks.run(playerId, async () => {
    const run = await getRun(db, runId, playerId, true);
    if (!run || run.status !== 'verifying') return;
    let bytes: Buffer | null = null;
    try {
      bytes = await store.getReplay(runId);
    } catch {
      bytes = null;
    }
    if (!bytes) {
      bytes = await getHeldBytes(db, runId);
    }
    if (!bytes) {
      await db.query('UPDATE runs SET status = $2, reason = $3 WHERE run_id = $1', [runId, 'rejected', 'invalid_inputs']);
      hub.sendToPlayer(playerId, { type: 'run', runId, status: 'rejected' });
      return;
    }
    const reason = await verifyBytes(db, cfg, hub, run, bytes);
    if (reason !== null) {
      await db.query('UPDATE runs SET status = $2, reason = $3, finished_at = now() WHERE run_id = $1', [runId, 'rejected', reason]);
      hub.sendToPlayer(playerId, { type: 'run', runId, status: 'rejected' });
    }
  });
}

async function getHeldBytes(db: Db, runId: string): Promise<Buffer | null> {
  const r = await db.query('SELECT held_bytes FROM runs WHERE run_id = $1', [runId]);
  const row = r.rows[0];
  return row?.held_bytes ? Buffer.from(row.held_bytes) : null;
}

/** Returns null when the run verifies, or the reject reason. Writes results and pays. */
async function verifyBytes(db: Db, cfg: Config, hub: PushHub, run: RunRow, bytes: Buffer): Promise<string | null> {
  void cfg;
  const top = checkReplayTopLevel(new Uint8Array(bytes));
  if (top === 'invalid_inputs') return 'invalid_inputs';
  const parsed = JSON.parse(bytes.toString('utf-8'));
  if (top.seed !== run.seed) return 'seed_mismatch';
  const events = checkReplayEvents(parsed, run.stepLimit);
  if (events === 'invalid_inputs') return 'invalid_inputs';

  const layout = LAYOUTS[run.layoutId as LayoutId];
  const collectCoins = run.mode === 'practice' || run.mode === 'circuit';
  const scoreDrift = run.mode === 'drift';
  const inputAt = inputAtStep(events as InputEvent[]);
  const outcome = runRace(layout, run.carStats, run.laps, run.stepLimit, collectCoins, scoreDrift, inputAt);

  if (!outcome.finished) return 'did_not_finish';
  void RaceCar;
  void referenceInputs;

  // Position for circuit runs: the player against the two AI drivers.
  let position: number | null = null;
  if (run.mode === 'circuit') {
    position = 1;
    const aiCarIds = run.eventId ? (EVENTS[run.eventId].aiCarIds ?? [run.carId, run.carId]) : [run.carId, run.carId];
    for (let i = 0; i < 2; i++) {
      const aiCar = carById(aiCarIds[i]);
      if (!aiCar) continue;
      const { stats } = setupFor(aiCar, zeroStages());
      const factor = i === 0 ? 1.15 : 1.04;
      const aiOutcome = aiRaceMs(layout, stats, run.laps, factor);
      if (aiOutcome < outcome.raceMs) position++;
    }
  }

  const carSpec = carById(run.carId);
  const cls = carSpec?.class ?? 'D';

  await db.query(
    `UPDATE runs SET status = $2, lap_results = $3, race_ms = $4, best_lap_ms = $5, drift_score = $6,
     coins_collected = $7, position = $8, clean = $9, top_speed_mps = $10, finished_at = now()
     WHERE run_id = $1`,
    [run.runId, 'verified', JSON.stringify(outcome.lapResults), outcome.raceMs, outcome.bestLapMs,
     outcome.driftScore, outcome.coinsCollected, position, outcome.clean, outcome.topSpeedMps]
  );

  // Payouts
  const payouts: { kind: string; amount: number }[] = [];
  let total = 0;
  if (collectCoins && outcome.coinsCollected > 0) {
    payouts.push({ kind: 'pickups', amount: outcome.coinsCollected });
  }
  if (run.mode === 'practice' && run.eventId === 'guided-first-race') {
    const flags = await playerFlags(db, run.playerId);
    if (!flags.guidedPaid) {
      payouts.push({ kind: 'guided', amount: GUIDED_FIRST_RACE_COINS });
    }
  }
  if (run.mode === 'drift') {
    const coins = Math.min(Math.floor(outcome.driftScore / 1000), DRIFT_COIN_CAP);
    if (coins > 0) payouts.push({ kind: 'result', amount: coins });
  }
  if (run.mode === 'time-trial') {
    // Laps in order; the first valid lap pays, then strictly faster laps.
    const flags = await timeTrialHistory(db, run.playerId, run.layoutId);
    let firstEver = !flags.hasAny;
    let bestSoFar = flags.bestMs;
    for (const lap of outcome.lapResults) {
      if (!lap.valid) continue;
      if (firstEver || (bestSoFar !== null && lap.lapMs < bestSoFar)) {
        payouts.push({ kind: 'result', amount: TIME_TRIAL_LAP_COINS });
        firstEver = false;
        bestSoFar = lap.lapMs;
      }
    }
  }
  if (run.mode === 'circuit' && position !== null && outcome.lapResults.every(l => l.valid)) {
    const base = CIRCUIT_RESULT_COINS[position] ?? 0;
    let amount = base;
    if (outcome.clean) amount += Math.floor(base / CLEAN_BONUS_DIVISOR);
    if (run.loaner) amount = Math.floor(amount / 2);
    if (amount > 0) payouts.push({ kind: 'result', amount });
  }
  for (const p of payouts) total += p.amount;
  await db.query('UPDATE runs SET payouts = $2, payout = $3 WHERE run_id = $1', [run.runId, JSON.stringify(payouts), total]);

  // Boards: circuit requires every lap valid; drift requires no invalid lap.
  const boardValue = boardValueFor(run.mode, outcome);
  if (boardValue !== null) {
    await db.query(
      `INSERT INTO boards (layout_id, mode, class, player_id, run_id, value, top_speed_mps, replay_sha, verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
       ON CONFLICT (layout_id, mode, class, player_id)
       DO UPDATE SET run_id = $5, value = $6, top_speed_mps = $7, replay_sha = $8, verified_at = now()
       WHERE boards.value ${
         (run.mode === 'drift') ? '<' : '>'
       } EXCLUDED.value`,
      [run.layoutId, run.mode, cls, run.playerId, run.runId, boardValue.value, outcome.topSpeedMps, run.replaySha]
    );
    const row = await boardRow(db, run.layoutId, run.mode, cls, run.playerId);
    if (row) {
      hub.sendToAll({ type: 'board', layoutId: run.layoutId, mode: run.mode, class: cls, row });
    }
  }

  // Championship points and payouts
  if (total > 0) {
    for (const p of payouts) {
      const kind = p.kind === 'pickups' ? 'pickups' : (p.kind === 'guided' ? 'finals' : 'result');
      await writeMovement(db, run.playerId, kind as 'pickups' | 'finals' | 'result', p.amount, run.runId);
    }
    const balance = await balanceOf(db, run.playerId);
    hub.sendToPlayer(run.playerId, {
      type: 'balance', balance, movementId: `run_${run.runId}_${payouts[0]?.kind ?? 'none'}`, purchaseId: null
    });
  }
  await db.query('UPDATE runs SET status = $2, finished_at = now() WHERE run_id = $1',
    [run.runId, 'verified']);
  if (run.eventId) {
    await applyEventPoints(db, hub, run.playerId, run.eventId, run.mode, outcome, position);
  }
  hub.sendToPlayer(run.playerId, { type: 'run', runId: run.runId, status: 'verified' });
  return null;
}

function aiRaceMs(layout: { corners: unknown[]; length: number }, stats: { accelMps2: number; brakeMps2: number; topMps: number; gripPct: number; laneChangeSteps: number }, laps: number, factor: number): number {
  // The AI runs the reference driver, slowed by the pace factor.
  const evts = referenceInputs(layout as never, stats, laps, laps * 7200);
  const refMs = refRaceMs(layout as never, stats, laps, evts);
  return Math.round(refMs * factor);
}

function refRaceMs(layout: { length: number }, stats: { accelMps2: number; brakeMps2: number; topMps: number; gripPct: number; laneChangeSteps: number }, laps: number, events: InputEvent[]): number {
  const inputAt = inputAtStep(events);
  const out = runRace(layout as never, stats, laps, laps * 7200, false, false, inputAt);
  return out.raceMs;
}

function boardValueFor(mode: string, outcome: { lapResults: { valid: boolean; lapMs: number }[]; raceMs: number; driftScore: number; bestLapMs: number | null }): { value: number } | null {
  if (mode === 'time-trial') {
    const best = outcome.lapResults.find(l => l.valid);
    if (!best) return null;
    return { value: best.lapMs };
  }
  if (mode === 'circuit') {
    if (!outcome.lapResults.every(l => l.valid)) return null;
    return { value: outcome.raceMs };
  }
  if (mode === 'drift') {
    if (!outcome.lapResults.every(l => l.valid)) return null;
    return { value: outcome.driftScore };
  }
  return null;
}

async function boardRow(db: Db, layoutId: string, mode: string, cls: string, playerId: string): Promise<unknown> {
  const r = await db.query(
    'SELECT layout_id, mode, class, player_id, run_id, value, top_speed_mps, replay_sha, verified_at FROM boards WHERE layout_id = $1 AND mode = $2 AND class = $3 AND player_id = $4',
    [layoutId, mode, cls, playerId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const first = await db.query(
    `SELECT value FROM boards WHERE layout_id = $1 AND mode = $2 AND class = $3 ORDER BY value ${mode === 'drift' ? 'DESC' : 'ASC'}, verified_at ASC LIMIT 1`,
    [layoutId, mode, cls]
  );
  const gapMs = first.rows[0] ? row.value - first.rows[0].value : null;
  return {
    rank: 1, playerId: row.player_id, name: (await playerName(db, row.player_id)) ?? '',
    runId: row.run_id, carId: '', value: row.value,
    unit: mode === 'drift' ? 'points' : 'ms',
    gapMs: mode === 'drift' ? null : gapMs, topSpeedMps: row.top_speed_mps,
    replaySha256: row.replay_sha, mine: false
  };
}

export async function playerName(db: Db, playerId: string): Promise<string | null> {
  const r = await db.query('SELECT name FROM players WHERE player_id = $1', [playerId]);
  return r.rows[0]?.name ?? null;
}

async function timeTrialHistory(db: Db, playerId: string, layoutId: string): Promise<{ hasAny: boolean; bestMs: number | null }> {
  // The player's earlier verified valid time-trial laps on this layout, in any car.
  const r = await db.query(
    `SELECT lap_results FROM runs WHERE player_id = $1 AND layout_id = $2 AND mode = 'time-trial' AND status = 'verified'`,
    [playerId, layoutId]
  );
  let bestMs: number | null = null;
  let hasAny = false;
  for (const row of r.rows as { lap_results: { valid: boolean; lapMs: number }[] | null }[]) {
    if (!row.lap_results) continue;
    for (const lap of row.lap_results) {
      if (!lap.valid) continue;
      hasAny = true;
      if (bestMs === null || lap.lapMs < bestMs) bestMs = lap.lapMs;
    }
  }
  return { hasAny, bestMs };
}

/** Championship: points, league completion, unlocks, finals reward. */
async function applyEventPoints(db: Db, hub: PushHub, playerId: string, eventId: string,
                               mode: string, outcome: { lapResults: { valid: boolean; lapMs: number }[]; raceMs: number; driftScore: number; clean: boolean },
                               position: number | null): Promise<void> {
  const ev = EVENTS[eventId];
  if (!ev || ev.league === null) {
    // guided-first-race has no points
    if (eventId === 'guided-first-race') {
      await db.query('INSERT INTO player_flags (player_id, guided_paid) VALUES ($1,true) ON CONFLICT (player_id) DO UPDATE SET guided_paid = true', [playerId]);
    }
    return;
  }
  let points = 0;
  if (eventId === 'rookie-circuit' || eventId === 'club-circuit') {
    if (position === 1) points = 25;
    else if (position === 2) points = 18;
    else if (position === 3) points = 15;
  } else if (eventId === 'rookie-drift') {
    points = Math.min(Math.floor(outcome.driftScore / 1000), 25);
  } else if (eventId === 'rookie-time-trial' || eventId === 'club-time-trial') {
    const best = outcome.lapResults.find(l => l.valid);
    points = best !== undefined && best.lapMs <= 60000 ? 25 : 10;
  }
  const best = await db.query('SELECT points FROM event_points WHERE player_id = $1 AND event_id = $2', [playerId, eventId]);
  const currentBest = best.rows[0]?.points ?? 0;
  if (points > currentBest) {
    await db.query(
      'INSERT INTO event_points (player_id, event_id, points) VALUES ($1,$2,$3) ON CONFLICT (player_id, event_id) DO UPDATE SET points = $3',
      [playerId, eventId, points]
    );
  }
  // League totals and completion
  const leagueId = ev.league;
  const league = LEAGUES.find(l => l.leagueId === leagueId);
  if (!league) return;
  const totals = await leaguePoints(db, playerId);
  const total = totals.get(leagueId) ?? 0;
  if (total >= LEAGUE_COMPLETE_POINTS) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      if (leagueId === 'rookie') {
        await client.query(
          'INSERT INTO player_flags (player_id, rookie_complete) VALUES ($1,true) ON CONFLICT (player_id) DO UPDATE SET rookie_complete = true',
          [playerId]
        );
      } else {
        const flags = await playerFlags(db, playerId);
        if (flags.clubComplete) {
          await client.query('ROLLBACK');
          return;
        }
        await client.query(
          'INSERT INTO player_flags (player_id, club_complete, trophy) VALUES ($1,true,true) ON CONFLICT (player_id) DO UPDATE SET club_complete = true, trophy = true',
          [playerId]
        );
        await writeMovement(db, playerId, 'finals', FINALS_REWARD, null);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  const body = await championshipBody(db, playerId);
  hub.sendToPlayer(playerId, { type: 'championship', leagues: body.leagues, trophy: body.trophy });
}

export async function leaguePoints(db: Db, playerId: string): Promise<Map<string, number>> {
  const r = await db.query('SELECT event_id, points FROM event_points WHERE player_id = $1', [playerId]);
  const byEvent = new Map<string, number>();
  for (const row of r.rows as { event_id: string; points: number }[]) byEvent.set(row.event_id, row.points);
  const totals = new Map<string, number>();
  for (const league of LEAGUES) {
    let total = 0;
    for (const id of league.eventIds) total += byEvent.get(id) ?? 0;
    totals.set(league.leagueId, total);
  }
  return totals;
}

export async function championshipBody(db: Db, playerId: string): Promise<{ leagues: unknown[]; trophy: boolean }> {
  const flags = await playerFlags(db, playerId);
  const totals = await leaguePoints(db, playerId);
  const r = await db.query('SELECT event_id, points FROM event_points WHERE player_id = $1', [playerId]);
  const byEvent = new Map<string, number>();
  for (const row of r.rows as { event_id: string; points: number }[]) byEvent.set(row.event_id, row.points);
  const leagues = LEAGUES.map(league => {
    const total = totals.get(league.leagueId) ?? 0;
    const complete = league.leagueId === 'rookie' ? flags.rookieComplete : flags.clubComplete;
    const status = complete ? 'complete' : (league.leagueId === 'rookie' || flags.rookieComplete) ? 'open' : 'locked';
    return {
      leagueId: league.leagueId,
      status,
      points: total,
      events: league.eventIds.map(id => {
        const ev = EVENTS[id];
        return {
          eventId: id, name: ev.name, mode: ev.mode, layoutId: ev.layoutId, class: ev.class,
          points: byEvent.get(id) ?? 0,
          eligible: true, loanerCarId: ev.loanerCarId
        };
      })
    };
  });
  return { leagues, trophy: flags.trophy };
}

export async function getRun(db: Db, runId: string, viewerId: string | null, own: boolean): Promise<RunRow | null> {
  const r = await db.query(
    'SELECT run_id, player_id, layout_id, mode, car_id, event_id, loaner, laps, step_limit, seed, status, reason, car_stats, car_stages, replay_sha FROM runs WHERE run_id = $1',
    [runId]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  if (own && row.player_id !== viewerId) return null;
  if (!own && viewerId !== null && row.player_id !== viewerId && row.status !== 'verified') return null;
  if (!own && viewerId === null && row.status !== 'verified') return null;
  return {
    runId: row.run_id, playerId: row.player_id, layoutId: row.layout_id, mode: row.mode,
    carId: row.car_id, eventId: row.event_id, loaner: row.loaner, laps: row.laps,
    stepLimit: row.step_limit, seed: row.seed, status: row.status, reason: row.reason,
    carStats: row.car_stats, carStages: row.car_stages, replaySha: row.replay_sha
  };
}

