import {
  CARS,
  STARTER_CAR_IDS,
  SYSTEMS,
  type CarClass,
  type SystemName,
  isBoardMode,
  isLayoutId,
} from '../shared/catalogue.js';
import { runReferenceDriver } from '../shared/race-model.js';
import { serialiseReplayFile } from '../shared/replay-file.js';
import { config } from './config.js';
import { db, one, withPlayerLock } from './db.js';
import {
  ApiError,
  notFound,
  unauthenticated,
  unavailable,
  validationFailed,
} from './errors.js';
import {
  type RequestContext,
  type Route,
  MAX_FINISH_BODY_BYTES,
  parseJsonBody,
  sendJson,
  setSessionCookie,
} from './http.js';
import { idempotencyKey, withIdempotency } from './idempotency.js';
import { buyCar, buyUpgrade, garageBody, ownedCar, refitSystem } from './garage.js';
import { ledgerBody } from './ledger.js';
import { championshipBody } from './championship.js';
import { readBoard } from './boards.js';
import { createGuest, createPlayer, meBody, playerBySession } from './players.js';
import { createLobby, joinLobby, readLobby, setReady } from './lobbies.js';
import { createRun, loadRun, runBody, runConfig } from './runs.js';
import { replayKey, submitFinish } from './verify.js';
import { ReplayStorageUnavailable, getReplay, replayStorageAvailable } from './storage.js';
import { emailFieldError, redeemSigninLink, requestSigninLink, validEmail } from './auth.js';

async function requirePlayer(ctx: RequestContext): Promise<string> {
  if (ctx.playerId === null) throw unauthenticated();
  return ctx.playerId;
}

function system(ctx: RequestContext): SystemName {
  const value = ctx.params.system;
  if (!SYSTEMS.includes(value as SystemName)) throw notFound();
  return value as SystemName;
}

let storageProbe: { at: number; available: boolean } = { at: 0, available: true };

async function storageAvailable(): Promise<boolean> {
  const now = Date.now();
  if (now - storageProbe.at < 1000) return storageProbe.available;
  const available = await replayStorageAvailable();
  storageProbe = { at: now, available };
  return available;
}

export const routes: Route[] = [
  {
    method: 'GET',
    pattern: '/health',
    handler: (ctx) => sendJson(ctx.res, 200, { status: 'ok' }),
  },
  {
    method: 'GET',
    pattern: '/v1/status',
    handler: async (ctx) => {
      const available = await storageAvailable();
      sendJson(ctx.res, 200, { replayStorage: available ? 'ok' : 'unavailable' });
    },
  },
  {
    method: 'POST',
    pattern: '/v1/guests',
    handler: async (ctx) => {
      const body = parseJsonBody(ctx);
      if (body.ageConfirmed !== true) {
        throw validationFailed({ ageConfirmed: 'Confirm you are 13 or older to play.' });
      }
      const starterCarId = body.starterCarId;
      if (typeof starterCarId !== 'string' || !STARTER_CAR_IDS.includes(starterCarId as never)) {
        throw validationFailed({ starterCarId: 'Choose a starter car.' });
      }
      const created = await createGuest(starterCarId);
      setSessionCookie(ctx.res, created.sessionId);
      sendJson(ctx.res, 201, {
        playerId: created.playerId,
        name: created.name,
        balance: created.balance,
      });
    },
  },
  {
    method: 'GET',
    pattern: '/v1/me',
    handler: async (ctx) => {
      await requirePlayer(ctx);
      const player = await playerBySession(ctx.sessionId!);
      if (!player) throw unauthenticated();
      sendJson(ctx.res, 200, await meBody(db, player));
    },
  },
  {
    method: 'PATCH',
    pattern: '/v1/me',
    handler: async (ctx) => {
      await requirePlayer(ctx);
      const body = parseJsonBody(ctx);
      if (body.units !== 'kmh' && body.units !== 'mph') {
        throw validationFailed({ units: 'Choose km/h or mph.' });
      }
      await db.query('update players set units = $2 where player_id = $1', [
        ctx.playerId,
        body.units,
      ]);
      const player = await playerBySession(ctx.sessionId!);
      if (!player) throw unauthenticated();
      sendJson(ctx.res, 200, await meBody(db, player));
    },
  },
  {
    method: 'GET',
    pattern: '/v1/cars',
    handler: (ctx) => {
      sendJson(ctx.res, 200, {
        cars: CARS.map((car) => ({
          carId: car.carId,
          name: car.name,
          class: car.class,
          pi: car.pi,
          price: car.price,
          starter: car.starter,
          stats: car.stats,
        })),
      });
    },
  },
  {
    method: 'GET',
    pattern: '/v1/garage',
    handler: async (ctx) => {
      const playerId = await requirePlayer(ctx);
      sendJson(ctx.res, 200, await garageBody(db, playerId));
    },
  },
  {
    method: 'PATCH',
    pattern: '/v1/garage',
    handler: async (ctx) => {
      const playerId = await requirePlayer(ctx);
      const body = parseJsonBody(ctx);
      const carId = body.selectedCarId;
      if (typeof carId !== 'string' || !(await ownedCar(db, playerId, carId))) throw notFound();
      await db.query('update players set selected_car_id = $2 where player_id = $1', [
        playerId,
        carId,
      ]);
      sendJson(ctx.res, 200, await garageBody(db, playerId));
    },
  },
  {
    method: 'POST',
    pattern: '/v1/garage/cars',
    handler: async (ctx) => {
      const playerId = await requirePlayer(ctx);
      const body = parseJsonBody(ctx);
      if (typeof body.carId === 'string' && !CARS.some((car) => car.carId === body.carId)) {
        throw notFound();
      }
      const key = idempotencyKey(ctx.req);
      const answer = await withPlayerLock(playerId, (tx) =>
        withIdempotency(tx, playerId, key, ctx.rawBody, async () => ({
          status: 201,
          body: await buyCar(tx, playerId, body.carId),
        })),
      );
      sendJson(ctx.res, answer.status, answer.body);
    },
  },
  {
    method: 'POST',
    pattern: '/v1/garage/cars/:carId/upgrades/:system',
    handler: async (ctx) => {
      const playerId = await requirePlayer(ctx);
      const body = parseJsonBody(ctx);
      const systemName = system(ctx);
      const car = await ownedCar(db, playerId, ctx.params.carId!);
      if (!car) throw notFound();
      const key = idempotencyKey(ctx.req);
      const answer = await withPlayerLock(playerId, (tx) =>
        withIdempotency(tx, playerId, key, ctx.rawBody, async () => {
          const fresh = await ownedCar(tx, playerId, car.carId);
          if (!fresh) throw notFound();
          return { status: 201, body: await buyUpgrade(tx, playerId, fresh, systemName, body) };
        }),
      );
      sendJson(ctx.res, answer.status, answer.body);
    },
  },
  {
    method: 'POST',
    pattern: '/v1/garage/cars/:carId/refits/:system',
    handler: async (ctx) => {
      const playerId = await requirePlayer(ctx);
      const systemName = system(ctx);
      const car = await ownedCar(db, playerId, ctx.params.carId!);
      if (!car) throw notFound();
      const key = idempotencyKey(ctx.req);
      const answer = await withPlayerLock(playerId, (tx) =>
        withIdempotency(tx, playerId, key, ctx.rawBody, async () => {
          const fresh = await ownedCar(tx, playerId, car.carId);
          if (!fresh) throw notFound();
          return { status: 201, body: await refitSystem(tx, playerId, fresh, systemName) };
        }),
      );
      sendJson(ctx.res, answer.status, answer.body);
    },
  },
  {
    method: 'GET',
    pattern: '/v1/ledger',
    handler: async (ctx) => {
      const playerId = await requirePlayer(ctx);
      sendJson(ctx.res, 200, await ledgerBody(db, playerId));
    },
  },
  {
    method: 'GET',
    pattern: '/v1/championship',
    handler: async (ctx) => {
      const playerId = await requirePlayer(ctx);
      sendJson(ctx.res, 200, await championshipBody(db, playerId));
    },
  },
  {
    method: 'POST',
    pattern: '/v1/runs',
    handler: async (ctx) => {
      const playerId = await requirePlayer(ctx);
      const body = parseJsonBody(ctx);
      const created = await withPlayerLock(playerId, (tx) => createRun(tx, playerId, body));
      sendJson(ctx.res, 201, created);
    },
  },
  {
    method: 'POST',
    pattern: '/v1/runs/:runId/finish',
    maxBodyBytes: MAX_FINISH_BODY_BYTES,
    handler: async (ctx) => {
      const playerId = await requirePlayer(ctx);
      const run = await loadRun(db, ctx.params.runId!);
      if (!run || run.player_id !== playerId) throw notFound();
      if (run.status !== 'started') {
        const stored = await one<{ replay_bytes: Buffer | null }>(
          db,
          'select replay_bytes from runs where run_id = $1',
          [run.run_id],
        );
        if (stored?.replay_bytes && stored.replay_bytes.equals(ctx.rawBody)) {
          sendJson(ctx.res, 202, { runId: run.run_id, status: run.status });
          return;
        }
        throw new ApiError(409, 'ALREADY_SUBMITTED', 'This run was already submitted.');
      }
      const answer = await submitFinish(run, ctx.rawBody);
      sendJson(ctx.res, 202, answer);
    },
  },
  {
    method: 'GET',
    pattern: '/v1/runs/:runId',
    handler: async (ctx) => {
      const playerId = await requirePlayer(ctx);
      const body = await runBody(ctx.params.runId!);
      if (!body) throw notFound();
      if (body.playerId !== playerId && body.status !== 'verified') throw notFound();
      sendJson(ctx.res, 200, body);
    },
  },
  {
    method: 'GET',
    pattern: '/v1/runs/:runId/replay',
    handler: async (ctx) => {
      const playerId = await requirePlayer(ctx);
      const run = await loadRun(db, ctx.params.runId!);
      if (!run) throw notFound();
      if (run.player_id !== playerId && run.status !== 'verified') throw notFound();
      if (run.replay_sha256 === null) throw notFound();
      let bytes: Buffer | null;
      try {
        bytes = await getReplay(replayKey(run.run_id));
      } catch (error) {
        if (error instanceof ReplayStorageUnavailable) {
          throw unavailable('REPLAY_STORAGE_UNAVAILABLE', 'Replay storage is unavailable.');
        }
        throw error;
      }
      if (!bytes) throw notFound();
      ctx.res.writeHead(200, {
        'content-type': 'application/json',
        'content-length': bytes.byteLength,
        'x-replay-sha256': run.replay_sha256,
        'content-disposition': `attachment; filename="kerbline-${run.run_id}.json"`,
        'cache-control': 'no-store',
      });
      ctx.res.end(bytes);
    },
  },
  {
    method: 'GET',
    pattern: '/v1/boards',
    handler: async (ctx) => {
      const playerId = await requirePlayer(ctx);
      const layoutId = ctx.url.searchParams.get('layoutId');
      const mode = ctx.url.searchParams.get('mode');
      const className = ctx.url.searchParams.get('class');
      const fields: Record<string, string> = {};
      if (!isLayoutId(layoutId)) fields.layoutId = 'Choose a map.';
      if (mode === null || !isBoardMode(mode)) fields.mode = 'Choose a mode.';
      if (className !== 'D' && className !== 'C' && className !== 'B') {
        fields.class = 'Choose a class.';
      }
      if (Object.keys(fields).length > 0) throw validationFailed(fields);
      sendJson(
        ctx.res,
        200,
        await readBoard(db, layoutId!, mode as never, className as CarClass, playerId),
      );
    },
  },
  {
    method: 'POST',
    pattern: '/v1/lobbies',
    handler: async (ctx) => {
      const playerId = await requirePlayer(ctx);
      sendJson(ctx.res, 201, await createLobby(playerId, parseJsonBody(ctx)));
    },
  },
  {
    method: 'GET',
    pattern: '/v1/lobbies/:lobbyId',
    handler: async (ctx) => {
      await requirePlayer(ctx);
      sendJson(ctx.res, 200, await readLobby(ctx.params.lobbyId!));
    },
  },
  {
    method: 'POST',
    pattern: '/v1/lobbies/:lobbyId/join',
    handler: async (ctx) => {
      const playerId = await requirePlayer(ctx);
      const player = await playerBySession(ctx.sessionId!);
      if (!player) throw unauthenticated();
      sendJson(ctx.res, 200, await joinLobby(ctx.params.lobbyId!, playerId, player.name));
    },
  },
  {
    method: 'POST',
    pattern: '/v1/lobbies/:lobbyId/ready',
    handler: async (ctx) => {
      const playerId = await requirePlayer(ctx);
      const body = parseJsonBody(ctx);
      sendJson(ctx.res, 200, await setReady(ctx.params.lobbyId!, playerId, body.ready));
    },
  },
  {
    method: 'POST',
    pattern: '/v1/auth/links',
    handler: async (ctx) => {
      const body = parseJsonBody(ctx);
      if (!validEmail(body.email)) throw emailFieldError();
      await requestSigninLink(body.email);
      sendJson(ctx.res, 202, { status: 'sent' });
    },
  },
  {
    method: 'POST',
    pattern: '/v1/auth/redeem',
    handler: async (ctx) => {
      const body = parseJsonBody(ctx);
      const guest = ctx.sessionId === null ? null : await playerBySession(ctx.sessionId);
      const result = await redeemSigninLink(body.token, body.keep, guest);
      if (result.sessionId !== null) setSessionCookie(ctx.res, result.sessionId);
      sendJson(ctx.res, 200, {
        playerId: result.playerId,
        email: result.email,
        outcome: result.outcome,
      });
    },
  },
  {
    method: 'POST',
    pattern: '/v1/grading/players',
    handler: async (ctx) => {
      if (!config.gradingRoutes) throw notFound();
      const body = parseJsonBody(ctx);
      const coins = body.coins === undefined ? 1000 : body.coins;
      const cars = body.cars === undefined ? ['kestrel-hatch'] : body.cars;
      const name = body.name === undefined ? 'Grader' : body.name;
      if (typeof coins !== 'number' || !Number.isInteger(coins) || coins < 0) {
        throw validationFailed({ coins: 'Send a whole number of coins.' });
      }
      if (
        !Array.isArray(cars) ||
        cars.length === 0 ||
        cars.some((carId) => typeof carId !== 'string' || !CARS.some((car) => car.carId === carId))
      ) {
        throw validationFailed({ cars: 'Send a list of car ids.' });
      }
      if (typeof name !== 'string' || name.length === 0) {
        throw validationFailed({ name: 'Send a name.' });
      }
      const created = await createPlayer({
        guest: false,
        name,
        email: null,
        cars: cars as string[],
        balance: coins,
      });
      setSessionCookie(ctx.res, created.sessionId);
      sendJson(ctx.res, 201, { playerId: created.playerId });
    },
  },
  {
    method: 'POST',
    pattern: '/v1/grading/races',
    handler: async (ctx) => {
      if (!config.gradingRoutes) throw notFound();
      const playerId = await requirePlayer(ctx);
      const body = parseJsonBody(ctx);
      const driver = body.driver;
      if (driver !== 'reference' && driver !== 'coast' && driver !== 'inputs') {
        throw validationFailed({ driver: 'Choose reference, coast or inputs.' });
      }
      if (driver === 'inputs' && !Array.isArray(body.inputs)) {
        throw validationFailed({ inputs: 'Send an input list.' });
      }
      const created = await withPlayerLock(playerId, (tx) => createRun(tx, playerId, body));
      const run = await loadRun(db, created.runId);
      if (!run) throw notFound();

      let file: string;
      if (driver === 'reference') {
        const { inputs } = runReferenceDriver(runConfig(run));
        file = serialiseReplayFile(run.seed, inputs);
      } else if (driver === 'coast') {
        file = serialiseReplayFile(run.seed, [
          { step: 0, throttle: 1, brake: 0, drift: 0, lane: 'middle' },
        ]);
      } else {
        file = JSON.stringify({ seed: run.seed, inputs: body.inputs });
      }
      await submitFinish(run, Buffer.from(file, 'utf8'));
      sendJson(ctx.res, 202, { runId: created.runId });
    },
  },
];

export const CLIENT_ROUTES: RegExp[] = [
  /^\/$/,
  /^\/garage$/,
  /^\/garage\/dealer$/,
  /^\/garage\/coins$/,
  /^\/race$/,
  /^\/runs\/[^/]+$/,
  /^\/boards$/,
  /^\/championship$/,
  /^\/lobby\/new$/,
  /^\/lobby\/[^/]+$/,
  /^\/sign-in$/,
  /^\/sign-in\/[^/]+$/,
];
