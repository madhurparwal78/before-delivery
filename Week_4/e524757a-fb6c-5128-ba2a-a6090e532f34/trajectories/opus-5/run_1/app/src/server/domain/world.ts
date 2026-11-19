import { CREATURES, type CreatureDef } from '../../shared/creatures.js';
import { worldTime, type WorldTime } from '../../shared/clock.js';
import { creaturePose } from '../../shared/route.js';
import type { Heading } from '../../shared/islands.js';
import { ApiError } from '../../shared/errors.js';
import { clockConfig, config } from '../config.js';
import { query, type Queryable } from '../db.js';

export type PresentCreature = {
  id: string;
  name: string;
  island: number;
  size: number;
  x: number;
  y: number;
  heading: Heading;
};

export type WorldState = WorldTime & { id: string; creatures: PresentCreature[] };

type WorldRow = { id: string; tick: string; frozen: boolean; base_tick: string; started_at: Date };

export async function worldTick(worldId: string, db: Queryable = { query }): Promise<number> {
  const found = await db.query<WorldRow>('SELECT id, tick, frozen, base_tick, started_at FROM worlds WHERE id = $1', [
    worldId,
  ]);
  const row = found.rows[0];
  if (!row) throw new ApiError('not_found');
  return tickOf(row);
}

function tickOf(row: WorldRow): number {
  if (row.frozen) return Number(row.tick);
  const elapsed = Date.now() - row.started_at.getTime();
  return Number(row.base_tick) + Math.floor(elapsed / config.worldTickMs);
}

export function present(creature: CreatureDef, time: WorldTime): boolean {
  if (creature.present === 'always') return true;
  if (creature.present === 'dusk only') return time.dusk;
  return time.weather === 'rain';
}

/** Every creature standing in the world at this tick, by the published presence and route rules. */
export function creaturesAt(tick: number): PresentCreature[] {
  const time = worldTime(tick, clockConfig);
  const out: PresentCreature[] = [];
  for (const creature of CREATURES) {
    if (!present(creature, time)) continue;
    const pose = creaturePose(creature, tick);
    out.push({
      id: creature.id,
      name: creature.name,
      island: creature.island,
      size: creature.size,
      x: pose.tile.x,
      y: pose.tile.y,
      heading: pose.heading,
    });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

export function stateAtTick(worldId: string, tick: number): WorldState {
  return { id: worldId, ...worldTime(tick, clockConfig), creatures: creaturesAt(tick) };
}

export async function worldState(worldId: string): Promise<WorldState> {
  return stateAtTick(worldId, await worldTick(worldId));
}
