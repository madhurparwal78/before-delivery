import { HEADING_DELTA, type Heading, type Tile } from './islands.js';

export type Gait = 'idle' | 'walk' | 'run' | 'jump';
export type LandTest = (x: number, y: number) => boolean;

export const STEP_MS = 100;
export const JUMP_STEPS = 4;

/** The published shortest-path rule, with north, east, south, west as the tie break. */
export function shortestPath(isLandAt: LandTest, from: Tile, to: Tile, size: number): Tile[] | null {
  if (!isLandAt(to.x, to.y) || !isLandAt(from.x, from.y)) return null;
  const distance = new Map<string, number>();
  const key = (x: number, y: number) => `${x},${y}`;
  distance.set(key(to.x, to.y), 0);
  let frontier: Tile[] = [to];
  while (frontier.length > 0) {
    const next: Tile[] = [];
    for (const tile of frontier) {
      const d = distance.get(key(tile.x, tile.y))!;
      for (const heading of ORDER) {
        const { dx, dy } = HEADING_DELTA[heading];
        const nx = tile.x + dx;
        const ny = tile.y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        if (!isLandAt(nx, ny)) continue;
        if (distance.has(key(nx, ny))) continue;
        distance.set(key(nx, ny), d + 1);
        next.push({ x: nx, y: ny });
      }
    }
    frontier = next;
  }
  const total = distance.get(key(from.x, from.y));
  if (total === undefined) return null;
  const path: Tile[] = [];
  let current = from;
  let remaining = total;
  while (remaining > 0) {
    let chosen: Tile | null = null;
    for (const heading of ORDER) {
      const { dx, dy } = HEADING_DELTA[heading];
      const candidate = { x: current.x + dx, y: current.y + dy };
      if (distance.get(key(candidate.x, candidate.y)) === remaining - 1) {
        chosen = candidate;
        break;
      }
    }
    if (!chosen) return null;
    path.push(chosen);
    current = chosen;
    remaining -= 1;
  }
  return path;
}

const ORDER: ReadonlyArray<Heading> = ['N', 'E', 'S', 'W'];

export type StepInput = { direction: Heading | null; running: boolean };

/**
 * The published movement rule in fixed 100 ms steps: turning, walking, running, jumping and
 * walking a requested path all happen here.
 */
export class Walker {
  tile: Tile;
  heading: Heading;
  gait: Gait = 'idle';
  step = 0;

  private heldDirection: Heading | null = null;
  private heldSteps = 0;
  private jumpSteps = 0;
  private jumpFrom: Tile | null = null;
  private jumpPending = false;
  private path: Tile[] | null = null;
  private pathSteps = 0;

  constructor(
    private readonly isLandAt: LandTest,
    tile: Tile,
    heading: Heading,
  ) {
    this.tile = tile;
    this.heading = heading;
  }

  get walkingPath(): boolean {
    return this.path !== null;
  }

  requestJump(): void {
    if (this.jumpSteps > 0) return;
    this.jumpPending = true;
    this.path = null;
    this.pathSteps = 0;
  }

  requestPath(path: Tile[]): void {
    if (path.length === 0) return;
    this.path = path;
    this.pathSteps = 0;
  }

  stopPath(): void {
    this.path = null;
    this.pathSteps = 0;
  }

  teleport(tile: Tile, heading: Heading): void {
    this.tile = tile;
    this.heading = heading;
    this.gait = 'idle';
    this.path = null;
    this.pathSteps = 0;
    this.jumpSteps = 0;
    this.jumpPending = false;
    this.heldDirection = null;
    this.heldSteps = 0;
  }

  /** Runs one 100 ms step and reports whether the tile changed. */
  advance(input: StepInput): boolean {
    this.step += 1;
    const before = this.tile;

    if (this.jumpPending) {
      this.jumpPending = false;
      this.jumpSteps = 0;
      this.jumpFrom = this.tile;
    } else if (this.jumpSteps === 0 && input.direction !== null) {
      this.path = null;
      this.pathSteps = 0;
    }

    if (this.jumpFrom !== null) {
      this.jumpSteps += 1;
      this.gait = 'jump';
      if (this.jumpSteps >= JUMP_STEPS) {
        const { dx, dy } = HEADING_DELTA[this.heading];
        const target = { x: this.jumpFrom.x + dx * 2, y: this.jumpFrom.y + dy * 2 };
        this.tile = this.isLandAt(target.x, target.y) ? target : this.jumpFrom;
        this.jumpFrom = null;
        this.jumpSteps = 0;
      }
      return this.tile !== before;
    }

    if (input.direction !== null) {
      if (input.direction !== this.heldDirection) {
        this.heldDirection = input.direction;
        this.heldSteps = 0;
      }
      this.heldSteps += 1;
      this.heading = input.direction;
      this.gait = input.running ? 'run' : 'walk';
      if (input.running || this.heldSteps % 2 === 1) {
        const { dx, dy } = HEADING_DELTA[this.heading];
        const target = { x: this.tile.x + dx, y: this.tile.y + dy };
        if (this.isLandAt(target.x, target.y)) this.tile = target;
      }
      return this.tile !== before;
    }

    this.heldDirection = null;
    this.heldSteps = 0;

    if (this.path !== null) {
      this.pathSteps += 1;
      this.gait = input.running ? 'run' : 'walk';
      if (input.running || this.pathSteps % 2 === 1) {
        const next = this.path[0];
        this.heading = headingTowards(this.tile, next);
        if (this.isLandAt(next.x, next.y)) this.tile = next;
        this.path.shift();
        if (this.path.length === 0) {
          this.path = null;
          this.pathSteps = 0;
        }
      }
      return this.tile !== before;
    }

    this.gait = 'idle';
    return false;
  }
}

export function headingTowards(from: Tile, to: Tile): Heading {
  if (to.x > from.x) return 'E';
  if (to.x < from.x) return 'W';
  if (to.y > from.y) return 'S';
  return 'N';
}
