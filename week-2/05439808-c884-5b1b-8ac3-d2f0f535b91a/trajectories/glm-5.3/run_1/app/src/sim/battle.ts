// The Saltreach battle rules. This module is shared by the server's raid resolution and the
// browser's replay and preview (DP-82). It is pure TypeScript: no platform APIs.
// All quantities are integers; positions are thousandths of a cell; one tick is a tenth of a second.

import { BUILDINGS, UNITS } from '../domain/catalog.ts';
import type { BattleResult, DeployEntry, LayoutBuilding, ResourceAmounts, TickState } from '../domain/types.ts';

export class XorShift32 {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  draw(): number {
    let s = this.state;
    s ^= (s << 13) >>> 0;
    s ^= s >>> 17;
    s ^= (s << 5) >>> 0;
    this.state = s >>> 0;
    return this.state;
  }
}

export function fnv1a32(values: number[]): string {
  let hash = 2166136261 >>> 0;
  for (const value of values) {
    const v = value | 0;
    hash ^= v & 0xff;
    hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (v >>> 8) & 0xff;
    hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (v >>> 16) & 0xff;
    hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (v >>> 24) & 0xff;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function footprint(building: LayoutBuilding): { x0: number; y0: number; x1: number; y1: number } {
  const { width, depth } = BUILDINGS[building.type];
  const rotated = building.rotation === 90 || building.rotation === 270 ? { w: depth, d: width } : { w: width, d: depth };
  return {
    x0: building.x * 1000,
    y0: building.y * 1000,
    x1: (building.x + rotated.w) * 1000,
    y1: (building.y + rotated.d) * 1000,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Nearest point of the footprint rectangle to a point.
function nearestPoint(px: number, py: number, building: LayoutBuilding): { x: number; y: number } {
  const f = footprint(building);
  return { x: clamp(px, f.x0, f.x1), y: clamp(py, f.y0, f.y1) };
}

function distSquared(px: number, py: number, qx: number, qy: number): number {
  const dx = px - qx;
  const dy = py - qy;
  return dx * dx + dy * dy;
}

interface SimBuilding {
  layout: LayoutBuilding;
  hp: number;
  destroyed: boolean;
  cooldown: number;
}

interface SimUnit {
  index: number;
  unit: keyof typeof UNITS;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
  cooldown: number;
  target: number | null; // layout index of the target building
}

export interface SimInput {
  seed: number;
  layout: LayoutBuilding[];
  deploys: DeployEntry[];
  lootable: ResourceAmounts;
}

export function simulate(input: SimInput, upTo?: number): BattleResult {
  const { seed, layout, deploys, lootable } = input;
  const rng = new XorShift32(seed);
  const buildings: SimBuilding[] = layout.map((b) => ({ layout: b, hp: b.hp, destroyed: false, cooldown: 0 }));
  const units: SimUnit[] = [];
  let ebb = false;
  let flood = false;
  let spring = false;
  const total = buildings.length;
  const ticks: TickState[] = [];

  const snapshot = (tick: number): TickState => {
    const destroyedCount = buildings.reduce((acc, b) => acc + (b.destroyed ? 1 : 0), 0);
    const destruction = total === 0 ? 0 : Math.floor((100 * destroyedCount) / total);
    const stars = (ebb ? 1 : 0) + (flood ? 1 : 0) + (spring ? 1 : 0);
    const loot: ResourceAmounts = {
      brine: Math.floor((lootable.brine * destruction) / 100),
      peat: Math.floor((lootable.peat * destruction) / 100),
      copper: Math.floor((lootable.copper * destruction) / 100),
    };
    const hashInput: number[] = [tick, destruction, stars, loot.brine, loot.peat, loot.copper];
    for (const b of buildings) hashInput.push(b.hp);
    for (const u of units) hashInput.push(u.x, u.y, u.hp);
    return {
      tick,
      destruction,
      stars,
      loot,
      buildings: buildings.map((b) => ({ index: b.layout.index, hp: b.hp, destroyed: b.destroyed })),
      units: units.map((u) => ({ index: u.index, unit: u.unit, x: u.x, y: u.y, hp: u.hp, alive: u.alive })),
      hash: fnv1a32(hashInput),
    };
  };

  const step = (k: number): void => {
    // 1. deploys with tick k spawn, in deploy-list order, at cell centres
    for (const d of deploys) {
      if (d.tick === k) {
        units.push({
          index: units.length,
          unit: d.unit,
          x: d.x * 1000 + 500,
          y: d.y * 1000 + 500,
          hp: UNITS[d.unit].hp,
          alive: true,
          cooldown: 0,
          target: null,
        });
      }
    }
    // 2. each living unit acts, in spawn order
    for (const u of units) {
      if (!u.alive) continue;
      const spec = UNITS[u.unit];
      let target = u.target === null ? null : buildings[u.target];
      if (target === null || target === undefined || target.destroyed) {
        let best: SimBuilding | null = null;
        let bestD = Infinity;
        for (const b of buildings) {
          if (b.destroyed) continue;
          const p = nearestPoint(u.x, u.y, b.layout);
          const d = distSquared(u.x, u.y, p.x, p.y);
          if (d < bestD) {
            bestD = d;
            best = b;
          }
        }
        if (best === null) continue; // nothing left standing; nothing to attack
        u.target = best.layout.index;
        target = best;
      }
      const p = nearestPoint(u.x, u.y, target.layout);
      const d = distSquared(u.x, u.y, p.x, p.y);
      const inRange = d <= spec.rangeThousandths * spec.rangeThousandths;
      if (inRange && u.cooldown === 0) {
        const dmg = Math.floor((spec.damage * (90 + (rng.draw() % 21))) / 100);
        target.hp = Math.max(0, target.hp - dmg);
        if (target.hp === 0) target.destroyed = true;
        u.cooldown = spec.intervalTicks - 1;
      } else {
        if (u.cooldown > 0) u.cooldown -= 1;
        if (!inRange) {
          const distance = Math.floor(Math.sqrt(d));
          const stepLen = Math.min(spec.speedThousandths, distance);
          if (distance > 0) {
            u.x += Math.trunc(((p.x - u.x) * stepLen) / distance);
            u.y += Math.trunc(((p.y - u.y) * stepLen) / distance);
          }
        }
      }
    }
    // 3. each standing Kiln Tower acts, in layout order
    for (const b of buildings) {
      if (b.destroyed || !BUILDINGS[b.layout.type].tower) continue;
      const tower = BUILDINGS[b.layout.type].tower!;
      const f = footprint(b.layout);
      const cx = (f.x0 + f.x1) / 2;
      const cy = (f.y0 + f.y1) / 2;
      const rangeSq = tower.rangeCells * 1000 * (tower.rangeCells * 1000);
      let target: SimUnit | null = null;
      let bestD = Infinity;
      for (const u of units) {
        if (!u.alive) continue;
        const d = distSquared(cx, cy, u.x, u.y);
        if (d <= rangeSq && d < bestD) {
          bestD = d;
          target = u;
        }
      }
      if (b.cooldown === 0 && target !== null) {
        const dmg = Math.floor((tower.damage[b.layout.level - 1] * (90 + (rng.draw() % 21))) / 100);
        target.hp = Math.max(0, target.hp - dmg);
        if (target.hp === 0) target.alive = false;
        b.cooldown = 7;
      } else if (b.cooldown > 0) {
        b.cooldown -= 1;
      }
    }
  };

  // A layout with no Kiln Tower has the Flood mark earned from the start.
  if (buildings.every((b) => !BUILDINGS[b.layout.type].tower || b.destroyed)) flood = true;

  ticks.push(snapshot(0));
  let n = 0;
  while (n < 1800) {
    step(n); // step k produces tick k+1
    n += 1;
    const destroyedCount = buildings.reduce((acc, b) => acc + (b.destroyed ? 1 : 0), 0);
    const destruction = total === 0 ? 0 : Math.floor((100 * destroyedCount) / total);
    // marks, kept once earned
    if (destruction >= 40) ebb = true;
    if (buildings.every((b) => !BUILDINGS[b.layout.type].tower || b.destroyed)) flood = true;
    if (destruction >= 80 && n <= 900) spring = true;
    ticks.push(snapshot(n));
    const allDead = units.every((u) => !u.alive);
    const noFutureDeploys = !deploys.some((d) => d.tick >= n);
    if (destruction === 100 || (allDead && noFutureDeploys)) break;
    if (upTo !== undefined && n >= upTo) break;
  }

  const last = ticks[ticks.length - 1];
  return { finalTick: last.tick, destruction: last.destruction, stars: last.stars, loot: last.loot, ticks };
}

export function snapshotAt(input: SimInput, tick: number): TickState {
  const { ticks } = simulate(input, tick);
  return ticks[Math.min(tick, ticks.length - 1)];
}
