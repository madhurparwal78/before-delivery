// Fixed-step cloth simulation, exactly as published.
import { mulberry32 } from './random';

export interface ClothConfig {
  columns: number;
  rows: number;
  pinned: 'Top' | 'Left' | 'Corners' | 'None';
  gravity: number;
  windStrength: number;
  windDirection: number;
  stiffness: number;
  damping: number;
  iterations: number;
  seed: number;
}

export interface ClothPoint {
  name: string;
  p: { x: number; y: number; z: number };
  prev: { x: number; y: number; z: number };
  pinned: boolean;
}

export function clothRest(cfg: ClothConfig): ClothPoint[] {
  const rnd = mulberry32(cfg.seed);
  const points: ClothPoint[] = [];
  const C = cfg.columns;
  const R = cfg.rows;
  for (let r = 1; r <= R; r++) {
    for (let c = 1; c <= C; c++) {
      const u = rnd();
      const x = (c - 1 - (C - 1) / 2) * 0.1;
      const y = -(r - 1) * 0.1;
      const z = (u - 0.5) * 0.002;
      points.push({
        name: `R${r} C${c}`,
        p: { x, y, z },
        prev: { x, y, z },
        pinned: isPinned(cfg.pinned, r, c, R, C),
      });
    }
  }
  return points;
}

function isPinned(
  pinned: ClothConfig['pinned'],
  r: number,
  c: number,
  R: number,
  C: number,
): boolean {
  switch (pinned) {
    case 'Top':
      return r === 1;
    case 'Left':
      return c === 1;
    case 'Corners':
      return (r === 1 && c === 1) || (r === 1 && c === C);
    case 'None':
      return false;
  }
  void R;
  return false;
}

export function simulateCloth(cfg: ClothConfig, frame: number): ClothPoint[] {
  const points = clothRest(cfg);
  const dt = 1 / 60;
  const C = cfg.columns;
  const R = cfg.rows;
  const at = (r: number, c: number): ClothPoint => points[(r - 1) * C + (c - 1)];
  const phi = (cfg.windDirection * Math.PI) / 180;
  const ax = cfg.windStrength * Math.cos(phi);
  const az = cfg.windStrength * Math.sin(phi);
  const ay = -cfg.gravity;
  for (let step = 1; step <= frame; step++) {
    // 1. Verlet integration, row-major order
    for (let r = 1; r <= R; r++) {
      for (let c = 1; c <= C; c++) {
        const pt = at(r, c);
        if (pt.pinned) continue;
        const vx = (pt.p.x - pt.prev.x) * (1 - cfg.damping);
        const vy = (pt.p.y - pt.prev.y) * (1 - cfg.damping);
        const vz = (pt.p.z - pt.prev.z) * (1 - cfg.damping);
        pt.prev = { ...pt.p };
        pt.p = {
          x: pt.p.x + vx + ax * dt * dt,
          y: pt.p.y + vy + ay * dt * dt,
          z: pt.p.z + vz + az * dt * dt,
        };
      }
    }
    // 2. constraint iterations
    for (let it = 0; it < cfg.iterations; it++) {
      for (let r = 1; r <= R; r++) {
        for (let c = 1; c <= C; c++) {
          const p1 = at(r, c);
          if (c < C) solve(p1, at(r, c + 1), cfg.stiffness);
          if (r < R) solve(p1, at(r + 1, c), cfg.stiffness);
        }
      }
    }
  }
  return points;
}

function solve(p1: ClothPoint, p2: ClothPoint, stiffness: number): void {
  const dx = p2.p.x - p1.p.x;
  const dy = p2.p.y - p1.p.y;
  const dz = p2.p.z - p1.p.z;
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (L === 0) return;
  const diff = ((L - 0.1) / L) * stiffness;
  const fdx = dx * diff;
  const fdy = dy * diff;
  const fdz = dz * diff;
  if (!p1.pinned && !p2.pinned) {
    p1.p = { x: p1.p.x + fdx / 2, y: p1.p.y + fdy / 2, z: p1.p.z + fdz / 2 };
    p2.p = { x: p2.p.x - fdx / 2, y: p2.p.y - fdy / 2, z: p2.p.z - fdz / 2 };
  } else if (!p1.pinned && p2.pinned) {
    p1.p = { x: p1.p.x + fdx, y: p1.p.y + fdy, z: p1.p.z + fdz };
  } else if (p1.pinned && !p2.pinned) {
    p2.p = { x: p2.p.x - fdx, y: p2.p.y - fdy, z: p2.p.z - fdz };
  }
}
