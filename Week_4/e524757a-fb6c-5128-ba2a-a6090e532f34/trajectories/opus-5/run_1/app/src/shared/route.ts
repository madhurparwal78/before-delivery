import type { CreatureDef } from './creatures.js';
import type { Heading, Tile } from './islands.js';

export type CreaturePose = { tile: Tile; heading: Heading };

function stepTowards(from: Tile, to: Tile): { dx: number; dy: number; heading: Heading } {
  if (to.x > from.x) return { dx: 1, dy: 0, heading: 'E' };
  if (to.x < from.x) return { dx: -1, dy: 0, heading: 'W' };
  if (to.y > from.y) return { dx: 0, dy: 1, heading: 'S' };
  return { dx: 0, dy: -1, heading: 'N' };
}

/** The published route rule: the one place a creature's position and heading are decided. */
export function creaturePose(creature: CreatureDef, tick: number): CreaturePose {
  const route = creature.route;
  if (route.kind === 'stay') return { tile: route.tile, heading: route.heading };
  const length = Math.abs(route.to.x - route.from.x) + Math.abs(route.to.y - route.from.y);
  const k = Math.floor(tick / route.ticksPerTile) % (2 * length);
  if (k < length) {
    const dir = stepTowards(route.from, route.to);
    return { tile: { x: route.from.x + dir.dx * k, y: route.from.y + dir.dy * k }, heading: dir.heading };
  }
  const back = k - length;
  const dir = stepTowards(route.to, route.from);
  return { tile: { x: route.to.x + dir.dx * back, y: route.to.y + dir.dy * back }, heading: dir.heading };
}
