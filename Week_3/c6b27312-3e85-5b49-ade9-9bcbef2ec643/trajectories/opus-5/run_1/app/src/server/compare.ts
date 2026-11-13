import { COMPARE_MAX_CELLS, COMPARE_VOXEL_MM } from './config';
import { ApiError } from './errors';
import { Box, Pose, poseOfBox } from '../tine/preflight';
import { Solid, SolidOp, measure } from '../tine/solid';
import { cmpNumber, cmpText } from '../shared/order';
import { roundTo } from '../shared/numbers';

export class TooLargeToCompare extends ApiError {
  constructor() {
    super(422, {
      error: 'too_large_to_compare',
      message: 'These revisions are too large to compare at 0.5 mm.',
    });
  }
}

function boundsOf(solid: Solid): Box {
  const measures = measure(solid);
  return {
    min: [-measures.bbox[0] / 2, -measures.bbox[1] / 2, 0],
    max: [measures.bbox[0] / 2, measures.bbox[1] / 2, measures.bbox[2]],
  };
}

function bodyHeight(solid: Solid): number {
  const body = solid.ops.find((op) => op.op === 'box' || op.op === 'cylinder');
  if (!body) return 0;
  return body.op === 'box' ? body.h : body.op === 'cylinder' ? body.h : 0;
}

function pointDistanceToSegment(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(x - ax, y - ay);
  let t = ((x - ax) * dx + (y - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/** A cell is material when its centre is inside the solid. */
function inside(solid: Solid, height: number, x: number, y: number, z: number): boolean {
  let material = false;
  for (const op of solid.ops as SolidOp[]) {
    if (op.op === 'box') {
      material = Math.abs(x) <= op.w / 2 && Math.abs(y) <= op.d / 2 && z >= 0 && z <= op.h;
    } else if (op.op === 'cylinder') {
      material = Math.hypot(x, y) <= op.dia / 2 && z >= 0 && z <= op.h;
    }
  }
  for (const op of solid.ops as SolidOp[]) {
    if (op.op === 'boss') {
      if (
        Math.hypot(x - op.x, y - op.y) <= op.dia / 2 &&
        z >= height &&
        z <= height + op.h
      ) {
        return true;
      }
    }
  }
  if (!material) return false;
  for (const op of solid.ops as SolidOp[]) {
    if (op.op === 'hole') {
      if (Math.hypot(x - op.x, y - op.y) <= op.dia / 2 && z >= 0 && z <= height) return false;
    } else if (op.op === 'slot') {
      const distance = pointDistanceToSegment(x, y, op.x - op.len / 2, op.y, op.x + op.len / 2, op.y);
      if (distance <= op.w / 2 && z >= 0 && z <= height) return false;
    }
  }
  return true;
}

export type Hunk = {
  index: number;
  kind: 'added' | 'removed';
  volume: number;
  box: Box;
  pose: Pose;
};

export type CompareResult = {
  identical: boolean;
  added: number;
  removed: number;
  unchanged: number;
  hunks: Hunk[];
};

/** Compare voxelises both stored solids on the published grid. */
export function compareSolids(base: Solid, head: Solid): CompareResult {
  const cell = COMPARE_VOXEL_MM;
  const baseBounds = boundsOf(base);
  const headBounds = boundsOf(head);
  const minimum = [0, 1, 2].map((axis) => Math.min(baseBounds.min[axis], headBounds.min[axis]));
  const maximum = [0, 1, 2].map((axis) => Math.max(baseBounds.max[axis], headBounds.max[axis]));
  const start = minimum.map((value) => Math.floor(value / cell));
  const end = maximum.map((value) => Math.ceil(value / cell));
  const counts = [0, 1, 2].map((axis) => Math.max(0, end[axis] - start[axis]));
  const total = counts[0] * counts[1] * counts[2];
  if (total > COMPARE_MAX_CELLS) throw new TooLargeToCompare();

  const baseHeight = bodyHeight(base);
  const headHeight = bodyHeight(head);
  const state = new Uint8Array(total);
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (let iz = 0; iz < counts[2]; iz += 1) {
    const z = (start[2] + iz + 0.5) * cell;
    for (let iy = 0; iy < counts[1]; iy += 1) {
      const y = (start[1] + iy + 0.5) * cell;
      for (let ix = 0; ix < counts[0]; ix += 1) {
        const x = (start[0] + ix + 0.5) * cell;
        const inBase = inside(base, baseHeight, x, y, z);
        const inHead = inside(head, headHeight, x, y, z);
        const index = ix + counts[0] * (iy + counts[1] * iz);
        if (inBase && inHead) {
          unchanged += 1;
          state[index] = 3;
        } else if (inHead) {
          added += 1;
          state[index] = 1;
        } else if (inBase) {
          removed += 1;
          state[index] = 2;
        }
      }
    }
  }

  const cellVolume = cell * cell * cell;
  const hunks: Hunk[] = [];
  const seen = new Uint8Array(total);
  const stack: number[] = [];
  for (let index = 0; index < total; index += 1) {
    const kindValue = state[index];
    if ((kindValue !== 1 && kindValue !== 2) || seen[index]) continue;
    stack.length = 0;
    stack.push(index);
    seen[index] = 1;
    let cells = 0;
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    while (stack.length > 0) {
      const current = stack.pop()!;
      cells += 1;
      const ix = current % counts[0];
      const iy = Math.floor(current / counts[0]) % counts[1];
      const iz = Math.floor(current / (counts[0] * counts[1]));
      const coordinates = [ix, iy, iz];
      for (let axis = 0; axis < 3; axis += 1) {
        low[axis] = Math.min(low[axis], (start[axis] + coordinates[axis]) * cell);
        high[axis] = Math.max(high[axis], (start[axis] + coordinates[axis] + 1) * cell);
      }
      const neighbours: [number, number, number][] = [
        [ix - 1, iy, iz],
        [ix + 1, iy, iz],
        [ix, iy - 1, iz],
        [ix, iy + 1, iz],
        [ix, iy, iz - 1],
        [ix, iy, iz + 1],
      ];
      for (const [nx, ny, nz] of neighbours) {
        if (nx < 0 || ny < 0 || nz < 0 || nx >= counts[0] || ny >= counts[1] || nz >= counts[2]) continue;
        const neighbour = nx + counts[0] * (ny + counts[1] * nz);
        if (seen[neighbour] || state[neighbour] !== kindValue) continue;
        seen[neighbour] = 1;
        stack.push(neighbour);
      }
    }
    const box: Box = {
      min: [roundTo(low[0], 3), roundTo(low[1], 3), roundTo(low[2], 3)],
      max: [roundTo(high[0], 3), roundTo(high[1], 3), roundTo(high[2], 3)],
    };
    hunks.push({
      index: 0,
      kind: kindValue === 1 ? 'added' : 'removed',
      volume: roundTo(cells * cellVolume, 3),
      box,
      pose: poseOfBox(box),
    });
  }

  hunks.sort((a, b) => {
    const byVolume = -cmpNumber(a.volume, b.volume);
    if (byVolume !== 0) return byVolume;
    const byKind = cmpText(a.kind === 'removed' ? '0' : '1', b.kind === 'removed' ? '0' : '1');
    if (byKind !== 0) return byKind;
    for (let axis = 0; axis < 3; axis += 1) {
      const byMin = cmpNumber(a.box.min[axis], b.box.min[axis]);
      if (byMin !== 0) return byMin;
    }
    for (let axis = 0; axis < 3; axis += 1) {
      const byMax = cmpNumber(a.box.max[axis], b.box.max[axis]);
      if (byMax !== 0) return byMax;
    }
    return 0;
  });
  hunks.forEach((hunk, position) => {
    hunk.index = position + 1;
  });

  return {
    identical: false,
    added: roundTo(added * cellVolume, 3),
    removed: roundTo(removed * cellVolume, 3),
    unchanged: roundTo(unchanged * cellVolume, 3),
    hunks,
  };
}
