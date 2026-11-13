import { ease } from './easing';
import type { Vec3 } from './types';
import { vec } from './math3d';

/** Seeded random source shared by every seeded simulation. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ParticleSettings {
  seed: number;
  rate: number;
  burst: number;
  lifetime: number;
  speed: number;
  gravity: number;
  trailLength: number;
  orbit: number;
  attractor: { x: number; y: number; z: number; strength: number };
}

export interface FormationSettings {
  seed: number;
  count: number;
  durationMs: number;
  targets: Vec3[];
}

export interface LiveParticle {
  number: number;
  position: Vec3;
  velocity: Vec3;
  bornStep: number;
  trail: Vec3[];
}

const DT = 1 / 60;

export function simulateEmitter(
  settings: ParticleSettings,
  frame: number,
  particleMax: number,
): LiveParticle[] {
  const random = mulberry32(settings.seed);
  let nextNumber = 1;
  let live: LiveParticle[] = [];
  const lifeSteps = Math.round(settings.lifetime * 60);
  const trailLength = Math.max(0, Math.round(settings.trailLength));

  const spawn = (step: number, count: number): void => {
    for (let i = 0; i < count; i += 1) {
      if (live.length + 1 > particleMax) continue;
      const u1 = random();
      const u2 = random();
      const u3 = random();
      const particle: LiveParticle = {
        number: nextNumber,
        position: vec(0, 0, 0),
        velocity: vec(
          (2 * u1 - 1) * settings.speed,
          (2 * u2 - 1) * settings.speed,
          (2 * u3 - 1) * settings.speed,
        ),
        bornStep: step,
        trail: [vec(0, 0, 0)],
      };
      nextNumber += 1;
      live.push(particle);
    }
  };

  spawn(0, Math.round(settings.burst));

  const theta = (settings.orbit * DT * Math.PI) / 180;
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);

  for (let step = 1; step <= frame; step += 1) {
    for (const particle of live) {
      const ax =
        settings.attractor.strength * (settings.attractor.x - particle.position.x);
      const ay =
        -settings.gravity + settings.attractor.strength * (settings.attractor.y - particle.position.y);
      const az =
        settings.attractor.strength * (settings.attractor.z - particle.position.z);
      particle.velocity = vec(
        particle.velocity.x + ax * DT,
        particle.velocity.y + ay * DT,
        particle.velocity.z + az * DT,
      );
      let x = particle.position.x + particle.velocity.x * DT;
      const y = particle.position.y + particle.velocity.y * DT;
      let z = particle.position.z + particle.velocity.z * DT;
      if (settings.orbit !== 0) {
        const rotatedX = x * cosTheta + z * sinTheta;
        const rotatedZ = -x * sinTheta + z * cosTheta;
        x = rotatedX;
        z = rotatedZ;
      }
      particle.position = vec(x, y, z);
      if (trailLength > 0) {
        particle.trail.push(particle.position);
        if (particle.trail.length > trailLength) particle.trail.shift();
      }
    }
    live = live.filter((particle) => step - particle.bornStep < lifeSteps);
    const spawnCount =
      Math.floor((settings.rate * step) / 60) - Math.floor((settings.rate * (step - 1)) / 60);
    spawn(step, spawnCount);
  }

  return live;
}

export function trailPointCount(trailLength: number, stepsSinceBirth: number): number {
  return Math.min(Math.max(0, Math.round(trailLength)), stepsSinceBirth + 1);
}

export function formationStartPoints(settings: FormationSettings): Vec3[] {
  const random = mulberry32(settings.seed);
  const points: Vec3[] = [];
  for (let i = 0; i < settings.count; i += 1) {
    const u1 = random();
    const u2 = random();
    const u3 = random();
    points.push(vec(4 * u1 - 2, 4 * u2 - 2, 4 * u3 - 2));
  }
  return points;
}

export function formationPositions(settings: FormationSettings, frame: number): Vec3[] {
  const starts = formationStartPoints(settings);
  const targetCount = settings.targets.length;
  const elapsedMs = (frame * 1000) / 60;
  const progress =
    settings.durationMs <= 0 ? 1 : ease('glide', Math.min(1, elapsedMs / settings.durationMs));
  return starts.map((start, index) => {
    if (targetCount === 0) return start;
    const target = settings.targets[index % targetCount];
    return vec(
      start.x + (target.x - start.x) * progress,
      start.y + (target.y - start.y) * progress,
      start.z + (target.z - start.z) * progress,
    );
  });
}
