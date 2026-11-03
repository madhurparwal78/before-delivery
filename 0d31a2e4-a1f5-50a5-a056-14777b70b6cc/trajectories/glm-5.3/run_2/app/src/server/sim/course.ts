import type { RoundKind } from "../../shared/domain.js";
import { Rng } from "./rng.js";

export type Sweeper = { x: number; z: number; armLen: number; speed: number; phase: number; knock: number };
export type Platform = { z: number; slideAmp: number; slideSpeed: number; slidePhase: number };
export type Bumper = { x: number; z: number; radius: number; knock: number };

export type Course = {
  kind: RoundKind;
  length: number;
  width: number;
  halfWidth: number;
  sweepers: Sweeper[];
  platforms: Platform[];
  bumpers: Bumper[];
  ringRadius: number;
};

/** Obstacle state at a tick: motion comes only from the tick number, never the wall clock. */
export type ObstacleState = {
  platformXs: number[];
  sweeperAngles: number[];
};

export function generateCourse(kind: RoundKind, seed: number): Course {
  const rng = new Rng(seed);
  if (kind === "survival") return survivalCourse(rng);
  const length = kind === "race" ? rng.int(100, 140) : rng.int(60, 80);
  return linearCourse(kind, rng, length);
}

function linearCourse(kind: RoundKind, rng: Rng, length: number): Course {
  const halfWidth = 5;
  const sweepers: Sweeper[] = [];
  const platforms: Platform[] = [];
  const bumpers: Bumper[] = [];

  for (let z = 16; z < length - 6; z += rng.int(7, 12)) {
    const roll = rng.next();
    if (roll < 0.45) {
      sweepers.push({
        x: rng.range(-1.5, 1.5),
        z,
        armLen: 3.2,
        speed: rng.pick([0.9, 1.15, 1.4]),
        phase: rng.next() * Math.PI * 2,
        knock: 7
      });
    } else if (roll < 0.75) {
      // Bumpers never sit on a straight running lane (x = 3, 1, -1, -3),
      // so a bean that only holds forward always finds a way past.
      bumpers.push({ x: rng.pick([-4.3, -2, 0, 2, 4.3]), z, radius: rng.range(0.4, 0.55), knock: 9 });
    } else {
      platforms.push({
        z,
        slideAmp: rng.range(1.2, 1.8),
        slideSpeed: rng.range(1.4, 2.2),
        slidePhase: rng.next() * Math.PI * 2
      });
    }
  }

  return { kind, length, width: 10, halfWidth, sweepers, platforms, bumpers, ringRadius: 0 };
}

function survivalCourse(rng: Rng): Course {
  const ringRadius = 15;
  // The central sweeper's arms reach across the whole arena, so a bean that
  // stands still is always swept outward and off the edge.
  const sweepers: Sweeper[] = [
    { x: 0, z: 0, armLen: 14.9, speed: rng.pick([0.75, 0.9, 1.05]), phase: rng.next() * Math.PI * 2, knock: 8 }
  ];
  const count = rng.int(1, 3);
  for (let i = 0; i < count; i++) {
    sweepers.push({
      x: rng.range(-3, 3),
      z: rng.range(-3, 3),
      armLen: rng.range(5.5, 7.5),
      speed: rng.pick([1.0, 1.25, 1.5, 1.75]),
      phase: rng.next() * Math.PI * 2,
      knock: 8
    });
  }
  const bumpers: Bumper[] = [];
  for (let i = 0; i < rng.int(2, 4); i++) {
    bumpers.push({ x: rng.range(-5, 5), z: rng.range(-5, 5), radius: rng.range(0.8, 1.1), knock: 3 });
  }
  return { kind: "survival", length: 0, width: ringRadius * 2, halfWidth: ringRadius, sweepers, platforms: [], bumpers, ringRadius };
}

export function obstacleState(course: Course, tick: number): ObstacleState {
  const t = tick / 20;
  return {
    platformXs: course.platforms.map((p) => p.slideAmp * Math.sin(t * p.slideSpeed * Math.PI + p.slidePhase)),
    sweeperAngles: course.sweepers.map((s) => t * s.speed * Math.PI * 2 + s.phase)
  };
}

/** Spawns: race and final in rows of four; survival evenly around an 8 m ring. */
export function spawnPositions(kind: RoundKind, starters: number[]): Map<number, { x: number; z: number }> {
  const spawnXs = [3, 1, -1, -3];
  const ids = [...starters].sort((a, b) => a - b);
  const map = new Map<number, { x: number; z: number }>();
  ids.forEach((id, i) => {
    if (kind === "survival") {
      const angle = (i / ids.length) * Math.PI * 2;
      map.set(id, { x: 8 * Math.cos(angle), z: 8 * Math.sin(angle) });
    } else {
      const row = Math.floor(i / 4);
      const col = i % 4;
      map.set(id, { x: spawnXs[col] as number, z: -2 - row * 2 });
    }
  });
  return map;
}

export function checkpointZ(z: number): number {
  return Math.max(0, Math.floor(z / 25) * 25);
}

export function outsideCourse(kind: RoundKind, course: Course, x: number, z: number): boolean {
  if (kind === "survival") {
    return Math.hypot(x, z) > course.ringRadius;
  }
  return Math.abs(x) > course.halfWidth || z < -8 || z > course.length + 6;
}
