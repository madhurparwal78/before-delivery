// Players, sessions, garages, purchases, refits: the per-player game state.
import type { Db } from './db.js';
import { ApiError, notFound, insufficientCoins } from './errors.js';
import { balanceOf, writeMovement, MovementKind } from './ledger.js';
import { shortId, tokenHex } from './ids.js';
import {
  CARS, carById, CLASS_TOP, LAYOUTS, OPENING_BALANCE, setupFor, SYSTEM_IDS,
  upgradePrice, zeroStages, type LayoutId, type Stages, type SystemId
} from '../shared/domain.js';
import { runRace, referenceInputs, type Pedals } from '../shared/raceModel.js';

export interface PlayerRow {
  playerId: string;
  name: string;
  guest: boolean;
  email: string | null;
  units: 'kmh' | 'mph';
}

export async function createSession(db: Db, playerId: string): Promise<string> {
  const token = tokenHex(24);
  await db.query('INSERT INTO sessions (token, player_id) VALUES ($1,$2)', [token, playerId]);
  return token;
}

export async function playerForSession(db: Db, token: string | undefined): Promise<PlayerRow | null> {
  if (!token) return null;
  const r = await db.query(
    'SELECT p.player_id, p.name, p.guest, p.email, p.units FROM sessions s JOIN players p ON p.player_id = s.player_id WHERE s.token = $1 AND p.retired = false',
    [token]
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return { playerId: row.player_id, name: row.name, guest: row.guest, email: row.email, units: row.units };
}

export async function createGuest(db: Db, starterCarId: string): Promise<PlayerRow> {
  const playerId = `p_${shortId(10)}`;
  const name = `Guest ${shortId(4)}`;
  await db.query('INSERT INTO players (player_id, name, guest, units) VALUES ($1,$2,true,$3)', [playerId, name, 'kmh']);
  await db.query('INSERT INTO owned_cars (player_id, car_id, selected) VALUES ($1,$2,true)', [playerId, starterCarId]);
  await writeMovement(db, playerId, 'opening', OPENING_BALANCE, null, `mv_${playerId}_opening`);
  return { playerId, name, guest: true, email: null, units: 'kmh' };
}

export interface GarageCar {
  carId: string;
  name: string;
  class: string;
  pi: number;
  overClassLimit: boolean;
  stages: Stages;
  paid: Stages;
  stats: { accelMps2: number; brakeMps2: number; topMps: number; gripPct: number; laneChangeSteps: number };
}

export interface ReferenceResult {
  layoutId: string;
  oldLapMs: number;
  newLapMs: number;
  deltaMs: number;
  oldSectorsMs: [number, number, number];
  newSectorsMs: [number, number, number];
  sectorDeltasMs: [number, number, number];
  price: number;
}

export interface GarageBody {
  balance: number;
  selectedCarId: string;
  cars: GarageCar[];
  latestReference: ReferenceResult | null;
}

export async function garageBody(db: Db, playerId: string, selectedOverride?: string): Promise<GarageBody> {
  const balance = await balanceOf(db, playerId);
  const carsR = await db.query('SELECT car_id FROM owned_cars WHERE player_id = $1', [playerId]);
  const stagesR = await db.query('SELECT car_id, system, stage, paid FROM car_stages WHERE player_id = $1', [playerId]);
  const refR = await db.query(
    'SELECT reference FROM purchases WHERE player_id = $1 ORDER BY created_at DESC, purchase_id DESC LIMIT 1',
    [playerId]
  );
  const cars: GarageCar[] = [];
  let selectedCarId = selectedOverride ?? '';
  for (const row of carsR.rows as { car_id: string }[]) {
    const spec = carById(row.car_id);
    if (!spec) continue;
    const stages = zeroStages();
    const paid = zeroStages();
    for (const sr of stagesR.rows as { car_id: string; system: string; stage: number; paid: number }[]) {
      if (sr.car_id === row.car_id && (SYSTEM_IDS as string[]).includes(sr.system)) {
        stages[sr.system as SystemId] = sr.stage;
        paid[sr.system as SystemId] = sr.paid;
      }
    }
    const { stats, pi } = setupFor(spec, stages);
    cars.push({
      carId: spec.carId, name: spec.name, class: spec.class, pi,
      overClassLimit: pi > CLASS_TOP[spec.class], stages, paid, stats
    });
  }
  if (!selectedCarId) {
    const selR = await db.query('SELECT car_id FROM owned_cars WHERE player_id = $1 AND selected = true', [playerId]);
    selectedCarId = selR.rows[0]?.car_id ?? cars[0]?.carId ?? '';
  }
  const latestReference = refR.rows.length > 0 ? refR.rows[0].reference as ReferenceResult : null;
  return { balance, selectedCarId, cars, latestReference };
}

/** The reference driver's one-lap time on a layout, from a standing start. */
export function referenceLapMs(layoutId: LayoutId, stats: {
  accelMps2: number; brakeMps2: number; topMps: number; gripPct: number; laneChangeSteps: number;
}): { lapMs: number; sectorsMs: [number, number, number] } {
  const layout = LAYOUTS[layoutId];
  const events = referenceInputs(layout, stats, 1, 7200);
  const inputAt = inputAtStepOf(events);
  const out = runRace(layout, stats, 1, 7200, false, false, inputAt);
  const lap = out.lapResults[0];
  return { lapMs: lap?.lapMs ?? 0, sectorsMs: lap?.sectorsMs ?? [0, 0, 0] };
}

function inputAtStepOf(events: { step: number; throttle: 0 | 1; brake: 0 | 1; drift: 0 | 1; lane: 'left' | 'middle' | 'right' }[]): (step: number) => Pedals {
  return (step: number): Pedals => {
    let last = events[0];
    for (const e of events) {
      if (e.step <= step) last = e;
      else break;
    }
    return { throttle: last.throttle, brake: last.brake, drift: last.drift, lane: last.lane };
  };
}

export interface PurchaseResult {
  purchaseId: string;
  carId: string;
  system: SystemId;
  stage: number;
  price: number;
  balance: number;
  pi: number;
  overClassLimit: boolean;
  reference: ReferenceResult;
}

export interface RefitResult {
  carId: string;
  system: SystemId;
  refund: number;
  balance: number;
  pi: number;
}

export interface CarPurchaseResult {
  carId: string;
  balance: number;
}

export async function buyCar(db: Db, playerId: string, carId: string): Promise<CarPurchaseResult> {
  const spec = carById(carId);
  if (!spec) throw notFound('No car with that id.');
  const ownedR = await db.query('SELECT 1 FROM owned_cars WHERE player_id = $1 AND car_id = $2', [playerId, carId]);
  if (ownedR.rows.length > 0) throw new ApiError(409, 'ALREADY_OWNED', 'You already own that car.');
  if (spec.starter) throw new ApiError(409, 'NOT_FOR_SALE', 'Starter cars are not for sale.');
  if (spec.price === null) throw notFound('No car with that id.');
  const balance = await balanceOf(db, playerId);
  if (balance < spec.price) throw insufficientCoins(spec.price - balance);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO owned_cars (player_id, car_id) VALUES ($1,$2)', [playerId, carId]);
    await writeMovement(db, playerId, 'car', -spec.price, null);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { carId, balance: balance - spec.price };
}

export async function selectCar(db: Db, playerId: string, carId: string): Promise<void> {
  const ownedR = await db.query('SELECT 1 FROM owned_cars WHERE player_id = $1 AND car_id = $2', [playerId, carId]);
  if (ownedR.rows.length === 0) throw notFound('Car not owned.');
  await db.query('UPDATE owned_cars SET selected = (car_id = $2) WHERE player_id = $1', [playerId, carId]);
}

/** Refunds half of what the car paid for that system's fitted stages, rounded down. */
export async function refitSystem(db: Db, playerId: string, carId: string, system: SystemId): Promise<RefitResult> {
  const ownedR = await db.query('SELECT 1 FROM owned_cars WHERE player_id = $1 AND car_id = $2', [playerId, carId]);
  if (ownedR.rows.length === 0) throw notFound('Car not owned.');
  const stageR = await db.query('SELECT stage, paid FROM car_stages WHERE player_id = $1 AND car_id = $2 AND system = $3', [playerId, carId, system]);
  const stage = stageR.rows[0]?.stage ?? 0;
  if (stage === 0) throw new ApiError(409, 'ALREADY_STOCK', 'That system is already at stage 0.');
  const paid = stageR.rows[0]?.paid ?? 0;
  const refund = Math.floor(paid / 2);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE car_stages SET stage = 0, paid = 0 WHERE player_id = $1 AND car_id = $2 AND system = $3', [playerId, carId, system]);
    await writeMovement(db, playerId, 'refit', refund, null);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const spec = carById(carId);
  const stages = await stagesOf(db, playerId, carId);
  const { pi } = spec ? setupFor(spec, stages) : { pi: 0 };
  const balance = await balanceOf(db, playerId);
  return { carId, system, refund, balance, pi };
}

export async function stagesOf(db: Db, playerId: string, carId: string): Promise<Stages> {
  const r = await db.query('SELECT system, stage FROM car_stages WHERE player_id = $1 AND car_id = $2', [playerId, carId]);
  const stages = zeroStages();
  for (const row of r.rows as { system: string; stage: number }[]) {
    if ((SYSTEM_IDS as string[]).includes(row.system)) stages[row.system as SystemId] = row.stage;
  }
  return stages;
}

/** Buys one upgrade stage. The stage check, debit, stage change and reference result commit together. */
export async function buyUpgrade(db: Db, playerId: string, carId: string, system: SystemId, requestedStage: number,
                                 layoutId: LayoutId): Promise<PurchaseResult> {
  const spec = carById(carId);
  if (!spec) throw notFound('Car not owned.');
  const ownedR = await db.query('SELECT 1 FROM owned_cars WHERE player_id = $1 AND car_id = $2', [playerId, carId]);
  if (ownedR.rows.length === 0) throw notFound('Car not owned.');
  const stages = await stagesOf(db, playerId, carId);
  const currentStage = stages[system];
  if (requestedStage !== currentStage + 1 || requestedStage > 3) {
    throw new ApiError(409, 'STAGE_OUT_OF_ORDER', 'Stages are bought one at a time, in order.');
  }
  const price = upgradePrice(spec.class, requestedStage);
  const balance = await balanceOf(db, playerId);
  if (balance < price) throw insufficientCoins(price - balance);

  const oldSetup = setupFor(spec, stages);
  const newStages: Stages = { ...stages, [system]: requestedStage };
  const newSetup = setupFor(spec, newStages);
  const oldRef = referenceLapMs(layoutId, oldSetup.stats);
  const newRef = referenceLapMs(layoutId, newSetup.stats);

  const purchaseId = `pu_${shortId(12)}`;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // The debit, the stage change and the reference result commit together.
    await client.query(
      'INSERT INTO car_stages (player_id, car_id, system, stage, paid) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (player_id, car_id, system) DO UPDATE SET stage = $4, paid = car_stages.paid + $5',
      [playerId, carId, system, requestedStage, price]
    );
    await writeMovement(db, playerId, 'upgrade', -price, null);
    const reference: ReferenceResult = {
      layoutId, oldLapMs: oldRef.lapMs, newLapMs: newRef.lapMs,
      deltaMs: newRef.lapMs - oldRef.lapMs,
      oldSectorsMs: oldRef.sectorsMs, newSectorsMs: newRef.sectorsMs,
      sectorDeltasMs: [newRef.sectorsMs[0] - oldRef.sectorsMs[0], newRef.sectorsMs[1] - oldRef.sectorsMs[1], newRef.sectorsMs[2] - oldRef.sectorsMs[2]],
      price
    };
    await client.query(
      'INSERT INTO purchases (purchase_id, player_id, car_id, system, stage, price, reference) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [purchaseId, playerId, carId, system, requestedStage, price, JSON.stringify(reference)]
    );
    await client.query('COMMIT');
    return {
      purchaseId, carId, system, stage: requestedStage, price,
      balance: balance - price, pi: newSetup.pi,
      overClassLimit: newSetup.pi > CLASS_TOP[spec.class], reference
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

