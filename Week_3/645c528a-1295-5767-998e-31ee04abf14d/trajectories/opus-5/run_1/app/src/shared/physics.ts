import {
  BALL_RADIUS,
  LENGTH,
  POCKET_MOUTHS,
  POCKET_RADIUS,
  WIDTH,
  clampInside,
  toPoint,
  toVec,
  type Vec,
  aimVector,
} from './table-geometry.js';
import { POCKETS, type Point, type ShotInput, type ShotOutcome } from './types.js';

const MAX_SPEED = 420;
const FRICTION = 150;
const CUSHION_RESTITUTION = 0.92;
const STEP = 1 / 240;
const MAX_STEPS = 6000;

interface Body {
  ball: number;
  position: Vec;
  velocity: Vec;
  live: boolean;
}

export interface SimulationResult {
  outcome: ShotOutcome;
  positions: Record<number, Point>;
  cueBall: Point;
}

/** Runs one shot to rest and reports what happened. The referee decides what it means. */
export function simulateShot(
  cueBall: Point,
  balls: number[],
  positions: Record<number, Point>,
  shot: ShotInput,
): SimulationResult {
  const dir = aimVector(shot.aimDegrees);
  const speed = (Math.max(0, Math.min(100, shot.power)) / 100) * MAX_SPEED;
  const bodies: Body[] = [{ ball: 0, position: toVec(cueBall), velocity: { x: dir.x * speed, y: dir.y * speed }, live: true }];
  for (const ball of balls) {
    const point = positions[ball];
    if (!point) continue;
    bodies.push({ ball, position: toVec(point), velocity: { x: 0, y: 0 }, live: true });
  }

  let firstContact: number | null = null;
  const pocketed: { ball: number; pocket: typeof POCKETS[number] }[] = [];
  let cushionAfterContact = false;
  let cushionCount = 0;
  let scratch = false;
  const sideCurve = (shot.sideSpin / 100) * 26;
  const followDraw = shot.topSpin / 100;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    let moving = false;
    for (const body of bodies) {
      if (!body.live) continue;
      const speedNow = Math.hypot(body.velocity.x, body.velocity.y);
      if (speedNow < 1) {
        body.velocity = { x: 0, y: 0 };
        continue;
      }
      moving = true;
      if (body.ball === 0 && firstContact === null && Math.abs(sideCurve) > 0) {
        const unit = { x: body.velocity.x / speedNow, y: body.velocity.y / speedNow };
        body.velocity.x += -unit.y * sideCurve * STEP;
        body.velocity.y += unit.x * sideCurve * STEP;
      }
      const decay = Math.max(0, speedNow - FRICTION * STEP) / speedNow;
      body.velocity.x *= decay;
      body.velocity.y *= decay;
      body.position.x += body.velocity.x * STEP;
      body.position.y += body.velocity.y * STEP;
    }
    if (!moving) break;

    for (const body of bodies) {
      if (!body.live) continue;
      const pocket = pocketUnder(body.position);
      if (pocket) {
        body.live = false;
        body.velocity = { x: 0, y: 0 };
        if (body.ball === 0) scratch = true;
        else pocketed.push({ ball: body.ball, pocket });
        continue;
      }
      let bounced = false;
      if (body.position.x < BALL_RADIUS) {
        body.position.x = BALL_RADIUS;
        body.velocity.x = Math.abs(body.velocity.x) * CUSHION_RESTITUTION;
        bounced = true;
      } else if (body.position.x > WIDTH - BALL_RADIUS) {
        body.position.x = WIDTH - BALL_RADIUS;
        body.velocity.x = -Math.abs(body.velocity.x) * CUSHION_RESTITUTION;
        bounced = true;
      }
      if (body.position.y < BALL_RADIUS) {
        body.position.y = BALL_RADIUS;
        body.velocity.y = Math.abs(body.velocity.y) * CUSHION_RESTITUTION;
        bounced = true;
      } else if (body.position.y > LENGTH - BALL_RADIUS) {
        body.position.y = LENGTH - BALL_RADIUS;
        body.velocity.y = -Math.abs(body.velocity.y) * CUSHION_RESTITUTION;
        bounced = true;
      }
      if (bounced) {
        cushionCount += 1;
        if (firstContact !== null) cushionAfterContact = true;
      }
    }

    for (let a = 0; a < bodies.length; a += 1) {
      for (let b = a + 1; b < bodies.length; b += 1) {
        const first = bodies[a];
        const second = bodies[b];
        if (!first || !second || !first.live || !second.live) continue;
        const dx = second.position.x - first.position.x;
        const dy = second.position.y - first.position.y;
        const distance = Math.hypot(dx, dy);
        if (distance === 0 || distance >= BALL_RADIUS * 2) continue;
        const normal = { x: dx / distance, y: dy / distance };
        const overlap = BALL_RADIUS * 2 - distance;
        first.position.x -= normal.x * overlap * 0.5;
        first.position.y -= normal.y * overlap * 0.5;
        second.position.x += normal.x * overlap * 0.5;
        second.position.y += normal.y * overlap * 0.5;
        const relative =
          (second.velocity.x - first.velocity.x) * normal.x + (second.velocity.y - first.velocity.y) * normal.y;
        if (relative > 0) continue;
        const impulse = -relative;
        first.velocity.x -= normal.x * impulse * 0.5;
        first.velocity.y -= normal.y * impulse * 0.5;
        second.velocity.x += normal.x * impulse * 0.5;
        second.velocity.y += normal.y * impulse * 0.5;
        if (first.ball === 0 && firstContact === null) {
          firstContact = second.ball;
          applyFollowDraw(first, normal, followDraw);
        } else if (second.ball === 0 && firstContact === null) {
          firstContact = first.ball;
          applyFollowDraw(second, { x: -normal.x, y: -normal.y }, followDraw);
        }
      }
    }
  }

  const restPositions: Record<number, Point> = {};
  let cueRest: Point = cueBall;
  for (const body of bodies) {
    if (body.ball === 0) {
      cueRest = toPoint(clampInside(body.position));
      continue;
    }
    if (!body.live) continue;
    restPositions[body.ball] = toPoint(clampInside(body.position));
  }

  return {
    outcome: {
      firstContact,
      pocketed,
      cushion: firstContact === null ? cushionCount > 0 : cushionAfterContact,
      scratch,
      offTable: [],
    },
    positions: restPositions,
    cueBall: cueRest,
  };
}

function applyFollowDraw(cue: Body, normal: Vec, followDraw: number): void {
  const push = 24 * followDraw;
  cue.velocity.x += normal.x * push;
  cue.velocity.y += normal.y * push;
}

function pocketUnder(position: Vec): typeof POCKETS[number] | null {
  for (const pocket of POCKETS) {
    const mouth = POCKET_MOUTHS[pocket];
    if (Math.hypot(mouth.x - position.x, mouth.y - position.y) <= POCKET_RADIUS) return pocket;
  }
  return null;
}

/** Resting places used when a scripted table jumps balls straight to rest. */
export function scatterPositions(balls: number[], seed: number): Record<number, Point> {
  const positions: Record<number, Point> = {};
  let state = seed || 1;
  const next = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  for (const ball of balls) {
    positions[ball] = {
      across: 12 + next() * 76,
      along: 10 + next() * 80,
    };
  }
  return positions;
}
