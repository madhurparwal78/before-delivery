// Course generation: every course, and all obstacle motion, comes only from the round's seed and the tick.
import type { RoundKind } from "./rules.js";

interface FloorRect {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

interface MovingPlatform {
  zMin: number;
  zMax: number;
  halfWidth: number;
  amplitude: number;
  periodTicks: number;
  phase: number;
}

export interface Sweeper {
  x: number;
  z: number;
  radius: number;
  arms: number;
  radiansPerTick: number;
  phase: number;
}

interface Bumper {
  x: number;
  z: number;
  radius: number;
}

export interface Course {
  kind: RoundKind;
  seed: number;
  finishZ: number;
  arenaRadius: number;
  floors: FloorRect[];
  platforms: MovingPlatform[];
  sweepers: Sweeper[];
  bumpers: Bumper[];
  checkpoints: number[];
}

export const COURSE_HALF_WIDTH = 5;
const ARENA_RADIUS = 15;
export const SWEEPER_TOP = 0.9;
export const SWEEPER_HALF_THICKNESS = 0.35;
export const BUMPER_HEIGHT = 1.2;
export const CHECKPOINT_SPACING = 25;
const START_FLOOR_Z = -8;
const CLEAR_UNTIL_Z = 10;
const FINISH_RUNOFF = 6;

// mulberry32: a small, well-mixed 32-bit generator.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function between(random: () => number, low: number, high: number): number {
  return low + random() * (high - low);
}

export function platformX(platform: MovingPlatform, tick: number): number {
  return platform.amplitude * Math.sin((2 * Math.PI * tick) / platform.periodTicks + platform.phase);
}

export function sweeperAngle(sweeper: Sweeper, tick: number): number {
  return sweeper.phase + sweeper.radiansPerTick * tick;
}

export function generateCourse(kind: RoundKind, seed: number): Course {
  const random = seededRandom(seed);
  if (kind === "survival") return survivalArena(seed, random);
  return linearCourse(kind, seed, random);
}

function survivalArena(seed: number, random: () => number): Course {
  const direction = random() < 0.5 ? -1 : 1;
  return {
    kind: "survival",
    seed,
    finishZ: 0,
    arenaRadius: ARENA_RADIUS,
    floors: [],
    platforms: [],
    sweepers: [
      {
        x: 0,
        z: 0,
        radius: ARENA_RADIUS,
        arms: 2,
        radiansPerTick: (direction * (2 * Math.PI)) / (20 * between(random, 6, 9)),
        phase: between(random, 0, 2 * Math.PI),
      },
    ],
    bumpers: [],
    checkpoints: [],
  };
}

type Section = "sweeper" | "bumpers" | "gap";

function linearCourse(kind: RoundKind, seed: number, random: () => number): Course {
  const finishZ = Math.round((kind === "race" ? between(random, 100, 140) : between(random, 60, 80)) * 10) / 10;
  const checkpoints: number[] = [];
  for (let z = 0; z < finishZ; z += CHECKPOINT_SPACING) checkpoints.push(z);
  const maxGaps = kind === "race" ? 2 : 1;
  const floors: FloorRect[] = [];
  const platforms: MovingPlatform[] = [];
  const sweepers: Sweeper[] = [];
  const bumpers: Bumper[] = [];
  let floorStart = START_FLOOR_Z;
  let cursor = CLEAR_UNTIL_Z + between(random, 2, 4);
  let gaps = 0;
  while (cursor < finishZ - 10) {
    const options: Section[] = ["sweeper", "bumpers"];
    const gapLength = Math.round(between(random, 3.5, 5.5) * 10) / 10;
    const nearCheckpoint = checkpoints.some((c) => c > cursor - 2.5 && c < cursor + gapLength + 2.5);
    if (gaps < maxGaps && !nearCheckpoint) options.push("gap");
    const section = options[Math.floor(random() * options.length)] ?? "bumpers";
    if (section === "sweeper") {
      const radius = between(random, 3.6, 4.6);
      sweepers.push({
        x: 0,
        z: cursor + radius,
        radius,
        arms: 1,
        radiansPerTick: ((random() < 0.5 ? -1 : 1) * (2 * Math.PI)) / (20 * between(random, 4, 6)),
        phase: between(random, 0, 2 * Math.PI),
      });
      cursor += 2 * radius + between(random, 1.5, 3.5);
    } else if (section === "bumpers") {
      const rows = 2 + Math.floor(random() * 2);
      for (let row = 0; row < rows; row++) {
        const z = cursor + row * 3;
        const side = row % 2 === 0 ? 1 : -1;
        bumpers.push({ x: side * between(random, 1.7, 3.2), z, radius: 0.7 });
        if (random() < 0.5) bumpers.push({ x: -side * between(random, 1.7, 3.2), z, radius: 0.7 });
      }
      cursor += rows * 3 + between(random, 1.5, 3.5);
    } else {
      floors.push({ xMin: -COURSE_HALF_WIDTH, xMax: COURSE_HALF_WIDTH, zMin: floorStart, zMax: cursor });
      platforms.push({
        zMin: cursor - 0.2,
        zMax: cursor + gapLength + 0.2,
        halfWidth: 4,
        amplitude: 1,
        periodTicks: Math.round(between(random, 60, 100)),
        phase: between(random, 0, 2 * Math.PI),
      });
      floorStart = cursor + gapLength;
      cursor = floorStart + between(random, 3, 5);
      gaps += 1;
    }
  }
  floors.push({ xMin: -COURSE_HALF_WIDTH, xMax: COURSE_HALF_WIDTH, zMin: floorStart, zMax: finishZ + FINISH_RUNOFF });
  return { kind, seed, finishZ, arenaRadius: 0, floors, platforms, sweepers, bumpers, checkpoints };
}

// Whether the floor, or a moving platform where it is on that tick, holds a point at (x, z).
export function supportAt(course: Course, x: number, z: number, tick: number): boolean {
  if (course.kind === "survival") return x * x + z * z <= course.arenaRadius * course.arenaRadius;
  return course.floors.some((floor) => x >= floor.xMin && x <= floor.xMax && z >= floor.zMin && z <= floor.zMax)
    || course.platforms.some((platform) => z >= platform.zMin && z <= platform.zMax
      && Math.abs(x - platformX(platform, tick)) <= platform.halfWidth);
}
