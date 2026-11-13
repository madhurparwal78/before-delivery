import { POCKETS, type Point, type Pocket } from './types.js';

/** Physical play surface: x across the short axis, y along the long axis, foot end at y = LENGTH. */
export const WIDTH = 100;
export const LENGTH = 200;
export const BALL_RADIUS = 2.25;
export const POCKET_RADIUS = 4.4;
export const HEAD_STRING_ALONG = 25;
export const HEAD_SPOT: Point = { across: 50, along: HEAD_STRING_ALONG };
export const FOOT_SPOT: Point = { across: 50, along: 75 };

export interface Vec {
  x: number;
  y: number;
}

export const POCKET_MOUTHS: Record<Pocket, Vec> = {
  'bottom-left': { x: 0, y: 0 },
  'bottom-right': { x: WIDTH, y: 0 },
  'middle-left': { x: 0, y: LENGTH / 2 },
  'middle-right': { x: WIDTH, y: LENGTH / 2 },
  'top-left': { x: 0, y: LENGTH },
  'top-right': { x: WIDTH, y: LENGTH },
};

export function toVec(point: Point): Vec {
  return { x: point.across, y: point.along * 2 };
}

export function toPoint(vec: Vec): Point {
  return { across: vec.x, along: vec.y / 2 };
}

/** 0.0 degrees points at the foot end and values rise clockwise. */
export function aimVector(aimDegrees: number): Vec {
  const rad = (aimDegrees * Math.PI) / 180;
  return { x: Math.sin(rad), y: Math.cos(rad) };
}

export function rackPositions(mode: 'eight-ball' | 'nine-ball' | 'no-guidelines'): Record<number, Point> {
  const positions: Record<number, Point> = {};
  const apex = toVec(FOOT_SPOT);
  const rowGap = BALL_RADIUS * 1.74;
  if (mode === 'nine-ball') {
    const diamond = [
      [1, 0, 0],
      [2, -1, 1],
      [3, 1, 1],
      [4, -2, 2],
      [9, 0, 2],
      [5, 2, 2],
      [6, -1, 3],
      [7, 1, 3],
      [8, 0, 4],
    ] as const;
    for (const [ball, col, row] of diamond) {
      positions[ball] = toPoint({ x: apex.x + col * BALL_RADIUS * 1.02, y: apex.y + row * rowGap });
    }
    return positions;
  }
  const order = [1, 11, 5, 2, 8, 12, 6, 14, 3, 13, 7, 10, 4, 15, 9];
  let index = 0;
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col <= row; col += 1) {
      const ball = order[index];
      index += 1;
      if (ball === undefined) continue;
      positions[ball] = toPoint({
        x: apex.x + (col - row / 2) * BALL_RADIUS * 2.04,
        y: apex.y + row * rowGap,
      });
    }
  }
  return positions;
}

export function clampInside(vec: Vec): Vec {
  return {
    x: Math.min(WIDTH - BALL_RADIUS, Math.max(BALL_RADIUS, vec.x)),
    y: Math.min(LENGTH - BALL_RADIUS, Math.max(BALL_RADIUS, vec.y)),
  };
}

export interface FirstBallPrediction {
  ball: number | null;
  cutAngle: number | null;
  blocked: boolean;
  contact: Vec | null;
  tangent: Vec | null;
}

/** The first ball on the aim line, with the cut angle at contact. */
export function predictFirstBall(
  cueBall: Point,
  aimDegrees: number,
  positions: Record<number, Point>,
  balls: number[],
): FirstBallPrediction {
  const origin = toVec(cueBall);
  const dir = aimVector(aimDegrees);
  let bestBall: number | null = null;
  let bestDistance = Infinity;
  let bestGhost: Vec | null = null;
  for (const ball of balls) {
    const point = positions[ball];
    if (!point) continue;
    const centre = toVec(point);
    const relative = { x: centre.x - origin.x, y: centre.y - origin.y };
    const along = relative.x * dir.x + relative.y * dir.y;
    if (along <= 0) continue;
    const perpendicular = Math.abs(relative.x * dir.y - relative.y * dir.x);
    const reach = BALL_RADIUS * 2;
    if (perpendicular > reach) continue;
    const back = Math.sqrt(reach * reach - perpendicular * perpendicular);
    const travel = along - back;
    if (travel < 0 || travel >= bestDistance) continue;
    bestDistance = travel;
    bestBall = ball;
    bestGhost = { x: origin.x + dir.x * travel, y: origin.y + dir.y * travel };
  }
  const cushionDistance = distanceToCushion(origin, dir);
  if (bestBall === null || bestGhost === null || cushionDistance < bestDistance) {
    return { ball: null, cutAngle: null, blocked: true, contact: null, tangent: null };
  }
  const target = positions[bestBall];
  if (!target) return { ball: null, cutAngle: null, blocked: true, contact: null, tangent: null };
  const centre = toVec(target);
  const lineOfCentres = { x: centre.x - bestGhost.x, y: centre.y - bestGhost.y };
  const length = Math.hypot(lineOfCentres.x, lineOfCentres.y) || 1;
  const unit = { x: lineOfCentres.x / length, y: lineOfCentres.y / length };
  const dot = Math.min(1, Math.max(-1, unit.x * dir.x + unit.y * dir.y));
  const cutAngle = Math.round((Math.acos(dot) * 180) / Math.PI * 10) / 10;
  return {
    ball: bestBall,
    cutAngle,
    blocked: false,
    contact: bestGhost,
    tangent: { x: -unit.y, y: unit.x },
  };
}

function distanceToCushion(origin: Vec, dir: Vec): number {
  let best = Infinity;
  const limits: Array<[number, number, number]> = [
    [dir.x, BALL_RADIUS - origin.x, 0],
    [dir.x, WIDTH - BALL_RADIUS - origin.x, 0],
    [dir.y, BALL_RADIUS - origin.y, 1],
    [dir.y, LENGTH - BALL_RADIUS - origin.y, 1],
  ];
  for (const [component, gap] of limits) {
    if (Math.abs(component) < 1e-9) continue;
    const distance = gap / component;
    if (distance > 0 && distance < best) best = distance;
  }
  return best;
}
