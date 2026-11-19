// Grading routes, present only when GRADING_ROUTES is on.
import type { Request, Response } from 'express';
import type { Db } from './db.js';
import type { Config } from './config.js';
import type { PushHub } from './push.js';
import type { ReplayStore } from './replayStore.js';
import type { PlayerLocks } from './locks.js';
import { validationFailed, notFound } from './errors.js';
import { shortId } from './ids.js';
import { writeMovement } from './ledger.js';
import { createRun, finishRun, getRun, ownsCar } from './runs.js';
import { OPENING_BALANCE, LAYOUTS, EVENTS, carById, type LayoutId, type ModeId } from '../shared/domain.js';
import { referenceInputs, type InputEvent } from '../shared/raceModel.js';

export async function gradingPlayer(db: Db, req: Request, res: Response): Promise<void> {
  const body = req.body as { coins?: unknown; cars?: unknown; name?: unknown } | undefined;
  const raw = req.body === undefined || Buffer.isBuffer(req.body)
    ? JSON.parse((req.body as Buffer | undefined)?.toString('utf-8') ?? '{}')
    : body;
  const coins = raw.coins === undefined ? 1000 : raw.coins;
  if (typeof coins !== 'number' || !Number.isInteger(coins) || coins < 0) {
    throw validationFailed({ coins: 'Coins must be a whole number.' });
  }
  let cars = raw.cars === undefined ? ['kestrel-hatch'] : raw.cars;
  if (!Array.isArray(cars) || cars.some((c: unknown) => typeof c !== 'string')) {
    throw validationFailed({ cars: 'Cars must be a list of car ids.' });
  }
  for (const carId of cars as string[]) {
    if (!carById(carId)) throw validationFailed({ cars: 'Unknown car id.' });
  }
  const name = raw.name === undefined ? null : raw.name;
  if (name !== null && typeof name !== 'string') throw validationFailed({ name: 'Name must be a string.' });

  const playerId = `p_${shortId(10)}`;
  const player = name ?? `Guest ${shortId(4)}`;
  await db.query('INSERT INTO players (player_id, name, guest, units) VALUES ($1,$2,false,$3)', [playerId, player, 'kmh']);
  for (const carId of cars as string[]) {
    await db.query('INSERT INTO owned_cars (player_id, car_id, selected) VALUES ($1,$2,$3)',
      [playerId, carId, carId === (cars as string[])[0]]);
  }
  await writeMovement(db, playerId, 'opening', coins === 0 ? OPENING_BALANCE : coins, null, `mv_${playerId}_opening`);
  const token = `sess_${shortId(20)}`;
  await db.query('INSERT INTO sessions (token, player_id) VALUES ($1,$2)', [token, playerId]);
  res.setHeader('Set-Cookie', `kerb_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
  res.status(201).json({ playerId });
  void OPENING_BALANCE;
}

export async function gradingRace(db: Db, cfg: Config, store: ReplayStore, locks: PlayerLocks,
                                  hub: PushHub, playerId: string, req: Request, res: Response): Promise<void> {
  const raw = req.body === undefined || Buffer.isBuffer(req.body)
    ? JSON.parse((req.body as Buffer | undefined)?.toString('utf-8') ?? '{}')
    : req.body as Record<string, unknown>;
  let layoutId = typeof raw.layoutId === 'string' ? raw.layoutId : undefined;
  let mode = typeof raw.mode === 'string' ? raw.mode : undefined;
  const eventId = typeof raw.eventId === 'string' ? raw.eventId : undefined;
  const carId = typeof raw.carId === 'string' ? raw.carId : undefined;
  const laps = typeof raw.laps === 'number' ? raw.laps : undefined;
  const loaner = raw.loaner === true;
  const driver = raw.driver;
  if (driver !== 'reference' && driver !== 'coast' && driver !== 'inputs') {
    throw validationFailed({ driver: 'Pick reference, coast or inputs.' });
  }
  if (driver === 'inputs' && !Array.isArray(raw.inputs)) {
    throw validationFailed({ inputs: 'Send the input list.' });
  }
  if (eventId) {
    const ev = EVENTS[eventId];
    if (!ev) throw notFound('Unknown event.');
    layoutId = ev.layoutId;
    mode = ev.mode;
  }
  if (!layoutId || !(layoutId in LAYOUTS)) throw validationFailed({ layoutId: 'Pick a map.' });
  if (mode !== 'practice' && mode !== 'circuit' && mode !== 'drift' && mode !== 'time-trial') {
    throw validationFailed({ mode: 'Pick a mode.' });
  }

  const { run } = await createRun(db, playerId, {
    layoutId: layoutId as LayoutId, mode: mode as ModeId, carId, eventId, laps, loaner
  });
  void store; void cfg; void hub;

  // Build the replay file.
  let events: InputEvent[];
  if (driver === 'reference') {
    events = referenceInputs(LAYOUTS[run.layoutId as LayoutId], run.carStats, run.laps, run.stepLimit);
  } else if (driver === 'coast') {
    events = [{ step: 0, throttle: 1, brake: 0, drift: 0, lane: 'middle' }];
  } else {
    events = raw.inputs as InputEvent[];
  }
  const file = JSON.stringify({ seed: run.seed, inputs: events });
  await finishRun(db, cfg, store, locks, hub, run.runId, playerId, Buffer.from(file, 'utf-8'));
  res.status(202).json({ runId: run.runId });
}

void getRun;
void ownsCar;
