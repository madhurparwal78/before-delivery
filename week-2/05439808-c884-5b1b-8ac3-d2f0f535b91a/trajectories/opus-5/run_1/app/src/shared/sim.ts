import { BUILDINGS, UNITS, footprintAt, RAID_FINAL_TICK } from './catalog.js';
import type { BuildingType, ResourceAmounts, Rotation, UnitKey } from './types.js';

export type SimLayoutBuilding = {
  index: number;
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  rotation: Rotation;
  level: number;
  hp: number;
};

export type SimDeploy = { tick: number; unit: UnitKey; x: number; y: number };

export type SimInput = {
  seed: number;
  layout: readonly SimLayoutBuilding[];
  deploys: readonly SimDeploy[];
  lootable: ResourceAmounts;
};

export type TickState = {
  tick: number;
  destruction: number;
  stars: number;
  loot: ResourceAmounts;
  hash: string;
  buildingHp: readonly number[];
  units: readonly { unit: UnitKey; x: number; y: number; hp: number; alive: boolean }[];
};

export type SimResult = {
  finalTick: number;
  ticks: readonly TickState[];
};

const MILLI = 1000;
const SPRING_DEADLINE_TICK = 900;

function toUint32(value: number): number {
  return value >>> 0;
}

class Xorshift {
  private state: number;

  constructor(seed: number) {
    this.state = toUint32(seed);
  }

  draw(): number {
    let state = this.state;
    state = toUint32(state ^ toUint32(state << 13));
    state = toUint32(state ^ (state >>> 17));
    state = toUint32(state ^ toUint32(state << 5));
    this.state = state;
    return state;
  }
}

function isqrt(value: number): number {
  if (value <= 0) return 0;
  let root = Math.floor(Math.sqrt(value));
  while (root * root > value) root -= 1;
  while ((root + 1) * (root + 1) <= value) root += 1;
  return root;
}

type Rect = { minX: number; maxX: number; minY: number; maxY: number };

function rectOf(building: SimLayoutBuilding): Rect {
  const { width, depth } = footprintAt(building.type, building.rotation);
  return {
    minX: building.x * MILLI,
    maxX: (building.x + width) * MILLI,
    minY: building.y * MILLI,
    maxY: (building.y + depth) * MILLI
  };
}

function centreOf(rect: Rect): { x: number; y: number } {
  return { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function nearestPoint(rect: Rect, x: number, y: number): { x: number; y: number } {
  return { x: clamp(x, rect.minX, rect.maxX), y: clamp(y, rect.minY, rect.maxY) };
}

function squaredDistanceToRect(rect: Rect, x: number, y: number): number {
  const point = nearestPoint(rect, x, y);
  const dx = point.x - x;
  const dy = point.y - y;
  return dx * dx + dy * dy;
}

function fnv1a(values: readonly number[]): string {
  let hash = 2166136261 >>> 0;
  for (const value of values) {
    const word = value | 0;
    for (let shift = 0; shift < 32; shift += 8) {
      hash = (hash ^ ((word >>> shift) & 0xff)) >>> 0;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}

type UnitRuntime = {
  unit: UnitKey;
  x: number;
  y: number;
  hp: number;
  cooldown: number;
  targetIndex: number | null;
};

type BuildingRuntime = {
  source: SimLayoutBuilding;
  rect: Rect;
  centre: { x: number; y: number };
  hp: number;
  cooldown: number;
};

function destructionOf(destroyed: number, total: number): number {
  return Math.floor((100 * destroyed) / total);
}

function lootAtDestruction(lootable: ResourceAmounts, destruction: number): ResourceAmounts {
  return {
    brine: Math.floor((lootable.brine * destruction) / 100),
    peat: Math.floor((lootable.peat * destruction) / 100),
    copper: Math.floor((lootable.copper * destruction) / 100)
  };
}

export function simulate(input: SimInput): SimResult {
  const rng = new Xorshift(input.seed);
  const buildings: BuildingRuntime[] = input.layout.map((source) => {
    const rect = rectOf(source);
    return { source, rect, centre: centreOf(rect), hp: source.hp, cooldown: 0 };
  });
  const units: UnitRuntime[] = [];
  const deploysByTick = new Map<number, SimDeploy[]>();
  let lastDeployTick = -1;
  for (const deploy of input.deploys) {
    const bucket = deploysByTick.get(deploy.tick);
    if (bucket) bucket.push(deploy);
    else deploysByTick.set(deploy.tick, [deploy]);
    if (deploy.tick > lastDeployTick) lastDeployTick = deploy.tick;
  }

  let ebbMark = false;
  let floodMark = false;
  let springMark = false;
  const ticks: TickState[] = [];

  const hit = (base: number, applyTo: { hp: number }): void => {
    const damage = Math.floor((base * (90 + (rng.draw() % 21))) / 100);
    applyTo.hp = Math.max(0, applyTo.hp - damage);
  };

  const recordTick = (tick: number): TickState => {
    const destroyed = buildings.reduce((total, building) => total + (building.hp === 0 ? 1 : 0), 0);
    const destruction = destructionOf(destroyed, buildings.length);
    if (destruction >= 40) ebbMark = true;
    if (buildings.every((building) => building.source.type !== 'kiln_tower' || building.hp === 0)) {
      floodMark = true;
    }
    if (tick <= SPRING_DEADLINE_TICK && destruction >= 80) springMark = true;
    const stars = (ebbMark ? 1 : 0) + (floodMark ? 1 : 0) + (springMark ? 1 : 0);
    const loot = lootAtDestruction(input.lootable, destruction);
    const buildingHp = buildings.map((building) => building.hp);
    const hashValues: number[] = [
      tick,
      destruction,
      stars,
      loot.brine,
      loot.peat,
      loot.copper,
      ...buildingHp
    ];
    for (const unit of units) {
      hashValues.push(unit.x, unit.y, unit.hp);
    }
    const state: TickState = {
      tick,
      destruction,
      stars,
      loot,
      hash: fnv1a(hashValues),
      buildingHp,
      units: units.map((unit) => ({
        unit: unit.unit,
        x: unit.x,
        y: unit.y,
        hp: unit.hp,
        alive: unit.hp > 0
      }))
    };
    ticks.push(state);
    return state;
  };

  const isFinal = (state: TickState): boolean => {
    if (state.destruction === 100) return true;
    return units.every((unit) => unit.hp === 0) && lastDeployTick < state.tick;
  };

  let state = recordTick(0);
  if (isFinal(state)) return { finalTick: 0, ticks };

  for (let step = 0; step < RAID_FINAL_TICK; step += 1) {
    for (const deploy of deploysByTick.get(step) ?? []) {
      const spec = UNITS[deploy.unit];
      units.push({
        unit: deploy.unit,
        x: deploy.x * MILLI + 500,
        y: deploy.y * MILLI + 500,
        hp: spec.hitPoints,
        cooldown: 0,
        targetIndex: null
      });
    }

    for (const unit of units) {
      if (unit.hp === 0) continue;
      const spec = UNITS[unit.unit];
      const current = unit.targetIndex === null ? null : buildings[unit.targetIndex];
      if (current === null || current === undefined || current.hp === 0) {
        unit.targetIndex = nearestStandingBuilding(buildings, unit.x, unit.y);
      }
      const target = unit.targetIndex === null ? null : buildings[unit.targetIndex];
      if (target === null || target === undefined) continue;
      const squared = squaredDistanceToRect(target.rect, unit.x, unit.y);
      const inRange = squared <= spec.rangeMilli * spec.rangeMilli;
      if (inRange && unit.cooldown === 0) {
        hit(spec.damage, target);
        unit.cooldown = spec.intervalTicks - 1;
        continue;
      }
      if (unit.cooldown > 0) unit.cooldown -= 1;
      if (!inRange) {
        const point = nearestPoint(target.rect, unit.x, unit.y);
        const dx = point.x - unit.x;
        const dy = point.y - unit.y;
        const distance = isqrt(squared);
        const stepLength = Math.min(spec.speedMilli, distance);
        unit.x += Math.trunc((dx * stepLength) / distance);
        unit.y += Math.trunc((dy * stepLength) / distance);
      }
    }

    for (const tower of buildings) {
      const towerLevels = BUILDINGS[tower.source.type].tower;
      if (!towerLevels || tower.hp === 0) continue;
      const spec = towerLevels[tower.source.level - 1];
      if (!spec) continue;
      const target = nearestLivingUnit(
        units,
        tower.centre.x,
        tower.centre.y,
        spec.rangeCells * MILLI
      );
      if (tower.cooldown === 0) {
        if (target !== null) {
          hit(spec.damage, target);
          tower.cooldown = spec.intervalTicks - 1;
        }
      } else {
        tower.cooldown -= 1;
      }
    }

    state = recordTick(step + 1);
    if (isFinal(state)) return { finalTick: state.tick, ticks };
  }

  return { finalTick: RAID_FINAL_TICK, ticks };
}

function nearestStandingBuilding(
  buildings: readonly BuildingRuntime[],
  x: number,
  y: number
): number | null {
  let best: number | null = null;
  let bestSquared = 0;
  for (let index = 0; index < buildings.length; index += 1) {
    const building = buildings[index];
    if (!building || building.hp === 0) continue;
    const squared = squaredDistanceToRect(building.rect, x, y);
    if (best === null || squared < bestSquared) {
      best = index;
      bestSquared = squared;
    }
  }
  return best;
}

function nearestLivingUnit(
  units: readonly UnitRuntime[],
  x: number,
  y: number,
  rangeMilli: number
): UnitRuntime | null {
  let best: UnitRuntime | null = null;
  let bestSquared = 0;
  for (const unit of units) {
    if (unit.hp === 0) continue;
    const dx = unit.x - x;
    const dy = unit.y - y;
    const squared = dx * dx + dy * dy;
    if (squared > rangeMilli * rangeMilli) continue;
    if (best === null || squared < bestSquared) {
      best = unit;
      bestSquared = squared;
    }
  }
  return best;
}
