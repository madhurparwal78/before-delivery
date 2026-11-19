import { randomUUID } from 'node:crypto';
import {
  type CarClass,
  type CarStats,
  type LayoutId,
  LAYOUTS,
  MAX_STAGE,
  type StageMap,
  type SystemName,
  carSpec,
  findCar,
  overClassLimit,
  piWithStages,
  stagePrice,
  statsWithStages,
} from '../shared/catalogue.js';
import { referenceLap } from '../shared/race-model.js';
import { refitRefund } from '../shared/payouts.js';
import type { Queryable } from './db.js';
import { one } from './db.js';
import { conflict, forbidden, insufficientCoins, notFound, validationFailed } from './errors.js';
import { balanceOf, writeMovement } from './ledger.js';
import { quarryUnlocked } from './championship.js';

export interface OwnedCar {
  carId: string;
  stages: StageMap;
  paid: StageMap;
}

export interface ReferenceBody {
  layoutId: string;
  oldLapMs: number;
  newLapMs: number;
  deltaMs: number;
  oldSectorsMs: number[];
  newSectorsMs: number[];
  sectorDeltasMs: number[];
  price: number;
}

export interface GarageCarBody {
  carId: string;
  name: string;
  class: CarClass;
  pi: number;
  overClassLimit: boolean;
  stages: StageMap;
  paid: StageMap;
  stats: CarStats;
  latestReference: ReferenceBody | null;
}

export interface GarageBody {
  balance: number;
  selectedCarId: string;
  cars: GarageCarBody[];
}

interface OwnedCarRow {
  car_id: string;
  stage_engine: number;
  stage_tires: number;
  stage_brakes: number;
  stage_suspension: number;
  paid_engine: number;
  paid_tires: number;
  paid_brakes: number;
  paid_suspension: number;
}

function toOwnedCar(row: OwnedCarRow): OwnedCar {
  return {
    carId: row.car_id,
    stages: {
      engine: row.stage_engine,
      tires: row.stage_tires,
      brakes: row.stage_brakes,
      suspension: row.stage_suspension,
    },
    paid: {
      engine: row.paid_engine,
      tires: row.paid_tires,
      brakes: row.paid_brakes,
      suspension: row.paid_suspension,
    },
  };
}

export async function ownedCars(tx: Queryable, playerId: string): Promise<OwnedCar[]> {
  const { rows } = await tx.query<OwnedCarRow>(
    'select * from owned_cars where player_id = $1 order by car_id',
    [playerId],
  );
  return rows.map(toOwnedCar);
}

export async function ownedCar(
  tx: Queryable,
  playerId: string,
  carId: string,
): Promise<OwnedCar | null> {
  const row = await one<OwnedCarRow>(
    tx,
    'select * from owned_cars where player_id = $1 and car_id = $2',
    [playerId, carId],
  );
  return row ? toOwnedCar(row) : null;
}

interface PurchaseRow {
  car_id: string;
  layout_id: string;
  old_lap_ms: number;
  new_lap_ms: number;
  delta_ms: number;
  old_sectors_ms: number[];
  new_sectors_ms: number[];
  sector_deltas_ms: number[];
  price: number;
}

function toReference(row: PurchaseRow): ReferenceBody {
  return {
    layoutId: row.layout_id,
    oldLapMs: row.old_lap_ms,
    newLapMs: row.new_lap_ms,
    deltaMs: row.delta_ms,
    oldSectorsMs: row.old_sectors_ms,
    newSectorsMs: row.new_sectors_ms,
    sectorDeltasMs: row.sector_deltas_ms,
    price: row.price,
  };
}

export async function garageBody(tx: Queryable, playerId: string): Promise<GarageBody> {
  const cars = await ownedCars(tx, playerId);
  const player = await one<{ selected_car_id: string }>(
    tx,
    'select selected_car_id from players where player_id = $1',
    [playerId],
  );
  const { rows: references } = await tx.query<PurchaseRow>(
    `select distinct on (car_id) car_id, layout_id, old_lap_ms, new_lap_ms, delta_ms,
            old_sectors_ms, new_sectors_ms, sector_deltas_ms, price
     from purchases where player_id = $1 order by car_id, seq desc`,
    [playerId],
  );
  const latest = new Map(references.map((row) => [row.car_id, toReference(row)]));
  return {
    balance: await balanceOf(tx, playerId),
    selectedCarId: player?.selected_car_id ?? cars[0]?.carId ?? 'kestrel-hatch',
    cars: cars.map((car) => {
      const spec = carSpec(car.carId);
      return {
        carId: car.carId,
        name: spec.name,
        class: spec.class,
        pi: piWithStages(car.carId, car.stages),
        overClassLimit: overClassLimit(car.carId, car.stages),
        stages: car.stages,
        paid: car.paid,
        stats: statsWithStages(car.carId, car.stages),
        latestReference: latest.get(car.carId) ?? null,
      };
    }),
  };
}

const STAGE_COLUMNS: Record<SystemName, { stage: string; paid: string }> = {
  engine: { stage: 'stage_engine', paid: 'paid_engine' },
  tires: { stage: 'stage_tires', paid: 'paid_tires' },
  brakes: { stage: 'stage_brakes', paid: 'paid_brakes' },
  suspension: { stage: 'stage_suspension', paid: 'paid_suspension' },
};

export interface UpgradeResponse {
  purchaseId: string;
  carId: string;
  system: SystemName;
  stage: number;
  price: number;
  balance: number;
  pi: number;
  overClassLimit: boolean;
  reference: ReferenceBody;
}

/** Debits the price, sets the stage and stores the reference lap result in one commit. */
export async function buyUpgrade(
  tx: Queryable,
  playerId: string,
  car: OwnedCar,
  system: SystemName,
  body: Record<string, unknown>,
): Promise<UpgradeResponse> {
  const { stage, layoutId } = body;
  if (layoutId === 'quarry-switchbacks' && !(await quarryUnlocked(tx, playerId))) {
    throw forbidden('LAYOUT_LOCKED', 'Quarry Switchbacks is locked.');
  }
  const current = car.stages[system];
  if (typeof stage === 'number' && Number.isInteger(stage)) {
    if (stage !== current + 1 || stage > MAX_STAGE) {
      throw conflict('STAGE_OUT_OF_ORDER', 'Stages are bought one at a time, in order.');
    }
  } else {
    throw validationFailed({ stage: 'Send the next stage as a whole number.' });
  }
  if (layoutId !== 'saltflat-ring' && layoutId !== 'quarry-switchbacks') {
    throw validationFailed({ layoutId: 'Choose a map you have unlocked.' });
  }

  const spec = carSpec(car.carId);
  const price = stagePrice(spec.class, stage);
  const balance = await balanceOf(tx, playerId);
  if (balance < price) throw insufficientCoins();

  const newStages: StageMap = { ...car.stages, [system]: stage };
  const layout = LAYOUTS[layoutId as LayoutId];
  const before = referenceLap(layout, statsWithStages(car.carId, car.stages));
  const after = referenceLap(layout, statsWithStages(car.carId, newStages));
  const sectorDeltas = after.sectorsMs.map((value, index) => value - before.sectorsMs[index]!);

  const columns = STAGE_COLUMNS[system];
  await tx.query(
    `update owned_cars set ${columns.stage} = $3, ${columns.paid} = ${columns.paid} + $4
     where player_id = $1 and car_id = $2`,
    [playerId, car.carId, stage, price],
  );
  const purchaseId = randomUUID();
  await tx.query(
    `insert into purchases (purchase_id, player_id, car_id, system, stage, price, layout_id,
       old_lap_ms, new_lap_ms, delta_ms, old_sectors_ms, new_sectors_ms, sector_deltas_ms)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      purchaseId,
      playerId,
      car.carId,
      system,
      stage,
      price,
      layoutId,
      before.lapMs,
      after.lapMs,
      after.lapMs - before.lapMs,
      before.sectorsMs,
      after.sectorsMs,
      sectorDeltas,
    ],
  );
  const movement = await writeMovement(tx, {
    playerId,
    kind: 'upgrade',
    amount: -price,
    purchaseId,
  });

  return {
    purchaseId,
    carId: car.carId,
    system,
    stage,
    price,
    balance: movement.balance,
    pi: piWithStages(car.carId, newStages),
    overClassLimit: overClassLimit(car.carId, newStages),
    reference: {
      layoutId,
      oldLapMs: before.lapMs,
      newLapMs: after.lapMs,
      deltaMs: after.lapMs - before.lapMs,
      oldSectorsMs: before.sectorsMs,
      newSectorsMs: after.sectorsMs,
      sectorDeltasMs: sectorDeltas,
      price,
    },
  };
}

export interface RefitResponse {
  carId: string;
  system: SystemName;
  refund: number;
  balance: number;
  pi: number;
}

export async function refitSystem(
  tx: Queryable,
  playerId: string,
  car: OwnedCar,
  system: SystemName,
): Promise<RefitResponse> {
  if (car.stages[system] === 0) throw conflict('ALREADY_STOCK', 'That system is already stock.');
  const refund = refitRefund(car.paid[system]);
  const columns = STAGE_COLUMNS[system];
  await tx.query(
    `update owned_cars set ${columns.stage} = 0, ${columns.paid} = 0
     where player_id = $1 and car_id = $2`,
    [playerId, car.carId],
  );
  const movement = await writeMovement(tx, { playerId, kind: 'refit', amount: refund });
  const newStages: StageMap = { ...car.stages, [system]: 0 };
  return {
    carId: car.carId,
    system,
    refund,
    balance: movement.balance,
    pi: piWithStages(car.carId, newStages),
  };
}

export async function buyCar(
  tx: Queryable,
  playerId: string,
  carId: unknown,
): Promise<{ carId: string; balance: number }> {
  if (typeof carId !== 'string') {
    throw validationFailed({ carId: 'Choose a car to buy.' });
  }
  const spec = findCar(carId);
  if (!spec) throw notFound();
  const owned = await ownedCar(tx, playerId, carId);
  if (owned) throw conflict('ALREADY_OWNED', 'You already own that car.');
  const price = spec.price;
  if (price === null) {
    throw conflict('NOT_FOR_SALE', 'Starter cars are chosen at the start, not bought.');
  }
  const balance = await balanceOf(tx, playerId);
  if (balance < price) throw insufficientCoins();
  await tx.query('insert into owned_cars (player_id, car_id) values ($1, $2)', [playerId, carId]);
  const movement = await writeMovement(tx, { playerId, kind: 'car', amount: -price });
  return { carId, balance: movement.balance };
}
