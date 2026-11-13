import {
  BODY_ORDER,
  CUSHION,
  POCKET_CENTRES,
  POCKET_RADIUS,
  STRIKER_COIN_TOUCH,
  STRIKER_RADIUS,
  massOf,
  radiusOf,
  round1,
} from './geometry.js';
import type { Body, Frame, PieceId, PocketId, SimulationResult, ShotEvents } from './types.js';

export const STEP_SECONDS = 1 / 240;
export const SUBSTEPS = 4;
const SUBSTEP_SECONDS = STEP_SECONDS / SUBSTEPS;

export const RESTITUTION_COIN_COIN = 0.9;
export const RESTITUTION_STRIKER_COIN = 0.88;
export const RESTITUTION_CUSHION = 0.75;

/** Sliding friction: mu 0.045 against g 9810 mm/s squared. */
export const FRICTION_DECELERATION = 441.45;

export const CAPTURE_SPEED = 1800;
export const REST_SPEED = 0.5;
export const MAX_SHOT_SECONDS = 12;
export const FRAME_SECONDS = 1 / 60;

const CCD_ITERATIONS = 48;

function captureRadius(radius: number): number {
  return POCKET_RADIUS - 0.2 * radius;
}

function restitutionBetween(a: PieceId, b: PieceId): number {
  return a === 'striker' || b === 'striker' ? RESTITUTION_STRIKER_COIN : RESTITUTION_COIN_COIN;
}

export function makeBody(id: PieceId, x: number, y: number, vx: number, vy: number): Body {
  return { id, x, y, vx, vy, radius: radiusOf(id), mass: massOf(id), pocketed: null };
}

/** Bodies are ordered striker, queen, w1..w9, b1..b9 for every pass. */
export function orderBodies(bodies: Body[]): Body[] {
  return BODY_ORDER.map((id) => bodies.find((b) => b.id === id)).filter((b): b is Body => b !== undefined);
}

interface Collision {
  t: number;
  kind: 'pair' | 'wall';
  a: Body;
  b: Body | null;
  axis: 'x' | 'y';
}

function pairTime(a: Body, b: Body, limit: number): number | null {
  const px = b.x - a.x;
  const py = b.y - a.y;
  const vx = b.vx - a.vx;
  const vy = b.vy - a.vy;
  const sum = a.radius + b.radius;
  const quadA = vx * vx + vy * vy;
  if (quadA === 0) return null;
  const quadB = 2 * (px * vx + py * vy);
  if (quadB >= 0) return null;
  const quadC = px * px + py * py - sum * sum;
  if (quadC <= 0) return 0;
  const disc = quadB * quadB - 4 * quadA * quadC;
  if (disc < 0) return null;
  const t = (-quadB - Math.sqrt(disc)) / (2 * quadA);
  if (t < 0 || t > limit) return null;
  return t;
}

function wallTime(body: Body, axis: 'x' | 'y', limit: number): number | null {
  const bound = CUSHION - body.radius;
  const pos = axis === 'x' ? body.x : body.y;
  const vel = axis === 'x' ? body.vx : body.vy;
  if (vel === 0) return null;
  const target = vel > 0 ? bound : -bound;
  const t = (target - pos) / vel;
  if (t < 0) return pos * vel > 0 && Math.abs(pos) >= bound ? 0 : null;
  if (t > limit) return null;
  return t;
}

function earliest(bodies: Body[], limit: number): Collision | null {
  let best: Collision | null = null;
  for (let i = 0; i < bodies.length; i += 1) {
    const a = bodies[i];
    for (const axis of ['x', 'y'] as const) {
      const t = wallTime(a, axis, limit);
      if (t !== null && (best === null || t < best.t)) best = { t, kind: 'wall', a, b: null, axis };
    }
    for (let j = i + 1; j < bodies.length; j += 1) {
      const t = pairTime(a, bodies[j], limit);
      if (t !== null && (best === null || t < best.t)) best = { t, kind: 'pair', a, b: bodies[j], axis: 'x' };
    }
  }
  return best;
}

function advance(bodies: Body[], dt: number): void {
  for (const b of bodies) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }
}

function applyFriction(bodies: Body[], dt: number): void {
  const drop = FRICTION_DECELERATION * dt;
  for (const b of bodies) {
    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (speed === 0) continue;
    if (speed <= drop) {
      b.vx = 0;
      b.vy = 0;
    } else {
      const scale = (speed - drop) / speed;
      b.vx *= scale;
      b.vy *= scale;
    }
  }
}

function resolvePair(a: Body, b: Body): boolean {
  const px = b.x - a.x;
  const py = b.y - a.y;
  const dist = Math.sqrt(px * px + py * py);
  if (dist === 0) return false;
  const nx = px / dist;
  const ny = py / dist;
  const approach = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (approach <= 0) return false;
  const e = restitutionBetween(a.id, b.id);
  const impulse = ((1 + e) * approach) / (1 / a.mass + 1 / b.mass);
  a.vx -= (impulse / a.mass) * nx;
  a.vy -= (impulse / a.mass) * ny;
  b.vx += (impulse / b.mass) * nx;
  b.vy += (impulse / b.mass) * ny;
  return true;
}

function resolveWall(body: Body, axis: 'x' | 'y'): boolean {
  if (axis === 'x') {
    if (body.x * body.vx <= 0) return false;
    body.vx = -RESTITUTION_CUSHION * body.vx;
  } else {
    if (body.y * body.vy <= 0) return false;
    body.vy = -RESTITUTION_CUSHION * body.vy;
  }
  return true;
}

function clampInside(bodies: Body[]): void {
  for (const b of bodies) {
    const bound = CUSHION - b.radius;
    if (b.x > bound) b.x = bound;
    if (b.x < -bound) b.x = -bound;
    if (b.y > bound) b.y = bound;
    if (b.y < -bound) b.y = -bound;
  }
}

function capture(bodies: Body[], pocketed: { id: PieceId; pocket: PocketId }[]): Body[] {
  const left: Body[] = [];
  for (const b of bodies) {
    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    let taken: PocketId | null = null;
    if (speed < CAPTURE_SPEED) {
      const reach = captureRadius(b.radius);
      for (const pocket of POCKET_CENTRES) {
        const dx = b.x - pocket.x;
        const dy = b.y - pocket.y;
        if (Math.sqrt(dx * dx + dy * dy) <= reach) {
          taken = pocket.id;
          break;
        }
      }
    }
    if (taken === null) {
      left.push(b);
    } else {
      b.pocketed = taken;
      pocketed.push({ id: b.id, pocket: taken });
    }
  }
  return left;
}

function snapshot(bodies: Body[], t: number): Frame {
  return {
    t: round3(t),
    pieces: bodies.map((b) => ({ id: b.id, x: round1(b.x), y: round1(b.y) })),
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function atRest(bodies: Body[]): boolean {
  for (const b of bodies) {
    if (Math.sqrt(b.vx * b.vx + b.vy * b.vy) >= REST_SPEED) return false;
  }
  return true;
}

/**
 * Runs dc-model-1 over a set of bodies until they come to rest. The same input always
 * produces the same events, frames and final positions.
 */
export function simulate(initial: Body[]): SimulationResult {
  const all = orderBodies(initial);
  let live = all.filter((b) => b.pocketed === null);
  const pocketed: { id: PieceId; pocket: PocketId }[] = [];
  let firstContact: PieceId | 'cushion' | null = null;
  const hasStriker = all.some((b) => b.id === 'striker');
  let contactSettled = !hasStriker;

  const frames: Frame[] = [snapshot(live, 0)];
  let time = 0;
  let nextFrame = FRAME_SECONDS;

  while (time < MAX_SHOT_SECONDS && !atRest(live)) {
    for (let s = 0; s < SUBSTEPS; s += 1) {
      applyFriction(live, SUBSTEP_SECONDS);
      let remaining = SUBSTEP_SECONDS;
      for (let guard = 0; guard < CCD_ITERATIONS && remaining > 0; guard += 1) {
        const hit = earliest(live, remaining);
        if (hit === null) {
          advance(live, remaining);
          remaining = 0;
          break;
        }
        advance(live, hit.t);
        remaining -= hit.t;
        if (hit.kind === 'pair' && hit.b !== null) {
          const touched = resolvePair(hit.a, hit.b);
          if (touched && !contactSettled) {
            if (hit.a.id === 'striker') {
              firstContact = hit.b.id;
              contactSettled = true;
            } else if (hit.b.id === 'striker') {
              firstContact = hit.a.id;
              contactSettled = true;
            }
          }
          if (!touched) break;
        } else {
          const bounced = resolveWall(hit.a, hit.axis);
          if (bounced && !contactSettled && hit.a.id === 'striker') {
            firstContact = 'cushion';
            contactSettled = true;
          }
          if (!bounced) break;
        }
      }
      clampInside(live);
      live = capture(live, pocketed);
    }
    time += STEP_SECONDS;
    if (time >= nextFrame) {
      frames.push(snapshot(live, time));
      while (nextFrame <= time) nextFrame += FRAME_SECONDS;
    }
  }

  for (const b of live) {
    b.x = round1(b.x);
    b.y = round1(b.y);
  }
  frames.push(snapshot(live, time));

  let maxSpeed = 0;
  for (const b of live) {
    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (speed > maxSpeed) maxSpeed = speed;
    b.vx = 0;
    b.vy = 0;
  }

  const events: ShotEvents = {
    firstContact,
    pocketed,
    strikerPocketed: pocketed.some((p) => p.id === 'striker'),
  };

  return {
    events,
    frames,
    final: all.map((b) => ({
      id: b.id,
      x: b.pocketed === null ? b.x : null,
      y: b.pocketed === null ? b.y : null,
      state: b.pocketed === null ? ('board' as const) : ('pocketed' as const),
    })),
    durationSeconds: round3(time),
    maxSpeedAtRest: maxSpeed,
  };
}

/**
 * Traces the striker's straight path until it first touches a coin or the queen, or a
 * cushion. It predicts no rebound.
 */
export function aimGuide(
  striker: { x: number; y: number },
  direction: { dx: number; dy: number },
  coins: { id: PieceId; x: number; y: number }[],
): PieceId | 'cushion' {
  let bestT = Number.POSITIVE_INFINITY;
  let best: PieceId | 'cushion' = 'cushion';

  for (const axis of ['x', 'y'] as const) {
    const bound = CUSHION - STRIKER_RADIUS;
    const pos = axis === 'x' ? striker.x : striker.y;
    const vel = axis === 'x' ? direction.dx : direction.dy;
    if (vel === 0) continue;
    const t = ((vel > 0 ? bound : -bound) - pos) / vel;
    if (t >= 0 && t < bestT) {
      bestT = t;
      best = 'cushion';
    }
  }

  for (const coin of coins) {
    const px = coin.x - striker.x;
    const py = coin.y - striker.y;
    const quadB = -2 * (px * direction.dx + py * direction.dy);
    const quadA = direction.dx * direction.dx + direction.dy * direction.dy;
    const quadC = px * px + py * py - STRIKER_COIN_TOUCH * STRIKER_COIN_TOUCH;
    const disc = quadB * quadB - 4 * quadA * quadC;
    if (disc < 0) continue;
    const t = (-quadB - Math.sqrt(disc)) / (2 * quadA);
    if (t >= 0 && t < bestT) {
      bestT = t;
      best = coin.id;
    }
  }

  return best;
}
