/**
 * Table geometry and the shot simulation. Coordinates are `across` 0-100 and `length` 0-200, where
 * `length` is the brief's `along` doubled so the table keeps its 2:1 shape.
 */
import type { Pocket } from './domain';
import type { PottedBall, ShotOutcome } from './rules';

export type Point = [x: number, y: number];
export type BallSpots = Record<number, Point>;

export const CUE_BALL = 0;
export const TABLE_WIDTH = 100;
export const TABLE_LENGTH = 200;
export const BALL_RADIUS = 2.2;
export const HEAD_SPOT: Point = [50, 50];
export const FOOT_SPOT: Point = [50, 150];

const STEP_SECONDS = 1 / 240;
const FRAME_SECONDS = 1 / 20;
const MAX_SECONDS = 9;
const ROLLING_DECELERATION = 62;
const REST_SPEED = 1.2;
const MAX_STRIKE_SPEED = 380;
const BALL_RESTITUTION = 0.95;
const CUSHION_RESTITUTION = 0.78;
const MAX_SIDE_SPIN = 0.32;
const MAX_FOLLOW = 0.55;
const CORNER_CAPTURE = 5.4;
const RACK_CENTRE = 4;
const MIDDLE_CAPTURE = 4.4;

const POCKET_SPOTS: Record<Pocket, Point> = {
  'top-left': [0, TABLE_LENGTH],
  'top-right': [TABLE_WIDTH, TABLE_LENGTH],
  'middle-left': [-1.5, TABLE_LENGTH / 2],
  'middle-right': [TABLE_WIDTH + 1.5, TABLE_LENGTH / 2],
  'bottom-left': [0, 0],
  'bottom-right': [TABLE_WIDTH, 0],
};

export const POCKET_ENTRIES = Object.entries(POCKET_SPOTS) as [Pocket, Point][];

export function aimVector(degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  return [Math.sin(radians), Math.cos(radians)];
}

export function aimTowards(from: Point, to: Point): number {
  const degrees = (Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI;
  return Math.round(((degrees + 360) % 360) * 10) / 10 % 360;
}

function freeOf(spots: BallSpots, x: number, y: number): boolean {
  return Object.values(spots).every(([bx, by]) => Math.hypot(bx - x, by - y) >= BALL_RADIUS * 2);
}

export function overlapsBall(spots: BallSpots, cue: Point): boolean {
  const others = { ...spots };
  delete others[CUE_BALL];
  return !freeOf(others, cue[0], cue[1]);
}

/** The nearest free point along the table's centre line from `spot`, towards the head end first. */
function freeSpotNear(spots: BallSpots, spot: Point, direction: 1 | -1): Point {
  for (let offset = 0; offset < TABLE_LENGTH / 2; offset += BALL_RADIUS) {
    for (const sign of [direction, -direction]) {
      const y = spot[1] + sign * offset;
      if (y > BALL_RADIUS && y < TABLE_LENGTH - BALL_RADIUS && freeOf(spots, spot[0], y)) return [spot[0], y];
    }
  }
  return spot;
}

export function cueSpotFrom(spots: BallSpots, spot: Point): Point {
  const others = { ...spots };
  delete others[CUE_BALL];
  return freeSpotNear(others, spot, -1);
}

export function respotted(spots: BallSpots, ball: number): Point {
  const others = { ...spots };
  delete others[ball];
  return freeSpotNear(others, FOOT_SPOT, 1);
}

/** A triangle (or diamond for 9-Ball) on the foot spot, the apex pointing at the head end. */
export function rackSpots(balls: readonly number[]): BallSpots {
  const spots: BallSpots = { [CUE_BALL]: HEAD_SPOT };
  const row = BALL_RADIUS * 1.76;
  const across = BALL_RADIUS * 2.04;
  const nine = balls.length <= 9 && balls.includes(9) && !balls.includes(10);
  const rows = nine ? [1, 2, 3, 2, 1] : [1, 2, 3, 4, 5];
  const seats: Point[] = [];
  rows.forEach((count, rowIndex) => {
    for (let index = 0; index < count; index += 1) {
      seats.push([FOOT_SPOT[0] + (index - (count - 1) / 2) * across, FOOT_SPOT[1] + rowIndex * row]);
    }
  });
  const middle = nine ? 9 : 8;
  const order = balls.filter((ball) => ball !== middle);
  let next = 0;
  seats.forEach((seat, index) => {
    if (index === RACK_CENTRE && balls.includes(middle)) spots[middle] = seat;
    else if (next < order.length) {
      spots[order[next]] = seat;
      next += 1;
    }
  });
  return spots;
}

export interface Contact {
  ball: number | null;
  ghost: Point;
  cut: number;
}

/** Where the aim line first meets a ball or a cushion, and the cut angle at that contact. */
export function predictContact(spots: BallSpots, aimDegrees: number): Contact {
  const cue = spots[CUE_BALL];
  const [dx, dy] = aimVector(aimDegrees);
  let nearest = Number.POSITIVE_INFINITY;
  let ball: number | null = null;
  for (const [key, [bx, by]] of Object.entries(spots)) {
    const number = Number(key);
    if (number === CUE_BALL) continue;
    const along = (bx - cue[0]) * dx + (by - cue[1]) * dy;
    const offLine = Math.abs((bx - cue[0]) * dy - (by - cue[1]) * dx);
    const reach = BALL_RADIUS * 2;
    if (along <= 0 || offLine >= reach) continue;
    const distance = along - Math.sqrt(reach * reach - offLine * offLine);
    if (distance < nearest) {
      nearest = distance;
      ball = number;
    }
  }
  const toRail = railDistance(cue, dx, dy);
  if (ball === null || nearest >= toRail) {
    return { ball: null, ghost: [cue[0] + dx * toRail, cue[1] + dy * toRail], cut: 0 };
  }
  const ghost: Point = [cue[0] + dx * nearest, cue[1] + dy * nearest];
  return { ball, ghost, cut: cutAngle(ghost, spots[ball], dx, dy) };
}

function railDistance(from: Point, dx: number, dy: number): number {
  const limits = [
    dx > 0 ? (TABLE_WIDTH - BALL_RADIUS - from[0]) / dx : dx < 0 ? (BALL_RADIUS - from[0]) / dx : Infinity,
    dy > 0 ? (TABLE_LENGTH - BALL_RADIUS - from[1]) / dy : dy < 0 ? (BALL_RADIUS - from[1]) / dy : Infinity,
  ];
  return Math.min(...limits);
}

function cutAngle(ghost: Point, target: Point, dx: number, dy: number): number {
  const cx = target[0] - ghost[0];
  const cy = target[1] - ghost[1];
  const length = Math.hypot(cx, cy);
  const cosine = Math.min(1, Math.abs((cx * dx + cy * dy) / length));
  return Math.round((Math.acos(cosine) * 1800) / Math.PI) / 10;
}

/** The cut a scripted shot reports: the angle between the aim and the line to the scripted first ball. */
export function cutTowards(spots: BallSpots, ball: number, aimDegrees: number): number {
  const contact = predictContact(spots, aimDegrees);
  if (contact.ball === ball) return contact.cut;
  const [dx, dy] = aimVector(aimDegrees);
  const target = spots[ball];
  if (target === undefined) return 0;
  return Math.min(90, cutAngle(spots[CUE_BALL], target, dx, dy));
}

export interface Strike {
  aimDegrees: number;
  power: number;
  sideSpin: number;
  topSpin: number;
  powerBonus: number;
  spinBonus: number;
}

interface Moving {
  ball: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SimulatedShot {
  outcome: ShotOutcome;
  frames: BallSpots[];
  rest: BallSpots;
  firstCut: number;
}

/** Runs one shot to rest. `breaking` asks for the break's cushion rule: four object balls into the rails. */
export function simulate(start: BallSpots, strike: Strike, breaking: boolean): SimulatedShot {
  const [dx, dy] = aimVector(strike.aimDegrees);
  const speed = (strike.power / 100) * MAX_STRIKE_SPEED * (1 + strike.powerBonus / 100);
  const spinScale = 1 + strike.spinBonus / 100;
  const sideEnglish = (strike.sideSpin / 100) * MAX_SIDE_SPIN * spinScale;
  const follow = (strike.topSpin / 100) * MAX_FOLLOW * spinScale;

  const moving: Moving[] = Object.entries(start).map(([key, [x, y]]) => ({ ball: Number(key), x, y, vx: 0, vy: 0 }));
  const cue = moving.find((item) => item.ball === CUE_BALL) as Moving;
  cue.vx = dx * speed;
  cue.vy = dy * speed;

  const predicted = predictContact(start, strike.aimDegrees);
  const pocketed: PottedBall[] = [];
  const railBalls = new Set<number>();
  const frames: BallSpots[] = [];
  let firstContact: number | null = null;
  let scratch = false;
  let cushionAfterContact = false;
  let unspentSide = sideEnglish;

  const totalSteps = Math.round(MAX_SECONDS / STEP_SECONDS);
  const stepsPerFrame = Math.round(FRAME_SECONDS / STEP_SECONDS);
  let live = moving;

  for (let step = 0; step < totalSteps; step += 1) {
    if (step % stepsPerFrame === 0) frames.push(snapshot(live));
    let anyMoving = false;
    for (const item of live) {
      const velocity = Math.hypot(item.vx, item.vy);
      if (velocity === 0) continue;
      const slowed = Math.max(0, velocity - ROLLING_DECELERATION * STEP_SECONDS);
      if (slowed < REST_SPEED) {
        item.vx = 0;
        item.vy = 0;
        continue;
      }
      item.vx *= slowed / velocity;
      item.vy *= slowed / velocity;
      item.x += item.vx * STEP_SECONDS;
      item.y += item.vy * STEP_SECONDS;
      anyMoving = true;
    }

    for (let i = 0; i < live.length; i += 1) {
      for (let j = i + 1; j < live.length; j += 1) {
        const a = live[i];
        const b = live[j];
        const gapX = b.x - a.x;
        const gapY = b.y - a.y;
        const distance = Math.hypot(gapX, gapY);
        const reach = BALL_RADIUS * 2;
        if (distance >= reach || distance === 0) continue;
        const nx = gapX / distance;
        const ny = gapY / distance;
        const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        const overlap = (reach - distance) / 2;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
        if (closing <= 0) continue;
        const impulse = (closing * (1 + BALL_RESTITUTION)) / 2;
        a.vx -= impulse * nx;
        a.vy -= impulse * ny;
        b.vx += impulse * nx;
        b.vy += impulse * ny;
        if (firstContact === null && (a.ball === CUE_BALL || b.ball === CUE_BALL)) {
          firstContact = a.ball === CUE_BALL ? b.ball : a.ball;
          const impactSpeed = closing * 0.5;
          cue.vx += dx * impactSpeed * follow;
          cue.vy += dy * impactSpeed * follow;
        }
      }
    }

    const remaining: Moving[] = [];
    for (const item of live) {
      const pocket = capturedBy(item);
      if (pocket !== null) {
        if (item.ball === CUE_BALL) scratch = true;
        else pocketed.push({ ball: item.ball, pocket });
        continue;
      }
      remaining.push(item);
      if (bounce(item, item.ball === CUE_BALL ? unspentSide : 0)) {
        if (item.ball === CUE_BALL) unspentSide = 0;
        if (item.ball !== CUE_BALL) railBalls.add(item.ball);
        if (firstContact !== null) cushionAfterContact = true;
      }
    }
    live = remaining;
    if (!anyMoving) break;
  }

  const rest = snapshot(live);
  frames.push(rest);
  return {
    outcome: {
      firstContact,
      pocketed,
      cushion: breaking ? railBalls.size >= 4 : cushionAfterContact,
      scratch,
      offTable: [],
    },
    frames,
    rest,
    firstCut: firstContact === predicted.ball ? predicted.cut : firstContact === null ? 0 : cutTowards(start, firstContact, strike.aimDegrees),
  };
}

function snapshot(balls: readonly Moving[]): BallSpots {
  const spots: BallSpots = {};
  for (const { ball, x, y } of balls) spots[ball] = [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
  return spots;
}

function capturedBy(item: Moving): Pocket | null {
  for (const [pocket, [px, py]] of POCKET_ENTRIES) {
    const capture = pocket.startsWith('middle') ? MIDDLE_CAPTURE : CORNER_CAPTURE;
    if (Math.hypot(item.x - px, item.y - py) < capture) return pocket;
  }
  return null;
}

function bounce(item: Moving, english: number): boolean {
  let hit = false;
  if (item.x < BALL_RADIUS || item.x > TABLE_WIDTH - BALL_RADIUS) {
    item.x = Math.min(TABLE_WIDTH - BALL_RADIUS, Math.max(BALL_RADIUS, item.x));
    item.vy += english * Math.abs(item.vx);
    item.vx = -item.vx * CUSHION_RESTITUTION;
    hit = true;
  }
  if (item.y < BALL_RADIUS || item.y > TABLE_LENGTH - BALL_RADIUS) {
    item.y = Math.min(TABLE_LENGTH - BALL_RADIUS, Math.max(BALL_RADIUS, item.y));
    item.vx += english * Math.abs(item.vy);
    item.vy = -item.vy * CUSHION_RESTITUTION;
    hit = true;
  }
  return hit;
}
