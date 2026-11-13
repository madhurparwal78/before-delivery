// Particle simulation and formation, exactly as published.
import { mulberry32 } from './random';
import type { Vec3 } from './types';

export interface ParticleState {
  number: number;
  p: Vec3;
  v: Vec3;
  birthStep: number;
}

export interface EmitterConfig {
  seed: number;
  rate: number;
  burst: number;
  lifetime: number;
  speed: number;
  gravity: number;
  trailLength: number;
  orbit: number;
  attractor: Vec3 & { strength: number };
  particleMax: number;
}

export interface EmitSimResult {
  particles: ParticleState[];
  liveCount: number;
  trails: Map<number, Vec3[]>;
}

// Runs steps 1..frame (step 0 is time 0; the burst spawns at step 0).
export function simulateEmit(cfg: EmitterConfig, frame: number): EmitSimResult {
  const rnd = mulberry32(cfg.seed);
  const particles: ParticleState[] = [];
  const trails = new Map<number, Vec3[]>();
  const dt = 1 / 60;
  const bornAt = new Map<number, number>();
  const nextNumber = { n: 1 };

  const spawn = (step: number, count: number): void => {
    for (let c = 0; c < count; c++) {
      if (particles.length >= cfg.particleMax) return;
      const u1 = rnd();
      const u2 = rnd();
      const u3 = rnd();
      const n = nextNumber.n++;
      particles.push({
        number: n,
        p: { x: 0, y: 0, z: 0 },
        v: {
          x: (2 * u1 - 1) * cfg.speed,
          y: (2 * u2 - 1) * cfg.speed,
          z: (2 * u3 - 1) * cfg.speed,
        },
        birthStep: step,
      });
      bornAt.set(n, step);
      trails.set(n, [{ x: 0, y: 0, z: 0 }]);
    }
  };

  spawn(0, cfg.burst);

  for (let k = 1; k <= frame; k++) {
    // 1. move every live particle in number order
    for (const pt of particles) {
      const a = {
        x: cfg.attractor.strength * (cfg.attractor.x - pt.p.x),
        y: -cfg.gravity + cfg.attractor.strength * (cfg.attractor.y - pt.p.y),
        z: cfg.attractor.strength * (cfg.attractor.z - pt.p.z),
      };
      pt.v = { x: pt.v.x + a.x * dt, y: pt.v.y + a.y * dt, z: pt.v.z + a.z * dt };
      pt.p = { x: pt.p.x + pt.v.x * dt, y: pt.p.y + pt.v.y * dt, z: pt.p.z + pt.v.z * dt };
      const theta = cfg.orbit * dt * (Math.PI / 180);
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const nx = pt.p.x * c + pt.p.z * s;
      const nz = -pt.p.x * s + pt.p.z * c;
      pt.p = { x: nx, y: pt.p.y, z: nz };
      const tr = trails.get(pt.number);
      if (tr) {
        tr.push({ ...pt.p });
        if (tr.length > cfg.trailLength + 1) tr.splice(0, tr.length - (cfg.trailLength + 1));
      }
    }
    // 2. a particle born at step b is removed after step b + round(lifetime*60)
    const lifeSteps = Math.round(cfg.lifetime * 60);
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      if (k >= pt.birthStep + lifeSteps) {
        particles.splice(i, 1);
      }
    }
    // 3. spawn
    const newCount = Math.floor((cfg.rate * k) / 60) - Math.floor((cfg.rate * (k - 1)) / 60);
    if (newCount > 0) spawn(k, newCount);
  }

  return { particles, liveCount: particles.length, trails };
}

// Particle at a frame, by number, for the readout.
export function particleAt(sim: EmitSimResult, n: number, frame: number): Vec3 | null {
  const pt = sim.particles.find((p) => p.number === n);
  if (!pt) return null;
  void frame;
  return pt.p;
}

// --- Formation ----------------------------------------------------------

export interface FormationConfig {
  seed: number;
  count: number;
  durationMs: number;
  targets: Vec3[];
}

export interface FormResult {
  positions: { n: number; p: Vec3; resting: boolean }[];
}

export function simulateForm(cfg: FormationConfig, frame: number): FormResult {
  const rnd = mulberry32(cfg.seed);
  const targets = cfg.targets;
  const V = targets.length;
  const t = (frame * 1000) / 60;
  const out: { n: number; p: Vec3; resting: boolean }[] = [];
  for (let i = 1; i <= cfg.count; i++) {
    const u1 = rnd();
    const u2 = rnd();
    const u3 = rnd();
    const start = { x: 4 * u1 - 2, y: 4 * u2 - 2, z: 4 * u3 - 2 };
    const target = targets[(i - 1) % V];
    const progress = glideEase(Math.min(1, t / cfg.durationMs));
    const p = {
      x: start.x + (target.x - start.x) * progress,
      y: start.y + (target.y - start.y) * progress,
      z: start.z + (target.z - start.z) * progress,
    };
    out.push({ n: i, p, resting: t >= cfg.durationMs });
  }
  return { positions: out };
}

function glideEase(t: number): number {
  // Glide preset bezier
  const x1 = 0.22, y1 = 1, x2 = 0.36, y2 = 1;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const cx = (tt: number) => {
    const u = 1 - tt;
    return 3 * u * u * tt * x1 + 3 * u * tt * tt * x2 + tt * tt * tt;
  };
  const cy = (tt: number) => {
    const u = 1 - tt;
    return 3 * u * u * tt * y1 + 3 * u * tt * tt * y2 + tt * tt * tt;
  };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (cx(mid) < t) lo = mid;
    else hi = mid;
  }
  return cy((lo + hi) / 2);
}
