// The battle simulation. This module is the only place the battle rules exist; the server's
// resolution and operator re-run and the browser's replay and raid preview all import it.
import { BUILDINGS, UNITS, type Amounts, type BuildingType, type Rotation, type UnitKey } from './catalog';
import { footprint } from './grid';

export const RAID_TICKS = 1800;
export const LAST_DEPLOY_TICK = RAID_TICKS - 1;
const SPRING_TICK = 900;
const EBB_DESTRUCTION = 40;
const SPRING_DESTRUCTION = 80;
const CELL = 1000;
const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

export interface LayoutBuilding {
  index: number;
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  rotation: Rotation;
  level: number;
  hp: number;
}

export interface Deploy {
  tick: number;
  unit: UnitKey;
  x: number;
  y: number;
}

interface BattleInput {
  seed: number;
  layout: readonly LayoutBuilding[];
  deploys: readonly Deploy[];
  lootable: Amounts;
}

/** The state after `tick` steps. Unit arrays are in spawn order. */
export interface BattleFrame {
  tick: number;
  destruction: number;
  stars: number;
  loot: Amounts;
  hash: string;
  buildingHp: number[];
  unitX: number[];
  unitY: number[];
  unitHp: number[];
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface BuildingRun {
  rect: Rect;
  hp: number;
  tower: { damage: number; rangeSq: number; interval: number; cx: number; cy: number } | null;
  cooldown: number;
}

interface UnitRun {
  unit: UnitKey;
  x: number;
  y: number;
  hp: number;
  cooldown: number;
  target: number | null;
}

/** 32-bit xorshift: shift left 13, right 17, left 5. */
function xorshift(state: number): number {
  let s = state >>> 0;
  s = (s ^ (s << 13)) >>> 0;
  s = (s ^ (s >>> 17)) >>> 0;
  s = (s ^ (s << 5)) >>> 0;
  return s;
}

function isqrt(n: number): number {
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r -= 1;
  while ((r + 1) * (r + 1) <= n) r += 1;
  return r;
}

function nearestPoint(x: number, y: number, r: Rect): [number, number] {
  return [Math.min(Math.max(x, r.x0), r.x1), Math.min(Math.max(y, r.y0), r.y1)];
}

/** 32-bit FNV-1a over the 4-byte little-endian form of each integer. */
function stateHash(values: readonly number[]): string {
  let h = FNV_OFFSET;
  for (const v of values) {
    for (let k = 0; k < 4; k += 1) {
      h = Math.imul(h ^ ((v >>> (8 * k)) & 0xff), FNV_PRIME) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}

export function simulateBattle(input: BattleInput): BattleFrame[] {
  const buildings: BuildingRun[] = input.layout.map((b) => {
    const f = footprint(b.type, b.x, b.y, b.rotation);
    const rect = { x0: f.x * CELL, y0: f.y * CELL, x1: (f.x + f.width) * CELL, y1: (f.y + f.depth) * CELL };
    const tower = BUILDINGS[b.type].tower;
    return {
      rect,
      hp: b.hp,
      cooldown: 0,
      tower: tower
        ? {
            damage: tower.damage[b.level - 1] as number,
            rangeSq: tower.rangeMilli * tower.rangeMilli,
            interval: tower.interval,
            cx: Math.floor((rect.x0 + rect.x1) / 2),
            cy: Math.floor((rect.y0 + rect.y1) / 2),
          }
        : null,
    };
  });
  const towers = buildings.filter((b) => b.tower !== null);
  const units: UnitRun[] = [];
  const marks = { ebb: false, flood: false, spring: false };
  let rng = input.seed >>> 0;

  const roll = (base: number): number => {
    rng = xorshift(rng);
    return Math.floor((base * (90 + (rng % 21))) / 100);
  };

  const frame = (tick: number): BattleFrame => {
    const destroyed = buildings.filter((b) => b.hp === 0).length;
    const destruction = Math.floor((100 * destroyed) / buildings.length);
    if (destruction >= EBB_DESTRUCTION) marks.ebb = true;
    if (towers.length > 0 && towers.every((t) => t.hp === 0)) marks.flood = true;
    if (destruction >= SPRING_DESTRUCTION && tick <= SPRING_TICK) marks.spring = true;
    const stars = Number(marks.ebb) + Number(marks.flood) + Number(marks.spring);
    const loot: Amounts = {
      brine: Math.floor((input.lootable.brine * destruction) / 100),
      peat: Math.floor((input.lootable.peat * destruction) / 100),
      copper: Math.floor((input.lootable.copper * destruction) / 100),
    };
    const buildingHp = buildings.map((b) => b.hp);
    const unitX = units.map((u) => u.x);
    const unitY = units.map((u) => u.y);
    const unitHp = units.map((u) => u.hp);
    const values = [tick, destruction, stars, loot.brine, loot.peat, loot.copper, ...buildingHp];
    units.forEach((u) => values.push(u.x, u.y, u.hp));
    return { tick, destruction, stars, loot, hash: stateHash(values), buildingHp, unitX, unitY, unitHp };
  };

  const frames: BattleFrame[] = [frame(0)];
  for (let tick = 0; tick < RAID_TICKS; tick += 1) {
    const last = frames[frames.length - 1] as BattleFrame;
    const allDead = units.every((u) => u.hp === 0);
    if (last.destruction === 100 || (allDead && !input.deploys.some((d) => d.tick >= tick))) break;

    for (const d of input.deploys) {
      if (d.tick !== tick) continue;
      units.push({ unit: d.unit, x: d.x * CELL + CELL / 2, y: d.y * CELL + CELL / 2, hp: UNITS[d.unit].hp, cooldown: 0, target: null });
    }

    for (const u of units) {
      if (u.hp === 0) continue;
      const spec = UNITS[u.unit];
      if (u.target === null || (buildings[u.target] as BuildingRun).hp === 0) {
        let best: { d2: number; index: number } | null = null;
        buildings.forEach((b, index) => {
          if (b.hp === 0) return;
          const [qx, qy] = nearestPoint(u.x, u.y, b.rect);
          const d2 = (qx - u.x) ** 2 + (qy - u.y) ** 2;
          if (best === null || d2 < best.d2) best = { d2, index };
        });
        u.target = best === null ? null : (best as { index: number }).index;
      }
      if (u.target === null) continue;
      const target = buildings[u.target] as BuildingRun;
      const [qx, qy] = nearestPoint(u.x, u.y, target.rect);
      const dx = qx - u.x;
      const dy = qy - u.y;
      const d2 = dx * dx + dy * dy;
      const inRange = d2 <= spec.rangeMilli * spec.rangeMilli;
      if (inRange && u.cooldown === 0) {
        target.hp = Math.max(0, target.hp - roll(spec.damage));
        u.cooldown = spec.interval - 1;
      } else {
        if (u.cooldown > 0) u.cooldown -= 1;
        if (!inRange) {
          const dist = isqrt(d2);
          const step = Math.min(spec.speedMilli, dist);
          u.x += Math.trunc((dx * step) / dist);
          u.y += Math.trunc((dy * step) / dist);
        }
      }
    }

    for (const t of towers) {
      if (t.hp === 0 || t.tower === null) continue;
      const tower = t.tower;
      let best: { d2: number; index: number } | null = null;
      units.forEach((u, index) => {
        if (u.hp === 0) return;
        const d2 = (u.x - tower.cx) ** 2 + (u.y - tower.cy) ** 2;
        if (d2 <= tower.rangeSq && (best === null || d2 < best.d2)) best = { d2, index };
      });
      if (t.cooldown === 0) {
        if (best !== null) {
          const victim = units[(best as { index: number }).index] as UnitRun;
          victim.hp = Math.max(0, victim.hp - roll(tower.damage));
          t.cooldown = tower.interval - 1;
        }
      } else {
        t.cooldown -= 1;
      }
    }

    frames.push(frame(tick + 1));
  }
  return frames;
}

/** The spawn-order unit kinds of a deploy list, as the frames index them. */
export function spawnOrder(deploys: readonly Deploy[]): UnitKey[] {
  return [...deploys].map((d, i) => ({ d, i })).sort((a, b) => a.d.tick - b.d.tick || a.i - b.i).map(({ d }) => d.unit);
}
