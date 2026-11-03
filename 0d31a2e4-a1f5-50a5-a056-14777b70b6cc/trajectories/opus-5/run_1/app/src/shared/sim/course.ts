import { TICK_RATE } from '../rounds.js';
import type { RoundKind } from '../types.js';

export const COURSE_HALF_WIDTH = 5;
export const ARENA_RADIUS = 15;
export const CHECKPOINT_SPACING = 25;
export const SPAWN_RING_RADIUS = 8;
export const OBSTACLE_FREE_Z = 10;

/** A spinning sweeper: a double bar turning about its post. */
export interface Sweeper {
  x: number;
  z: number;
  arm: number;
  omega: number;
  phase: number;
  height: number;
}

/** A bumper post that knocks beans back. */
export interface Bumper {
  x: number;
  z: number;
  radius: number;
  height: number;
}

/** A platform sliding along x that beans ride. */
export interface Platform {
  z: number;
  amplitude: number;
  omega: number;
  phase: number;
  halfX: number;
  halfZ: number;
  top: number;
}

/** A sweeper bar turning about the centre of the survival arena. */
export interface ArenaBar {
  inner: number;
  outer: number;
  omega: number;
  phase: number;
  height: number;
}

export interface LinearCourse {
  shape: 'linear';
  kind: 'race' | 'final';
  length: number;
  halfWidth: number;
  startZ: number;
  endZ: number;
  checkpoints: number[];
  sweepers: Sweeper[];
  bumpers: Bumper[];
  platforms: Platform[];
}

export interface ArenaCourse {
  shape: 'arena';
  kind: 'survival';
  radius: number;
  bars: ArenaBar[];
}

export type Course = LinearCourse | ArenaCourse;

/** Deterministic 32-bit PRNG: the course layout comes only from the round's seed. */
function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildLinearCourse(kind: 'race' | 'final', seed: number): LinearCourse {
  const random = seededRandom(seed);
  const span = kind === 'race' ? 40 : 20;
  const base = kind === 'race' ? 100 : 60;
  const length = base + Math.floor(random() * (span + 1));
  const sweepers: Sweeper[] = [];
  const bumpers: Bumper[] = [];
  const platforms: Platform[] = [];
  const checkpoints: number[] = [0];
  for (let c = CHECKPOINT_SPACING; c < length; c += CHECKPOINT_SPACING) checkpoints.push(c);

  let z = OBSTACLE_FREE_Z + 4 + random() * 4;
  let slot = Math.floor(random() * 3);
  while (z < length - 8) {
    const pick = slot % 3;
    if (pick === 0) {
      sweepers.push({
        x: (random() * 2 - 1) * 2,
        z,
        arm: 2.6 + random() * 0.8,
        omega: (1 + random() * 0.8) * (random() < 0.5 ? -1 : 1),
        phase: random() * Math.PI * 2,
        height: 1.4,
      });
    } else if (pick === 1) {
      const posts = 2 + Math.floor(random() * 2);
      const offset = (random() * 2 - 1) * 0.8;
      for (let p = 0; p < posts; p += 1) {
        bumpers.push({
          x: Math.max(-2.4, Math.min(2.4, offset + (p - (posts - 1) / 2) * 3.2)),
          z: z + (p % 2) * 1.6,
          radius: 0.9,
          height: 1.6,
        });
      }
    } else {
      platforms.push({
        z,
        amplitude: 1.2 + random() * 1,
        omega: (0.6 + random() * 0.6) * (random() < 0.5 ? -1 : 1),
        phase: random() * Math.PI * 2,
        halfX: 1.6,
        halfZ: 1.3,
        top: 1.2,
      });
    }
    slot += 1;
    z += 11 + random() * 6;
  }

  return {
    shape: 'linear',
    kind,
    length,
    halfWidth: COURSE_HALF_WIDTH,
    startZ: -8,
    endZ: length + 6,
    checkpoints,
    sweepers,
    bumpers,
    platforms,
  };
}

function buildArenaCourse(seed: number): ArenaCourse {
  const random = seededRandom(seed);
  const barCount = 3;
  const omega = (1.2 + random() * 0.5) * (random() < 0.5 ? -1 : 1);
  const phase = random() * Math.PI * 2;
  const bars: ArenaBar[] = [];
  for (let i = 0; i < barCount; i += 1) {
    bars.push({
      inner: 1.5,
      outer: ARENA_RADIUS,
      omega,
      phase: phase + (i * Math.PI * 2) / barCount,
      height: 1.2,
    });
  }
  return { shape: 'arena', kind: 'survival', radius: ARENA_RADIUS, bars };
}

export function buildCourse(kind: RoundKind, seed: number): Course {
  return kind === 'survival' ? buildArenaCourse(seed) : buildLinearCourse(kind, seed);
}

/** A sweeper's bar angle at a tick. Obstacle motion comes only from the tick number. */
export function sweeperAngle(sweeper: Sweeper, tick: number): number {
  return sweeper.phase + (sweeper.omega * tick) / TICK_RATE;
}

export function barAngle(bar: ArenaBar, tick: number): number {
  return bar.phase + (bar.omega * tick) / TICK_RATE;
}

export function platformX(platform: Platform, tick: number): number {
  return platform.amplitude * Math.sin(platform.phase + (platform.omega * tick) / TICK_RATE);
}

/** Spawn positions, in the starters' ascending id order. */
export function spawnPosition(
  course: Course,
  index: number,
  total: number,
): { x: number; y: number; z: number } {
  if (course.shape === 'arena') {
    const angle = (index / Math.max(1, total)) * Math.PI * 2;
    return {
      x: SPAWN_RING_RADIUS * Math.cos(angle),
      y: 0,
      z: SPAWN_RING_RADIUS * Math.sin(angle),
    };
  }
  const columns = [3, 1, -1, -3];
  const rows = [-2, -4, -6];
  const column = columns[index % 4] ?? 0;
  const row = rows[Math.floor(index / 4) % 3] ?? -2;
  return { x: column, y: 0, z: row };
}
