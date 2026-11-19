// The movement rule and the walk-to-spot rule, decided only here.

import { Heading } from "./world";

export type Gait = "idle" | "walk" | "run" | "jump";

export interface Explorer {
  tile: [number, number];
  heading: Heading;
  gait: Gait;
}

export interface IsLandFn {
  (island: number, x: number, y: number): boolean;
}

export interface StepInput {
  /** Direction held at this step's own moment, or null. */
  direction: Heading | null;
  /** True while the run toggle or Shift is active at this step's moment. */
  running: boolean;
  /** True when a jump was requested before this step's moment. */
  jumpQueued: boolean;
}

export interface StepResult {
  tile: [number, number];
  heading: Heading;
  gait: Gait;
  /** Steps 1,3,5... are walking move steps. */
  moved: boolean;
  /** True when a jump finished (landed) on this step. */
  landed: boolean;
  /** True when the explorer is mid-jump after this step. */
  jumping: boolean;
  /** Steps remaining in the current jump, 0 when none. */
  jumpSteps: number;
}

export function stepOf(e: Explorer, island: number, input: StepInput, isLand: IsLandFn, heldSteps: number, jumpSteps: number): StepResult {
  // A jump lasts 4 steps: the start step and three more, landing on the fourth.
  if (jumpSteps > 0) {
    if (jumpSteps <= 2) {
      const [dx, dy] = deltaOf(e.heading);
      const tx = e.tile[0] + 2 * dx;
      const ty = e.tile[1] + 2 * dy;
      if (isLand(island, tx, ty)) return { tile: [tx, ty], heading: e.heading, gait: "jump", moved: false, landed: true, jumping: false, jumpSteps: 0 };
      return { tile: [e.tile[0], e.tile[1]], heading: e.heading, gait: "jump", moved: false, landed: true, jumping: false, jumpSteps: 0 };
    }
    return { tile: [e.tile[0], e.tile[1]], heading: e.heading, gait: "jump", moved: false, landed: false, jumping: true, jumpSteps: jumpSteps - 1 };
  }

  if (input.direction === null) {
    return { tile: [e.tile[0], e.tile[1]], heading: e.heading, gait: input.jumpQueued ? "jump" : "idle", moved: false, landed: false, jumping: input.jumpQueued, jumpSteps: input.jumpQueued ? 4 : 0 };
  }

  // A held direction moves on its odd held steps (1, 3, 5...); the first step also turns the explorer.
  const turned: Heading = input.direction;
  const [dx, dy] = deltaOf(turned);
  const tx = e.tile[0] + dx;
  const ty = e.tile[1] + dy;
  const land = isLand(island, tx, ty);
  const moveNow = input.running || heldSteps % 2 === 0;
  const gait: Gait = input.running ? "run" : input.jumpQueued ? "jump" : "walk";
  return { tile: moveNow && land ? [tx, ty] : [e.tile[0], e.tile[1]], heading: turned, gait, moved: moveNow && land, landed: false, jumping: input.jumpQueued, jumpSteps: input.jumpQueued ? 4 : 0 };
}

export function deltaOf(h: Heading): [number, number] {
  switch (h) {
    case "N": return [0, -1];
    case "E": return [1, 0];
    case "S": return [0, 1];
    case "W": return [-1, 0];
  }
}

/** Shortest 4-direction path over land; at each tile the first of N, E, S, W that still lies on a shortest path to the goal. */
export function walkPath(island: number, from: [number, number], to: [number, number], isLand: IsLandFn): [number, number][] | null {
  const key = (x: number, y: number) => y * 100 + x;
  const goal = key(to[0], to[1]);
  // Distance to the goal over land tiles.
  const distGoal = new Map<number, number>();
  distGoal.set(goal, 0);
  const queue: number[] = [goal];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const cx = cur % 100;
    const cy = Math.floor(cur / 100);
    const d = distGoal.get(cur)!;
    for (const [dx, dy] of DELTAS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx > 23 || ny > 23) continue;
      if (!isLand(island, nx, ny)) continue;
      const nk = key(nx, ny);
      if (distGoal.has(nk)) continue;
      distGoal.set(nk, d + 1);
      queue.push(nk);
    }
  }
  const startKey = key(from[0], from[1]);
  if (!distGoal.has(startKey)) return null;
  const total = distGoal.get(startKey)!;
  const path: [number, number][] = [];
  let cx = from[0];
  let cy = from[1];
  let d = total;
  while (d > 0) {
    let next: [number, number] | null = null;
    for (const [dx, dy] of DELTAS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx > 23 || ny > 23) continue;
      const nd = distGoal.get(key(nx, ny));
      if (nd !== undefined && nd === d - 1) {
        next = [nx, ny];
        break;
      }
    }
    if (!next) return null;
    path.push(next);
    cx = next[0];
    cy = next[1];
    d--;
  }
  return path;
}

const DELTAS: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Next walk step from the current tile towards the goal, one tile per call, honouring gait parity. */
export function nextWalkStep(island: number, from: [number, number], goal: [number, number], isLand: IsLandFn): Heading | null {
  const p = walkPath(island, from, goal, isLand);
  if (!p || p.length === 0) return null;
  const [nx, ny] = p[0];
  const dx = nx - from[0];
  const dy = ny - from[1];
  if (dx === 1) return "E";
  if (dx === -1) return "W";
  if (dy === 1) return "S";
  return "N";
}
