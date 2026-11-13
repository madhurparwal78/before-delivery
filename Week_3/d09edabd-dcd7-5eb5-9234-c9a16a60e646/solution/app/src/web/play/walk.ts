import type { Stance } from '../three/poses';
import type { RoomDims } from '../three/roomView';
import type { Placement, PlayNode } from '../../shared/types';

const WALK_SPEED_MM_PER_S = 1600;
const WALL_MARGIN_MM = 300;
const APPROACH_MM = 1500;
const BODY_RADIUS_MM = 250;

export interface Position {
  xMm: number;
  zMm: number;
}

/** What the tester asks for, each axis from -1 to 1: forward is along the heading, strafe is to its right. */
export interface Intent {
  forward: number;
  strafe: number;
}

/** Where pushed placements now stand, by placement id. The room itself is never changed. */
export type Pushed = Readonly<Record<string, Position>>;

const rad = (deg: number): number => (deg * Math.PI) / 180;
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

export const stoodAt = (placement: Placement, pushed: Pushed): Placement => (pushed[placement.id] ? { ...placement, ...pushed[placement.id] } : placement);

function keepInside(at: Position, room: RoomDims, margin: number): Position {
  return { xMm: clamp(at.xMm, margin, room.widthMm - margin), zMm: clamp(at.zMm, margin, room.depthMm - margin) };
}

/** Walks along the heading for `dtMs`, staying 0.3 m off the walls. */
export function walkStep(from: Stance, intent: Intent, dtMs: number, room: RoomDims): Position {
  const reach = Math.hypot(intent.forward, intent.strafe);
  if (reach === 0) return from;
  const distance = (WALK_SPEED_MM_PER_S * dtMs) / 1000 / Math.max(1, reach);
  const heading = rad(from.headingDeg);
  return keepInside(
    {
      xMm: from.xMm + (Math.sin(heading) * intent.forward + Math.cos(heading) * intent.strafe) * distance,
      zMm: from.zMm + (Math.cos(heading) * intent.forward - Math.sin(heading) * intent.strafe) * distance,
    },
    room,
    WALL_MARGIN_MM,
  );
}

interface Overlap {
  depth: number;
  /** Unit direction from the placement towards the tester, in room coordinates. */
  nx: number;
  nz: number;
}

/** How far the tester's body sits inside a box (its rotated rectangle) or a cylinder (a circle of its mean radius). */
function overlapWith(walker: Position, body: Placement): Overlap | null {
  const angle = rad(body.rotationDeg);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = walker.xMm - body.xMm;
  const dz = walker.zMm - body.zMm;
  const lx = dx * cos + dz * sin;
  const lz = -dx * sin + dz * cos;
  let local: { nx: number; nz: number; depth: number };
  if (body.kind === 'cylinder') {
    const distance = Math.hypot(lx, lz);
    local = { nx: distance > 0 ? lx / distance : 1, nz: distance > 0 ? lz / distance : 0, depth: (body.widthMm + body.depthMm) / 4 + BODY_RADIUS_MM - distance };
  } else {
    const halfW = body.widthMm / 2;
    const halfD = body.depthMm / 2;
    const outX = lx - clamp(lx, -halfW, halfW);
    const outZ = lz - clamp(lz, -halfD, halfD);
    const distance = Math.hypot(outX, outZ);
    if (distance > 0) local = { nx: outX / distance, nz: outZ / distance, depth: BODY_RADIUS_MM - distance };
    else if (halfW - Math.abs(lx) < halfD - Math.abs(lz)) local = { nx: Math.sign(lx) || 1, nz: 0, depth: halfW - Math.abs(lx) + BODY_RADIUS_MM };
    else local = { nx: 0, nz: Math.sign(lz) || 1, depth: halfD - Math.abs(lz) + BODY_RADIUS_MM };
  }
  if (local.depth <= 0) return null;
  return { depth: local.depth, nx: local.nx * cos - local.nz * sin, nz: local.nx * sin + local.nz * cos };
}

/**
 * Walking into a box or cylinder shoves it out of the way. A placement that meets a wall cannot go further,
 * and then the tester is held back instead.
 */
export function pushPlacements(walker: Position, placements: readonly Placement[], pushed: Pushed, room: RoomDims): { walker: Position; pushed: Pushed } {
  let at = walker;
  let moved = pushed;
  for (const placement of placements) {
    if (placement.kind !== 'box' && placement.kind !== 'cylinder') continue;
    const body = stoodAt(placement, moved);
    const overlap = overlapWith(at, body);
    if (!overlap) continue;
    const shoved = { xMm: body.xMm - overlap.nx * overlap.depth, zMm: body.zMm - overlap.nz * overlap.depth };
    const target = keepInside(shoved, room, Math.min(body.widthMm, body.depthMm) / 2);
    moved = { ...moved, [body.id]: target };
    at = { xMm: at.xMm + target.xMm - shoved.xMm, zMm: at.zMm + target.zMm - shoved.zMm };
  }
  return { walker: keepInside(at, room, WALL_MARGIN_MM), pushed: moved };
}

/** The ids of the available nodes whose linked placement stands within 1.5 m of the tester. */
export function nodesInReach(walker: Position, nodes: readonly PlayNode[], placements: readonly Placement[], pushed: Pushed): Set<string> {
  const near = new Set<string>();
  for (const node of nodes) {
    const placement = placements.find((p) => p.id === node.placementId);
    if (!node.available || !placement) continue;
    const there = stoodAt(placement, pushed);
    if (Math.hypot(there.xMm - walker.xMm, there.zMm - walker.zMm) <= APPROACH_MM) near.add(node.id);
  }
  return near;
}
