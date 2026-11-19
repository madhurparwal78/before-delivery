// The HTTP app: every API route, the origin/size/media guards, and static serving.
import express, { type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import type { Db } from './db.js';
import type { Config } from './config.js';
import type { PushHub } from './push.js';
import type { ReplayStore } from './replayStore.js';
import { PlayerLocks } from './locks.js';
import { ApiError, sendError, notFound, unauthenticated, forbiddenOrigin, unsupportedMediaType,
  payloadTooLarge, idempotencyKeyRequired, idempotencyKeyReused, validationFailed, replayStorageUnavailable } from './errors.js';
import { playerForSession, createGuest, garageBody, buyCar, selectCar, refitSystem, buyUpgrade,
  type PlayerRow, type ReferenceResult } from './game.js';
import { balanceOf, movementsOf, writeMovement } from './ledger.js';
import { CARS, EVENTS, LEAGUES, LAYOUTS, carById, SYSTEM_IDS, upgradePrice, type SystemId,
  type LayoutId, type ModeId, type ClassLetter } from '../shared/domain.js';
import { createRun, finishRun, getRun, championshipBody, ApiErrorLite, playerFlags, ownsEligibleCar } from './runs.js';
import { createLobby, lobbyBody, joinLobby, setReady, LobbyError, handleDisconnect, setKeyState } from './lobby.js';
import { requestLink, redeemLink, validateEmail } from './signin.js';
import { gradingPlayer, gradingRace } from './grading.js';
import { sha256Hex, shortId } from './ids.js';
import { referenceLapMs } from './game.js';
import { cookieParser } from './cookies.js';
import { runRace, referenceInputs } from '../shared/raceModel.js';
import { LAYOUT_IDS } from '../shared/domain.js';

export interface AppCtx {
  db: Db;
  cfg: Config;
  hub: PushHub;
  store: ReplayStore;
  locks: PlayerLocks;
}

const JSON_LIMIT = 65536;
const FINISH_LIMIT = 1000000;

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const wrap = (h: AsyncHandler): RequestHandler => (req, res, next) => {
  h(req, res).catch(next);
};

/** Express 5 types may give string[] for params; routes here always take one. */
const param = (req: Request, name: string): string => {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : v;
};

export function buildApp(ctx: AppCtx): express.Express {
  const { db, cfg, hub, store, locks } = ctx;
  const app = express();

  // Cookie parsing for the session, before everything else.
  app.use(cookieParser);

  // Guards: origin, size, media type — checked before any route.
  app.use((req, res, next) => {
    // Size limits: 65,536 bytes generally, 1,000,000 for the finish request.
    const len = Number(req.headers['content-length'] ?? '0');
    if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') {
      const isFinish = req.path.startsWith('/v1/runs/') && req.path.endsWith('/finish');
      const limit = isFinish ? FINISH_LIMIT : JSON_LIMIT;
      if (len > limit) {
        sendError(res, payloadTooLarge());
        return;
      }
    }
    const origin = req.headers.origin;
    if (origin && (req.method as string) !== 'GET' && (req.method as string) !== 'HEAD') {
      try {
        const originUrl = new URL(origin);
        const allowedHosts = new Set([`localhost:${cfg.port}`, `127.0.0.1:${cfg.port}`, req.headers.host ?? '']);
        if (!allowedHosts.has(originUrl.host)) {
          sendError(res, forbiddenOrigin());
          return;
        }
      } catch {
        sendError(res, forbiddenOrigin());
        return;
      }
    }
    // Media type: POST and PATCH bodies must be JSON. The finish request's
    // body is never refused for its content.
    if ((req.method === 'POST' || req.method === 'PATCH') &&
        !(req.path.startsWith('/v1/runs/') && req.path.endsWith('/finish'))) {
      const ct = (req.headers['content-type'] ?? '').split(';')[0].trim();
      if (ct !== 'application/json') {
        sendError(res, unsupportedMediaType());
        return;
      }
    }
    next();
  });

  // Raw body capture with the size limits. JSON bodies parse to objects;
  // the finish route keeps its Buffer for byte-identical retries.
  app.use(express.raw({ type: () => true, limit: FINISH_LIMIT + 1, inflate: true }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && Buffer.isBuffer(req.body)) {
      const ct = (req.headers['content-type'] ?? '').split(';')[0].trim();
      const isFinish = req.path.startsWith('/v1/runs/') && req.path.endsWith('/finish');
      if (ct === 'application/json' && !isFinish && req.body.length <= JSON_LIMIT) {
        try {
          req.body = JSON.parse(req.body.toString('utf-8'));
        } catch {
          req.body = undefined;
          res.status(422).json({ error: { code: 'VALIDATION_FAILED', message: 'Some fields need attention.' } });
          return;
        }
      }
    }
    next();
  });

  const parseJson = (req: Request): unknown => {
    if (req.body === undefined || req.body === null) return {};
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf-8'));
    return req.body;
  };

  // --- health and status ---
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/v1/status', wrap(async (_req, res) => {
    const ok = await store.isAvailable();
    res.json({ replayStorage: ok ? 'ok' : 'unavailable' });
  }));

  // --- session helpers ---
  const sessionCookie = (res: Response, token: string): void => {
    res.setHeader('Set-Cookie', `kerb_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
  };
  const currentPlayer = async (req: Request): Promise<PlayerRow> => {
    const player = await playerForSession(db, req.cookies?.kerb_session);
    if (!player) throw unauthenticated();
    return player;
  };
  const optionalPlayer = async (req: Request): Promise<PlayerRow | null> =>
    playerForSession(db, req.cookies?.kerb_session);

  // --- guests ---
  app.post('/v1/guests', wrap(async (req, res) => {
    const body = parseJson(req) as { ageConfirmed?: unknown; starterCarId?: unknown };
    if (body.ageConfirmed !== true) throw validationFailed({ ageConfirmed: 'Confirm you are 13 or older to play.' });
    const starterId = body.starterCarId;
    const starter = typeof starterId === 'string' ? carById(starterId) : undefined;
    if (!starter || !starter.starter) throw validationFailed({ starterCarId: 'Pick a starter car.' });
    const player = await createGuest(db, starter.carId);
    const session = await (await import('./game.js')).createSession(db, player.playerId);
    sessionCookie(res, session);
    res.status(201).json({ playerId: player.playerId, name: player.name, balance: 1000 });
  }));

  // --- me ---
  app.get('/v1/me', wrap(async (req, res) => {
    const player = await currentPlayer(req);
    res.json({ playerId: player.playerId, name: player.name, guest: player.guest, email: player.email, units: player.units });
  }));

  app.patch('/v1/me', wrap(async (req, res) => {
    const player = await currentPlayer(req);
    const body = parseJson(req) as { units?: unknown };
    if (body.units !== 'kmh' && body.units !== 'mph') throw validationFailed({ units: 'Pick km/h or mph.' });
    await db.query('UPDATE players SET units = $2 WHERE player_id = $1', [player.playerId, body.units]);
    res.json({ playerId: player.playerId, name: player.name, guest: player.guest, email: player.email, units: body.units });
  }));

  // --- cars ---
  app.get('/v1/cars', (_req, res) => {
    res.json({ cars: CARS.map(c => ({ carId: c.carId, name: c.name, class: c.class, pi: c.pi, price: c.price, starter: c.starter, stats: c.stats })) });
  });

  // --- garage ---
  app.get('/v1/garage', wrap(async (req, res) => {
    const player = await currentPlayer(req);
    const body = await garageBody(db, player.playerId);
    res.json(body);
  }));

  app.patch('/v1/garage', wrap(async (req, res) => {
    const player = await currentPlayer(req);
    const body = parseJson(req) as { selectedCarId?: unknown };
    if (typeof body.selectedCarId !== 'string') throw validationFailed({ selectedCarId: 'Pick a car.' });
    await selectCar(db, player.playerId, body.selectedCarId);
    res.json(await garageBody(db, player.playerId, body.selectedCarId));
  }));

  // Idempotency helper: runs the task with the key, replaying stored responses.
  const withIdempotency = async (req: Request, res: Response, player: PlayerRow, task: () => Promise<{ status: number; body: unknown }>): Promise<void> => {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length === 0) throw idempotencyKeyRequired();
    // The body sha covers the exact bytes the client sent.
    const bodyBytes = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}), 'utf-8');
    const bodySha = sha256Hex(bodyBytes);
    const existing = await db.query('SELECT body_sha, status, response FROM idempotency WHERE player_id = $1 AND key = $2', [player.playerId, key]);
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.body_sha !== bodySha) throw idempotencyKeyReused();
      res.status(row.status).json(row.response);
      return;
    }
    const result = await task();
    await db.query(
      'INSERT INTO idempotency (player_id, key, body_sha, status, response) VALUES ($1,$2,$3,$4,$5)',
      [player.playerId, key, bodySha, result.status, JSON.stringify(result.body)]
    );
    res.status(result.status).json(result.body);
  };

  app.post('/v1/garage/cars', wrap(async (req, res) => {
    const player = await currentPlayer(req);
    const body = parseJson(req) as { carId?: unknown };
    if (typeof body.carId !== 'string' || !body.carId) throw validationFailed({ carId: 'Pick a car.' });
    await withIdempotency(req, res, player, async () => {
      const out = await locks.run(player.playerId, () => buyCar(db, player.playerId, body.carId as string));
      const balance = await balanceOf(db, player.playerId);
      hub.sendToPlayer(player.playerId, { type: 'balance', balance, movementId: `car_${shortId(8)}`, purchaseId: null });
      return { status: 201, body: { carId: out.carId, balance: out.balance } };
    });
  }));

  app.post('/v1/garage/cars/:carId/upgrades/:system', wrap(async (req, res) => {
    const player = await currentPlayer(req);
    const carId = param(req, 'carId');
    const system = param(req, 'system') as SystemId;
    if (!(SYSTEM_IDS as string[]).includes(system)) throw notFound('Unknown system.');
    const body = parseJson(req) as { stage?: unknown; layoutId?: unknown };
    if (typeof body.stage !== 'number' || !Number.isInteger(body.stage)) throw validationFailed({ stage: 'Pick a stage.' });
    if (body.layoutId !== 'saltflat-ring' && body.layoutId !== 'quarry-switchbacks') {
      const flags = await playerFlags(db, player.playerId);
      if (body.layoutId !== 'saltflat-ring' && !flags.rookieComplete) throw new ApiErrorLite(403, 'LAYOUT_LOCKED', 'This map is locked.');
      throw validationFailed({ layoutId: 'Pick a map.' });
    }
    const layoutId = body.layoutId as LayoutId;
    if (layoutId === 'quarry-switchbacks') {
      const flags = await playerFlags(db, player.playerId);
      if (!flags.rookieComplete) throw new ApiErrorLite(403, 'LAYOUT_LOCKED', 'This map is locked.');
    }
    await withIdempotency(req, res, player, async () => {
      const out = await locks.run(player.playerId, () =>
        buyUpgrade(db, player.playerId, carId, system, body.stage as number, layoutId));
      const balance = await balanceOf(db, player.playerId);
      hub.sendToPlayer(player.playerId, { type: 'balance', balance, movementId: out.purchaseId, purchaseId: out.purchaseId });
      return {
        status: 201,
        body: {
          purchaseId: out.purchaseId, carId: out.carId, system: out.system, stage: out.stage,
          price: out.price, balance: out.balance, pi: out.pi, overClassLimit: out.overClassLimit,
          reference: out.reference
        }
      };
    });
  }));

  app.post('/v1/garage/cars/:carId/refits/:system', wrap(async (req, res) => {
    const player = await currentPlayer(req);
    const carId = param(req, 'carId');
    const system = param(req, 'system') as SystemId;
    if (!(SYSTEM_IDS as string[]).includes(system)) throw notFound('Unknown system.');
    await withIdempotency(req, res, player, async () => {
      const out = await locks.run(player.playerId, () => refitSystem(db, player.playerId, carId, system));
      const balance = await balanceOf(db, player.playerId);
      hub.sendToPlayer(player.playerId, { type: 'balance', balance, movementId: `refit_${shortId(8)}`, purchaseId: null });
      return { status: 201, body: { carId: out.carId, system: out.system, refund: out.refund, balance: out.balance, pi: out.pi } };
    });
  }));

  // --- ledger ---
  app.get('/v1/ledger', wrap(async (req, res) => {
    const player = await currentPlayer(req);
    const balance = await balanceOf(db, player.playerId);
    const movements = await movementsOf(db, player.playerId);
    res.json({ balance, total: balance, movements });
  }));

  // --- runs ---
  app.post('/v1/runs', wrap(async (req, res) => {
    const player = await currentPlayer(req);
    const body = parseJson(req) as { layoutId?: unknown; mode?: unknown; carId?: unknown; eventId?: unknown; laps?: unknown; loaner?: unknown };
    // When eventId is given, the event decides the layout and mode.
    const hasEvent = typeof body.eventId === 'string' && body.eventId !== '';
    if (!hasEvent && body.layoutId !== 'saltflat-ring' && body.layoutId !== 'quarry-switchbacks') throw validationFailed({ layoutId: 'Pick a map.' });
    if (!hasEvent && body.mode !== 'practice' && body.mode !== 'circuit' && body.mode !== 'drift' && body.mode !== 'time-trial') {
      throw validationFailed({ mode: 'Pick a mode.' });
    }
    if (body.laps !== undefined && (typeof body.laps !== 'number' || !Number.isInteger(body.laps))) {
      throw validationFailed({ laps: 'Pick a lap count.' });
    }
    const { run, ai } = await locks.run(player.playerId, () => createRun(db, player.playerId, {
      layoutId: body.layoutId as LayoutId,
      mode: body.mode as ModeId,
      carId: typeof body.carId === 'string' ? body.carId : undefined,
      eventId: typeof body.eventId === 'string' ? body.eventId : undefined,
      laps: typeof body.laps === 'number' ? body.laps : undefined,
      loaner: body.loaner === true
    }));
    const car = carById(run.carId);
    res.status(201).json({
      runId: run.runId, seed: run.seed, layoutId: run.layoutId, mode: run.mode,
      carId: run.carId, laps: run.laps, stepLimit: run.stepLimit, loaner: run.loaner,
      car: { stats: run.carStats, stages: run.carStages },
      ai: ai.map(a => ({ name: a.name, carId: a.carId, paceFactor: a.paceFactor }))
    });
    void car;
  }));

  app.post('/v1/runs/:runId/finish', wrap(async (req, res) => {
    const player = await currentPlayer(req);
    const runId = param(req, 'runId');
    const bytes = (req.body as Buffer) ?? Buffer.alloc(0);
    const run = await getRun(db, runId, player.playerId, true);
    if (!run) throw notFound('No such run.');
    if (run.status !== 'started') {
      // A retry: identical bytes answer the current status; different bytes are refused.
      const sha = sha256Hex(bytes);
      if (sha === run.replaySha) {
        res.status(202).json({ runId, status: run.status });
        return;
      }
      throw new ApiError(409, 'ALREADY_SUBMITTED', 'This run was already submitted.');
    }
    const outcome = await finishRun(db, cfg, store, locks, hub, runId, player.playerId, bytes);
    res.status(202).json(outcome);
  }));

  app.get('/v1/runs/:runId', wrap(async (req, res) => {
    const player = await optionalPlayer(req);
    const runId = param(req, 'runId');
    const r = await db.query(
      `SELECT run_id, player_id, status, reason, layout_id, mode, car_id, event_id, loaner, laps, step_limit, seed,
              lap_results, race_ms, best_lap_ms, drift_score, coins_collected, position, clean, payout, top_speed_mps, replay_sha
       FROM runs WHERE run_id = $1`, [runId]);
    if (r.rows.length === 0) throw notFound('No such run.');
    const row = r.rows[0];
    if (player === null || row.player_id !== player.playerId) {
      if (row.status !== 'verified') throw notFound('No such run.');
    }
    const name = (await db.query('SELECT name FROM players WHERE player_id = $1', [row.player_id])).rows[0]?.name ?? '';
    res.json({
      runId: row.run_id, playerId: row.player_id, name, status: row.status, reason: row.reason,
      layoutId: row.layout_id, mode: row.mode, carId: row.car_id, eventId: row.event_id, loaner: row.loaner,
      laps: row.laps, stepLimit: row.step_limit,
      car: { stats: JSON.parse(row.car_stats ?? '{}'), stages: JSON.parse(row.car_stages ?? '{}') },
      lapResults: row.lap_results ?? [], raceMs: row.race_ms, bestLapMs: row.best_lap_ms,
      driftScore: row.drift_score, coinsCollected: row.coins_collected, position: row.position,
      clean: row.clean, payout: row.payout, payouts: row.payouts ?? [], topSpeedMps: row.top_speed_mps,
      replaySha256: row.replay_sha
    });
  }));

  app.get('/v1/runs/:runId/replay', wrap(async (req, res) => {
    const player = await optionalPlayer(req);
    const runId = param(req, 'runId');
    const r = await db.query('SELECT player_id, status, replay_sha FROM runs WHERE run_id = $1', [runId]);
    if (r.rows.length === 0) throw notFound('No such run.');
    const row = r.rows[0];
    if ((player === null || row.player_id !== player.playerId) && row.status !== 'verified') {
      throw notFound('No such run.');
    }
    const available = await store.isAvailable();
    if (!available) throw replayStorageUnavailable();
    const bytes = await store.getReplay(runId);
    if (!bytes) throw notFound('No such run.');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Replay-SHA256', row.replay_sha ?? sha256Hex(bytes));
    res.setHeader('Content-Disposition', `attachment; filename="kerbline-${runId}.json"`);
    res.send(bytes);
  }));

  // --- boards ---
  app.get('/v1/boards', wrap(async (req, res) => {
    const player = await optionalPlayer(req);
    const layoutId = req.query.layoutId;
    const mode = req.query.mode;
    const cls = req.query.class;
    if (typeof layoutId !== 'string' || !(layoutId in LAYOUTS)) throw validationFailed({ layoutId: 'Pick a map.' });
    if (mode !== 'time-trial' && mode !== 'circuit' && mode !== 'drift') throw validationFailed({ mode: 'Pick a mode.' });
    if (cls !== 'D' && cls !== 'C' && cls !== 'B') throw validationFailed({ class: 'Pick a class.' });
    const order = mode === 'drift' ? 'DESC' : 'ASC';
    const r = await db.query(
      `SELECT b.player_id, b.run_id, b.value, b.top_speed_mps, b.replay_sha, b.verified_at, p.name, r.car_id
       FROM boards b JOIN players p ON p.player_id = b.player_id
       LEFT JOIN runs r ON r.run_id = b.run_id
       WHERE b.layout_id = $1 AND b.mode = $2 AND b.class = $3
       ORDER BY b.value ${order}, b.verified_at ASC LIMIT 50`,
      [layoutId, mode, cls]
    );
    const rows = r.rows.map((row: { player_id: string; run_id: string; value: string | number; top_speed_mps: number; replay_sha: string | null; verified_at: Date; name: string; car_id: string | null }, i: number) => ({
      rank: i + 1,
      playerId: row.player_id,
      name: row.name,
      runId: row.run_id,
      carId: row.car_id ?? 'kestrel-hatch',
      value: Number(row.value),
      unit: mode === 'drift' ? 'points' : 'ms',
      gapMs: mode === 'drift' ? null : Number(row.value) - Number(r.rows[0].value),
      topSpeedMps: row.top_speed_mps,
      replaySha256: row.replay_sha,
      mine: player !== null && row.player_id === player.playerId
    }));
    const mine = player !== null ? rows.find(row => row.mine) ?? null : null;
    res.json({ layoutId, mode, class: cls, rows, mine });
  }));

  // --- championship ---
  app.get('/v1/championship', wrap(async (req, res) => {
    const player = await currentPlayer(req);
    const flags = await playerFlags(db, player.playerId);
    const body = await championshipBody(db, player.playerId);
    // The eligible flag per event: does the player own an eligible car?
    const leagues = await Promise.all((body.leagues as { leagueId: string; status: string; points: number; events: { eventId: string; class: ClassLetter }[] }[]).map(async league => ({
      ...league,
      events: await Promise.all(league.events.map(async ev => ({
        ...ev,
        eligible: await ownsEligibleCar(db, player.playerId, ev.class)
      })))
    })));
    res.json({ leagues, trophy: body.trophy });
    void flags; void LEAGUES; void EVENTS;
  }));

  // --- lobbies ---
  app.post('/v1/lobbies', wrap(async (req, res) => {
    const player = await currentPlayer(req);
    const body = parseJson(req) as { aiCount?: unknown };
    if (body.aiCount !== 0 && body.aiCount !== 1 && body.aiCount !== 2) {
      throw validationFailed({ aiCount: 'Pick 0, 1 or 2 AI drivers.' });
    }
    const lobby = await createLobby(db, player.playerId, body.aiCount as number);
    res.status(201).json({ lobbyId: lobby.lobbyId, inviteUrl: `/lobby/${lobby.lobbyId}`, state: lobby.state });
  }));

  app.get('/v1/lobbies/:lobbyId', wrap(async (req, res) => {
    await currentPlayer(req);
    res.json(await lobbyBody(db, cfg, hub, param(req, 'lobbyId'), null));
  }));

  app.post('/v1/lobbies/:lobbyId/join', wrap(async (req, res) => {
    const player = await currentPlayer(req);
    try {
      await joinLobby(db, cfg, hub, param(req, 'lobbyId'), player.playerId);
    } catch (err) {
      if (err instanceof LobbyError) {
        res.status(409).json({ error: { code: err.code, message: err.message } });
        return;
      }
      throw err;
    }
    res.json(await lobbyBody(db, cfg, hub, param(req, 'lobbyId'), null));
  }));

  app.post('/v1/lobbies/:lobbyId/ready', wrap(async (req, res) => {
    const player = await currentPlayer(req);
    const body = parseJson(req) as { ready?: unknown };
    if (typeof body.ready !== 'boolean') throw validationFailed({ ready: 'Pick ready or not ready.' });
    try {
      await setReady(db, cfg, hub, param(req, 'lobbyId'), player.playerId, body.ready);
    } catch (err) {
      if (err instanceof LobbyError) {
        res.status(409).json({ error: { code: err.code, message: err.message } });
        return;
      }
      throw err;
    }
    res.json(await lobbyBody(db, cfg, hub, param(req, 'lobbyId'), null));
  }));

  // --- auth ---
  app.post('/v1/auth/links', wrap(async (req, res) => {
    const body = parseJson(req) as { email?: unknown };
    const email = validateEmail(body.email);
    await requestLink(cfg, db, email);
    res.status(202).json({ status: 'sent' });
  }));

  app.post('/v1/auth/redeem', wrap(async (req, res) => {
    const body = parseJson(req) as { token?: unknown; keep?: unknown };
    if (typeof body.token !== 'string' || !body.token) throw validationFailed({ token: 'Open the link from your email.' });
    if (body.keep !== undefined && body.keep !== 'device' && body.keep !== 'account') {
      throw validationFailed({ keep: 'Pick a garage.' });
    }
    const session = req.cookies?.kerb_session;
    const result = await redeemLink(db, body.token, body.keep as 'device' | 'account' | undefined, session);
    sessionCookie(res, result.session);
    res.json(result.outcome);
  }));

  // --- grading ---
  if (cfg.gradingRoutes) {
    app.post('/v1/grading/players', wrap(async (req, res) => {
      await gradingPlayer(db, req, res);
    }));
    app.post('/v1/grading/races', wrap(async (req, res) => {
      const player = await currentPlayer(req);
      await gradingRace(db, cfg, store, locks, hub, player.playerId, req, res);
    }));
  }
  app.use('/v1/grading', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });

  // --- 404 for API ---
  app.use('/v1', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });

  return app;
}
