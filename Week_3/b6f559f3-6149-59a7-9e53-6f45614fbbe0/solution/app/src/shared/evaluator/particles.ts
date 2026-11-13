import { glide } from '../easing';
import { FRAMES_PER_SECOND } from '../format';
import type { Vec3 } from '../types';

/** The seeded random source of the brief. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface EmitParams {
  seed: number;
  burst: number;
  rate: number;
  /** Lifetime in steps. */
  lifeSteps: number;
  speed: number;
  gravity: number;
  orbit: number;
  attractor: Vec3;
  strength: number;
  trailLength: number;
  particleMax: number;
}

export interface Particle {
  number: number;
  born: number;
  position: Vec3;
  velocity: Vec3;
  /** Last positions, newest last, as many as the trail length. */
  trail: Vec3[];
}

export interface ParticleField {
  /** Particles alive at the frame, in number order. */
  live: Particle[];
}

interface Simulation {
  frame: number;
  live: Particle[];
  next: number;
  random: () => number;
}

const DT = 1 / FRAMES_PER_SECOND;
const cache = new Map<string, Simulation>();

function spawn(sim: Simulation, params: EmitParams, step: number): void {
  if (sim.live.length + 1 > params.particleMax) return;
  const u1 = sim.random();
  const u2 = sim.random();
  const u3 = sim.random();
  const position = { x: 0, y: 0, z: 0 };
  sim.live.push({
    number: sim.next++,
    born: step,
    position,
    velocity: { x: (2 * u1 - 1) * params.speed, y: (2 * u2 - 1) * params.speed, z: (2 * u3 - 1) * params.speed },
    trail: params.trailLength > 0 ? [{ ...position }] : [],
  });
}

function advance(sim: Simulation, params: EmitParams, step: number): void {
  const theta = (params.orbit * DT * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  for (const particle of sim.live) {
    const { position: p, velocity: v } = particle;
    const ax = params.strength * (params.attractor.x - p.x);
    const ay = -params.gravity + params.strength * (params.attractor.y - p.y);
    const az = params.strength * (params.attractor.z - p.z);
    v.x += ax * DT;
    v.y += ay * DT;
    v.z += az * DT;
    p.x += v.x * DT;
    p.y += v.y * DT;
    p.z += v.z * DT;
    const x = p.x;
    const z = p.z;
    p.x = x * cos + z * sin;
    p.z = -x * sin + z * cos;
    if (params.trailLength > 0) {
      particle.trail.push({ ...p });
      if (particle.trail.length > params.trailLength) particle.trail.shift();
    }
  }
  sim.live = sim.live.filter((particle) => step < particle.born + params.lifeSteps);
  const births = Math.floor((params.rate * step) / FRAMES_PER_SECOND) - Math.floor((params.rate * (step - 1)) / FRAMES_PER_SECOND);
  for (let i = 0; i < births; i++) spawn(sim, params, step);
}

/** Emitter state at `frame`, simulated one fixed step per frame from step 0. */
export function emitAt(params: EmitParams, frame: number): ParticleField {
  const key = JSON.stringify(params);
  let sim = cache.get(key);
  if (!sim || sim.frame > frame) {
    sim = { frame: 0, live: [], next: 1, random: mulberry32(params.seed) };
    for (let i = 0; i < params.burst; i++) spawn(sim, params, 0);
    if (cache.size > 24) cache.clear();
    cache.set(key, sim);
  }
  while (sim.frame < frame) {
    sim.frame += 1;
    advance(sim, params, sim.frame);
  }
  return { live: sim.live };
}

interface FormParams {
  seed: number;
  count: number;
  durationMs: number;
  trailLength: number;
}

const startCache = new Map<string, Vec3[]>();

function startPoints(seed: number, count: number): Vec3[] {
  const key = `${seed}:${count}`;
  let points = startCache.get(key);
  if (!points) {
    const random = mulberry32(seed);
    points = Array.from({ length: count }, () => ({ x: 4 * random() - 2, y: 4 * random() - 2, z: 4 * random() - 2 }));
    if (startCache.size > 24) startCache.clear();
    startCache.set(key, points);
  }
  return points;
}

/** Particles forming into `targets`: all alive from frame 0, easing from their start points with Glide. */
export function formAt(params: FormParams, targets: readonly Vec3[], frame: number): ParticleField {
  const starts = startPoints(params.seed, params.count);
  const elapsed = (frame * 1000) / FRAMES_PER_SECOND;
  const progress = elapsed >= params.durationMs ? 1 : glide(elapsed / params.durationMs);
  const live = starts.map((start, index): Particle => {
    const target = targets.length === 0 ? start : (targets[index % targets.length] as Vec3);
    return {
      number: index + 1,
      born: 0,
      position: {
        x: start.x + (target.x - start.x) * progress,
        y: start.y + (target.y - start.y) * progress,
        z: start.z + (target.z - start.z) * progress,
      },
      velocity: { x: 0, y: 0, z: 0 },
      trail: [],
    };
  });
  return { live };
}
