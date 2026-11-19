import { createHash, randomUUID } from "node:crypto";
import {
  CARS, LAYOUTS, MAX_STAGE, SYSTEMS, carModel, overClassLimit, referenceLap, stagePrice, tunedPi, tunedStats,
  type LayoutId, type Stages, type System,
} from "../shared/model.js";
import { refitRefund } from "../shared/rules.js";
import { layoutOpen, loadStanding } from "./championship.js";
import type { Database, Transaction } from "./db.js";
import { ApiError, errorBody, errors, isRecord } from "./http.js";
import { addMovement, balanceOf } from "./ledger.js";
import type { Services } from "./main.js";

export interface StoredResponse {
  readonly status: number;
  readonly body: string;
}

interface OwnedRow {
  [key: string]: unknown;
  car_id: string;
  engine: number;
  tires: number;
  brakes: number;
  suspension: number;
  paid_engine: number;
  paid_tires: number;
  paid_brakes: number;
  paid_suspension: number;
  latest_reference: unknown;
}

const stagesOf = (row: OwnedRow): Stages => ({ engine: row.engine, tires: row.tires, brakes: row.brakes, suspension: row.suspension });
const paidOf = (row: OwnedRow): Stages => ({
  engine: row.paid_engine, tires: row.paid_tires, brakes: row.paid_brakes, suspension: row.paid_suspension,
});

function carBody(row: OwnedRow) {
  const model = carModel(row.car_id)!;
  const stages = stagesOf(row);
  const pi = tunedPi(model.pi, stages);
  return {
    carId: model.carId, name: model.name, class: model.class, pi, overClassLimit: overClassLimit(model.class, pi),
    stages, paid: paidOf(row), stats: tunedStats(model.stats, stages), latestReference: row.latest_reference ?? null,
  };
}

export async function garage(db: Database | Transaction, playerId: string) {
  const [player] = await db.query<{ selected_car_id: string }>("SELECT selected_car_id FROM players WHERE id = $1", [playerId]);
  const rows = await db.query<OwnedRow>("SELECT * FROM owned_cars WHERE player_id = $1 ORDER BY acquired_at", [playerId]);
  return { balance: await balanceOf(db, playerId), selectedCarId: player.selected_car_id, cars: rows.map(carBody) };
}

export async function selectCar(services: Services, playerId: string, body: unknown) {
  const carId = isRecord(body) ? body.selectedCarId : undefined;
  if (typeof carId === "string") {
    const [owned] = await services.db.query("SELECT 1 FROM owned_cars WHERE player_id = $1 AND car_id = $2", [playerId, carId]);
    if (!owned) throw errors.notFound();
  } else {
    throw errors.invalid({ selectedCarId: "Choose one of your cars." });
  }
  await services.db.query("UPDATE players SET selected_car_id = $2 WHERE id = $1", [playerId, carId]);
  return garage(services.db, playerId);
}

export interface KeyedRequest {
  readonly playerId: string;
  readonly key: string | undefined;
  readonly path: string;
  readonly raw: Buffer;
  readonly body: unknown;
}

// Idempotency: the same key and byte-identical body replays the stored answer; a different body
// is refused; a new key runs the purchase and stores whatever it answers.
async function keyed(tx: Transaction, request: KeyedRequest, run: () => Promise<unknown>): Promise<StoredResponse> {
  if (!request.key) throw errors.keyRequired();
  const fingerprint = createHash("sha256").update(`${request.path}\n`).update(request.raw).digest("hex");
  const [stored] = await tx.query<{ fingerprint: string; status: number; body: string }>(
    "SELECT fingerprint, status, body FROM idempotency WHERE player_id = $1 AND key = $2", [request.playerId, request.key]);
  if (stored) {
    if (stored.fingerprint !== fingerprint) throw errors.keyReused();
    return { status: stored.status, body: stored.body };
  }
  let response: StoredResponse;
  try {
    response = { status: 201, body: JSON.stringify(await run()) };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    response = { status: error.status, body: errorBody(error) };
  }
  await tx.query("INSERT INTO idempotency (player_id, key, fingerprint, status, body) VALUES ($1,$2,$3,$4,$5)",
    [request.playerId, request.key, fingerprint, response.status, response.body]);
  return response;
}

async function ownedCar(tx: Transaction, playerId: string, carId: string): Promise<OwnedRow | undefined> {
  const [row] = await tx.query<OwnedRow>("SELECT * FROM owned_cars WHERE player_id = $1 AND car_id = $2", [playerId, carId]);
  return row;
}

const isSystem = (value: string): value is System => (SYSTEMS as readonly string[]).includes(value);

export async function purchaseUpgrade(services: Services, request: KeyedRequest, carId: string, system: string) {
  return services.db.withPlayer(request.playerId, async (tx) => {
    const row = await ownedCar(tx, request.playerId, carId);
    if (!row || !isSystem(system)) throw errors.notFound();
    return keyed(tx, request, async () => {
      const body = isRecord(request.body) ? request.body : {};
      const stage = body.stage;
      const layoutId = body.layoutId;
      const current = row[system];
      if (Number.isInteger(stage) && (stage !== current + 1 || (stage as number) > MAX_STAGE)) {
        throw errors.conflict("STAGE_OUT_OF_ORDER", "Stages are bought one at a time, in order.");
      }
      const validLayout = typeof layoutId === "string" && layoutId in LAYOUTS;
      if (validLayout && !layoutOpen(layoutId as LayoutId, await loadStanding(tx, request.playerId))) {
        throw errors.locked("LAYOUT_LOCKED", "Complete the Rookie league to unlock this map.");
      }
      const fields: Record<string, string> = {};
      if (!Number.isInteger(stage)) fields.stage = "Stage must be a whole number.";
      if (!validLayout) fields.layoutId = "Unknown layout.";
      if (Object.keys(fields).length) throw errors.invalid(fields);

      const model = carModel(carId)!;
      const price = stagePrice(model.class, stage as number);
      if ((await balanceOf(tx, request.playerId)) < price) throw errors.insufficient();
      const before = stagesOf(row);
      const after: Stages = { ...before, [system]: stage as number };
      const layout = LAYOUTS[layoutId as LayoutId];
      const oldLap = referenceLap(layout, tunedStats(model.stats, before));
      const newLap = referenceLap(layout, tunedStats(model.stats, after));
      const reference = {
        layoutId: layout.id, oldLapMs: oldLap.lapMs, newLapMs: newLap.lapMs, deltaMs: newLap.lapMs - oldLap.lapMs,
        oldSectorsMs: oldLap.sectorsMs, newSectorsMs: newLap.sectorsMs,
        sectorDeltasMs: newLap.sectorsMs.map((ms, i) => ms - oldLap.sectorsMs[i]), price,
      };
      const purchaseId = randomUUID();
      await tx.query("INSERT INTO purchases (id, player_id, car_id, system, stage, price, reference) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [purchaseId, request.playerId, carId, system, stage, price, JSON.stringify(reference)]);
      await tx.query(
        `UPDATE owned_cars SET ${system} = $3, paid_${system} = paid_${system} + $4, latest_reference = $5
          WHERE player_id = $1 AND car_id = $2`, [request.playerId, carId, stage, price, JSON.stringify(reference)]);
      const { balance } = await addMovement(tx, { playerId: request.playerId, kind: "upgrade", amount: -price, purchaseId });
      const pi = tunedPi(model.pi, after);
      return { purchaseId, carId, system, stage, price, balance, pi, overClassLimit: overClassLimit(model.class, pi), reference };
    });
  });
}

export async function purchaseCar(services: Services, request: KeyedRequest) {
  const carId = isRecord(request.body) ? request.body.carId : undefined;
  const model = typeof carId === "string" ? carModel(carId) : undefined;
  if (typeof carId === "string" && !model) throw errors.notFound();
  return services.db.withPlayer(request.playerId, (tx) => keyed(tx, request, async () => {
    // Without a car id no conflict can apply, so validation answers straight away.
    if (!model) throw errors.invalid({ carId: "Choose a car." });
    if (await ownedCar(tx, request.playerId, model.carId)) throw errors.conflict("ALREADY_OWNED", "You already own this car.");
    if (model.price === null) throw errors.conflict("NOT_FOR_SALE", "Starter cars cannot be bought.");
    if ((await balanceOf(tx, request.playerId)) < model.price) throw errors.insufficient();
    await tx.query("INSERT INTO owned_cars (player_id, car_id) VALUES ($1,$2)", [request.playerId, model.carId]);
    const { balance } = await addMovement(tx, { playerId: request.playerId, kind: "car", amount: -model.price });
    return { carId: model.carId, balance };
  }));
}

export async function refit(services: Services, request: KeyedRequest, carId: string, system: string) {
  return services.db.withPlayer(request.playerId, async (tx) => {
    const row = await ownedCar(tx, request.playerId, carId);
    if (!row || !isSystem(system)) throw errors.notFound();
    return keyed(tx, request, async () => {
      if (row[system] === 0) throw errors.conflict("ALREADY_STOCK", "This system is already stock.");
      const refund = refitRefund(row[`paid_${system}`] as number);
      await tx.query(`UPDATE owned_cars SET ${system} = 0, paid_${system} = 0 WHERE player_id = $1 AND car_id = $2`,
        [request.playerId, carId]);
      const { balance } = await addMovement(tx, { playerId: request.playerId, kind: "refit", amount: refund });
      const model = carModel(carId)!;
      return { carId, system, refund, balance, pi: tunedPi(model.pi, { ...stagesOf(row), [system]: 0 }) };
    });
  });
}

export function catalogue() {
  return {
    cars: CARS.map((car) => ({
      carId: car.carId, name: car.name, class: car.class, pi: car.pi, price: car.price, starter: car.price === null,
      stats: car.stats,
    })),
  };
}
