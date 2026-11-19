import { randomUUID, randomBytes } from 'node:crypto';
import {
  AI_DRIVERS,
  type CarStats,
  type LayoutId,
  LAYOUTS,
  LOANER_CAR_BY_CLASS,
  type RaceMode,
  type StageMap,
  defaultLaps,
  findEvent,
  isEligible,
  isLayoutId,
  lapsAllowed,
  stepLimitFor,
  statsWithStages,
} from '../shared/catalogue.js';
import type { Queryable } from './db.js';
import { db, one } from './db.js';
import { conflict, forbidden, notFound, validationFailed } from './errors.js';
import { ownedCar, ownedCars } from './garage.js';
import { ownsEligibleCar, quarryUnlocked, leagueCompleted } from './championship.js';

export const STOCK_STAGES: StageMap = { engine: 0, tires: 0, brakes: 0, suspension: 0 };

export interface RunRow {
  run_id: string;
  player_id: string;
  layout_id: LayoutId;
  mode: RaceMode;
  car_id: string;
  event_id: string | null;
  laps: number;
  step_limit: number;
  loaner: boolean;
  seed: string;
  status: string;
  reason: string | null;
  car_stats: CarStats;
  car_stages: StageMap;
  replay_sha256: string | null;
  lap_results: unknown;
  race_ms: number | null;
  best_lap_ms: number | null;
  drift_score: number | null;
  coins_collected: number | null;
  position: number | null;
  clean: boolean | null;
  payout: number | null;
  top_speed_mps: number | null;
}

export interface AiEntry {
  name: string;
  carId: string;
  paceFactor: number;
}

/** The AI field for a run: two reference drivers, or none outside circuit races. */
export function aiEntriesFor(mode: RaceMode, eventId: string | null, carId: string): AiEntry[] {
  if (mode !== 'circuit') return [];
  const event = eventId === null ? undefined : findEvent(eventId);
  const aiCarId = event?.aiCarId ?? carId;
  return AI_DRIVERS.map((driver) => ({
    name: driver.name,
    carId: aiCarId,
    paceFactor: driver.paceFactor,
  }));
}

export interface CreatedRun {
  runId: string;
  seed: string;
  layoutId: LayoutId;
  mode: RaceMode;
  carId: string;
  laps: number;
  stepLimit: number;
  loaner: boolean;
  car: { stats: CarStats; stages: StageMap };
  ai: AiEntry[];
}

export async function createRun(
  tx: Queryable,
  playerId: string,
  body: Record<string, unknown>,
): Promise<CreatedRun> {
  const wantsLoaner = body.loaner === true;

  let event = undefined;
  if (body.eventId !== undefined && body.eventId !== null) {
    if (typeof body.eventId !== 'string') throw validationFailed({ eventId: 'Unknown event.' });
    event = findEvent(body.eventId);
    if (!event) throw notFound();
  }

  const requestedCarId = body.carId;
  let owned = null;
  if (!wantsLoaner && typeof requestedCarId === 'string') {
    owned = await ownedCar(tx, playerId, requestedCarId);
    if (!owned) throw notFound();
  }

  const layoutId = event ? event.layoutId : body.layoutId;
  const mode = event ? event.mode : body.mode;

  if (event?.leagueId === 'club' && !(await leagueCompleted(tx, playerId, 'rookie'))) {
    throw forbidden('LEAGUE_LOCKED', 'The Club league is locked.');
  }
  if (layoutId === 'quarry-switchbacks' && !(await quarryUnlocked(tx, playerId))) {
    throw forbidden('LAYOUT_LOCKED', 'Quarry Switchbacks is locked.');
  }

  const eventClass = event?.class ?? null;
  if (wantsLoaner) {
    if (!event || eventClass === null) {
      throw conflict('LOANER_NOT_OFFERED', 'This race offers no loaner car.');
    }
    const cars = await ownedCars(tx, playerId);
    if (ownsEligibleCar(cars, eventClass)) {
      throw conflict('LOANER_NOT_OFFERED', 'You own a car for this event.');
    }
  } else if (owned && eventClass !== null && !isEligible(owned.carId, owned.stages, eventClass)) {
    throw conflict('CAR_NOT_ELIGIBLE', 'That car cannot enter this event.');
  }

  let ownedCarId: string | null = null;
  if (!wantsLoaner) {
    if (typeof requestedCarId !== 'string') {
      throw validationFailed({ carId: 'Choose a car to race.' });
    }
    ownedCarId = requestedCarId;
  }
  if (!isLayoutId(layoutId)) throw validationFailed({ layoutId: 'Choose a map.' });
  if (mode !== 'practice' && mode !== 'circuit' && mode !== 'drift' && mode !== 'time-trial') {
    throw validationFailed({ mode: 'Choose a race mode.' });
  }

  let laps: number;
  if (event) {
    laps = event.laps;
  } else if (body.laps === undefined || body.laps === null) {
    laps = defaultLaps(mode);
  } else if (
    typeof body.laps === 'number' &&
    Number.isInteger(body.laps) &&
    lapsAllowed(mode, body.laps)
  ) {
    laps = body.laps;
  } else {
    throw validationFailed({ laps: 'Choose a lap count this mode allows.' });
  }

  const carId = wantsLoaner ? LOANER_CAR_BY_CLASS[eventClass!] : ownedCarId!;
  const stages = wantsLoaner ? STOCK_STAGES : owned!.stages;
  const stats = statsWithStages(carId, stages);
  const stepLimit = stepLimitFor(mode, laps);
  const runId = randomUUID();
  const seed = randomBytes(8).toString('hex');

  await tx.query(
    `insert into runs (run_id, player_id, layout_id, mode, car_id, event_id, laps, step_limit,
       loaner, seed, status, car_stats, car_stages)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'started', $11, $12)`,
    [
      runId,
      playerId,
      layoutId,
      mode,
      carId,
      event?.eventId ?? null,
      laps,
      stepLimit,
      wantsLoaner,
      seed,
      JSON.stringify(stats),
      JSON.stringify(stages),
    ],
  );

  return {
    runId,
    seed,
    layoutId,
    mode,
    carId,
    laps,
    stepLimit,
    loaner: wantsLoaner,
    car: { stats, stages },
    ai: aiEntriesFor(mode, event?.eventId ?? null, carId),
  };
}

export async function loadRun(tx: Queryable, runId: string): Promise<RunRow | null> {
  return await one<RunRow>(tx, 'select * from runs where run_id = $1', [runId]);
}

export function runConfig(run: RunRow) {
  return {
    layout: LAYOUTS[run.layout_id],
    stats: run.car_stats,
    mode: run.mode,
    laps: run.laps,
    stepLimit: run.step_limit,
  };
}

export async function runBody(runId: string): Promise<Record<string, unknown> | null> {
  const row = await one<RunRow & { name: string }>(
    db,
    `select r.*, p.name from runs r join players p on p.player_id = r.player_id
     where r.run_id = $1`,
    [runId],
  );
  if (!row) return null;
  return {
    runId: row.run_id,
    playerId: row.player_id,
    name: row.name,
    status: row.status,
    reason: row.reason,
    layoutId: row.layout_id,
    mode: row.mode,
    carId: row.car_id,
    eventId: row.event_id,
    loaner: row.loaner,
    car: { stats: row.car_stats, stages: row.car_stages },
    lapResults: row.lap_results,
    raceMs: row.race_ms,
    bestLapMs: row.best_lap_ms,
    driftScore: row.drift_score,
    coinsCollected: row.coins_collected,
    position: row.position,
    clean: row.clean,
    payout: row.payout,
    topSpeedMps: row.top_speed_mps,
    replaySha256: row.replay_sha256,
  };
}
