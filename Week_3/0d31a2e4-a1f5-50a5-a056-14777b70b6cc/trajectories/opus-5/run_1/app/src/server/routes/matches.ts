import { slotsFor, timeLimitTicks } from '../../shared/rounds.js';
import { BUTTONS_MAX, simulateRound } from '../../shared/sim/index.js';
import type { ForfeitRecord, InputRecord, RoundKind } from '../../shared/types.js';
import { fail, invalidTransition, validationFailed } from '../errors.js';
import { type Router, requireId, requireUser } from '../http/router.js';
import {
  findRound,
  handlesFor,
  loadMatch,
  replayRound,
  storedInputs,
} from '../services/matches.js';
import { runnerFor } from '../services/matchrunner.js';

const KINDS: readonly RoundKind[] = ['race', 'survival', 'final'];
const MAX_SIMULATE_INPUTS = 6000;
const MAX_STARTERS = 12;

function roundNumber(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 3) throw fail.roundNotFound();
  return n;
}

function parseTick(raw: string | null, lastTick: number): number {
  if (raw === null) throw fail.tickOutOfRange();
  const tick = Number(raw);
  if (!Number.isInteger(tick) || tick < 0 || tick > lastTick) throw fail.tickOutOfRange();
  return tick;
}

interface SimulateRequest {
  kind: RoundKind;
  seed: number;
  starters: number[];
  inputs: InputRecord[];
  forfeits: ForfeitRecord[];
  tick: number | null;
}

function parseSimulate(body: Record<string, unknown>): SimulateRequest {
  const fields: Record<string, string> = {};
  const kind = KINDS.find((candidate) => candidate === body.kind);
  if (kind === undefined) fields.kind = 'Choose race, survival or final.';
  const seed = Number(body.seed);
  if (
    typeof body.seed !== 'number' ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 4294967295
  ) {
    fields.seed = 'Use a whole number from 0 to 4294967295.';
  }
  const rawStarters = Array.isArray(body.starters) ? body.starters : null;
  const starters: number[] = [];
  if (rawStarters === null || rawStarters.length < 1 || rawStarters.length > MAX_STARTERS) {
    fields.starters = `Use 1 to ${MAX_STARTERS} distinct player ids.`;
  } else {
    for (const value of rawStarters) {
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        fields.starters = `Use 1 to ${MAX_STARTERS} distinct player ids.`;
        break;
      }
      if (starters.includes(value)) {
        fields.starters = `Use 1 to ${MAX_STARTERS} distinct player ids.`;
        break;
      }
      starters.push(value);
    }
  }
  const limit = kind === undefined ? 0 : timeLimitTicks(kind);
  const rawInputs = body.inputs === undefined ? [] : body.inputs;
  const inputs: InputRecord[] = [];
  if (!Array.isArray(rawInputs) || rawInputs.length > MAX_SIMULATE_INPUTS) {
    fields.inputs = `Send at most ${MAX_SIMULATE_INPUTS} inputs.`;
  } else {
    const seen = new Set<string>();
    for (const entry of rawInputs) {
      const record = entry as Record<string, unknown>;
      const tick = Number(record?.tick);
      const userId = Number(record?.userId);
      const buttons = Number(record?.buttons);
      const key = `${tick}:${userId}`;
      if (
        !Number.isInteger(tick) ||
        tick < 0 ||
        tick > limit ||
        !starters.includes(userId) ||
        !Number.isInteger(buttons) ||
        buttons < 0 ||
        buttons > BUTTONS_MAX ||
        seen.has(key)
      ) {
        fields.inputs = 'Each input needs a starter, a tick inside the round and buttons 0 to 63.';
        break;
      }
      seen.add(key);
      inputs.push({ tick, userId, buttons });
    }
  }
  const rawForfeits = body.forfeits === undefined ? [] : body.forfeits;
  const forfeits: ForfeitRecord[] = [];
  if (!Array.isArray(rawForfeits) || rawForfeits.length > MAX_STARTERS) {
    fields.forfeits = 'Send at most one forfeit per starter.';
  } else {
    const seen = new Set<number>();
    for (const entry of rawForfeits) {
      const record = entry as Record<string, unknown>;
      const tick = Number(record?.tick);
      const userId = Number(record?.userId);
      if (
        !Number.isInteger(tick) ||
        tick < 1 ||
        tick > limit ||
        !starters.includes(userId) ||
        seen.has(userId)
      ) {
        fields.forfeits = 'Send at most one forfeit per starter, inside the round.';
        break;
      }
      seen.add(userId);
      forfeits.push({ tick, userId });
    }
  }
  let tick: number | null = null;
  if (body.tick !== undefined) {
    const requested = Number(body.tick);
    if (typeof body.tick !== 'number' || !Number.isInteger(requested) || requested < 0) {
      fields.tick = 'Use a tick inside the round.';
    } else tick = requested;
  }
  if (Object.keys(fields).length > 0 || kind === undefined) throw validationFailed(fields);
  return { kind, seed, starters, inputs, forfeits, tick };
}

export function registerMatchRoutes(router: Router): void {
  router.add('GET', '/api/matches/:id', async (ctx) => {
    requireUser(ctx);
    const match = await loadMatch(requireId(ctx, 'id'));
    if (match === null) throw fail.matchNotFound();
    return { status: 200, body: { match } };
  });

  router.add('GET', '/api/matches/:id/rounds/:n/frames', async (ctx) => {
    requireUser(ctx);
    const row = await findRound(requireId(ctx, 'id'), roundNumber(ctx.params.n));
    if (row === null) throw fail.roundNotFound();
    const engine = await replayRound(row);
    const lastTick = engine.lastTick ?? 0;
    const tick = parseTick(ctx.url.searchParams.get('tick'), lastTick);
    const handles = await handlesFor(row.starters);
    return {
      status: 200,
      body: {
        matchId: row.match_id,
        round: row.n,
        kind: row.kind,
        tick,
        lastTick,
        slots: engine.slots,
        slotsLeft: engine.slotsLeftAt(tick),
        beans: engine.frameBeans(tick, handles),
      },
    };
  });

  router.add('GET', '/api/matches/:id/rounds/:n/inputs', async (ctx) => {
    requireUser(ctx);
    const row = await findRound(requireId(ctx, 'id'), roundNumber(ctx.params.n));
    if (row === null) throw fail.roundNotFound();
    if (row.state !== 'resolved') throw fail.roundNotResolved();
    const stored = await storedInputs(row.id);
    return {
      status: 200,
      body: {
        kind: row.kind,
        seed: Number(row.seed),
        starters: row.starters,
        inputs: stored.inputs,
        forfeits: stored.forfeits,
      },
    };
  });

  router.add('POST', '/api/matches/:id/forfeit', async (ctx) => {
    const me = requireUser(ctx);
    const matchId = requireId(ctx, 'id');
    const runner = runnerFor(matchId);
    if (runner === null) throw invalidTransition('resolved');
    runner.forfeit(me.id);
    return { status: 200, body: { result: { outcome: 'eliminated' } } };
  });

  router.add('POST', '/api/simulate', async (ctx) => {
    requireUser(ctx);
    const request = parseSimulate(ctx.body);
    const engine = simulateRound(
      request.kind,
      request.seed,
      request.starters,
      request.inputs,
      request.forfeits,
    );
    const lastTick = engine.lastTick ?? 0;
    const tick = request.tick ?? lastTick;
    if (tick > lastTick) throw validationFailed({ tick: 'Use a tick inside the round.' });
    const handles = await handlesFor(request.starters);
    return {
      status: 200,
      body: {
        kind: request.kind,
        seed: request.seed,
        slots: slotsFor(request.kind, request.starters.length),
        lastTick,
        results: engine.results(),
        frame: {
          tick,
          lastTick,
          slots: engine.slots,
          slotsLeft: engine.slotsLeftAt(tick),
          beans: engine.frameBeans(tick, handles),
        },
      },
    };
  });
}
