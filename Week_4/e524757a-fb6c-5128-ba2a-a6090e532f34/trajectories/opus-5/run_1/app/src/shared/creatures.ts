import type { Heading, Tile } from './islands.js';

export type Presence = 'always' | 'dusk only' | 'rain only';

export type RouteDef =
  | { kind: 'stay'; tile: Tile; heading: Heading }
  | { kind: 'patrol'; from: Tile; to: Tile; ticksPerTile: number };

export type CreatureDef = {
  id: string;
  name: string;
  island: number;
  size: number;
  present: Presence;
  route: RouteDef;
};

export const CREATURES: ReadonlyArray<CreatureDef> = [
  {
    id: 'mossback-newt',
    name: 'Mossback newt',
    island: 1,
    size: 1,
    present: 'always',
    route: { kind: 'stay', tile: { x: 12, y: 6 }, heading: 'S' },
  },
  {
    id: 'reedpipe-heron',
    name: 'Reedpipe heron',
    island: 1,
    size: 2,
    present: 'always',
    route: { kind: 'patrol', from: { x: 6, y: 16 }, to: { x: 10, y: 16 }, ticksPerTile: 10 },
  },
  {
    id: 'gloamfin-moth',
    name: 'Gloamfin moth',
    island: 1,
    size: 1,
    present: 'dusk only',
    route: { kind: 'stay', tile: { x: 18, y: 12 }, heading: 'W' },
  },
  {
    id: 'puddle-lark',
    name: 'Puddle lark',
    island: 1,
    size: 1,
    present: 'rain only',
    route: { kind: 'patrol', from: { x: 4, y: 4 }, to: { x: 4, y: 9 }, ticksPerTile: 5 },
  },
  {
    id: 'bracken-hare',
    name: 'Bracken hare',
    island: 2,
    size: 1,
    present: 'always',
    route: { kind: 'patrol', from: { x: 8, y: 8 }, to: { x: 14, y: 8 }, ticksPerTile: 6 },
  },
  {
    id: 'mossfern-stag',
    name: 'Mossfern stag',
    island: 2,
    size: 3,
    present: 'always',
    route: { kind: 'patrol', from: { x: 12, y: 13 }, to: { x: 12, y: 18 }, ticksPerTile: 8 },
  },
  {
    id: 'lantern-toad',
    name: 'Lantern toad',
    island: 2,
    size: 1,
    present: 'dusk only',
    route: { kind: 'stay', tile: { x: 16, y: 12 }, heading: 'W' },
  },
  {
    id: 'drizzle-snail',
    name: 'Drizzle snail',
    island: 2,
    size: 1,
    present: 'rain only',
    route: { kind: 'stay', tile: { x: 20, y: 6 }, heading: 'S' },
  },
  {
    id: 'glasswing-crab',
    name: 'Glasswing crab',
    island: 3,
    size: 1,
    present: 'always',
    route: { kind: 'patrol', from: { x: 3, y: 6 }, to: { x: 9, y: 6 }, ticksPerTile: 6 },
  },
  {
    id: 'tidewhistle-otter',
    name: 'Tidewhistle otter',
    island: 3,
    size: 2,
    present: 'always',
    route: { kind: 'patrol', from: { x: 15, y: 16 }, to: { x: 20, y: 16 }, ticksPerTile: 8 },
  },
  {
    id: 'duskshell-snipe',
    name: 'Duskshell snipe',
    island: 3,
    size: 1,
    present: 'dusk only',
    route: { kind: 'stay', tile: { x: 6, y: 12 }, heading: 'E' },
  },
  {
    id: 'rainbead-gecko',
    name: 'Rainbead gecko',
    island: 3,
    size: 1,
    present: 'rain only',
    route: { kind: 'patrol', from: { x: 15, y: 3 }, to: { x: 15, y: 8 }, ticksPerTile: 5 },
  },
  {
    id: 'cragtail-goat',
    name: 'Cragtail goat',
    island: 4,
    size: 2,
    present: 'always',
    route: { kind: 'patrol', from: { x: 8, y: 14 }, to: { x: 8, y: 20 }, ticksPerTile: 10 },
  },
  {
    id: 'fell-mouse',
    name: 'Fell mouse',
    island: 4,
    size: 1,
    present: 'always',
    route: { kind: 'patrol', from: { x: 15, y: 4 }, to: { x: 20, y: 4 }, ticksPerTile: 4 },
  },
  {
    id: 'mistcrown-owl',
    name: 'Mistcrown owl',
    island: 4,
    size: 2,
    present: 'dusk only',
    route: { kind: 'stay', tile: { x: 14, y: 8 }, heading: 'S' },
  },
  {
    id: 'cloudpuff-vole',
    name: 'Cloudpuff vole',
    island: 4,
    size: 1,
    present: 'rain only',
    route: { kind: 'stay', tile: { x: 6, y: 4 }, heading: 'E' },
  },
  {
    id: 'beacon-gull',
    name: 'Beacon gull',
    island: 5,
    size: 2,
    present: 'always',
    route: { kind: 'patrol', from: { x: 12, y: 20 }, to: { x: 18, y: 20 }, ticksPerTile: 6 },
  },
  {
    id: 'shingle-plover',
    name: 'Shingle plover',
    island: 5,
    size: 1,
    present: 'always',
    route: { kind: 'patrol', from: { x: 4, y: 12 }, to: { x: 4, y: 18 }, ticksPerTile: 5 },
  },
  {
    id: 'wickwing-bat',
    name: 'Wickwing bat',
    island: 5,
    size: 1,
    present: 'dusk only',
    route: { kind: 'stay', tile: { x: 8, y: 8 }, heading: 'S' },
  },
  {
    id: 'sleetfoot-fox',
    name: 'Sleetfoot fox',
    island: 5,
    size: 2,
    present: 'rain only',
    route: { kind: 'patrol', from: { x: 13, y: 4 }, to: { x: 13, y: 10 }, ticksPerTile: 8 },
  },
];

const BY_ID = new Map(CREATURES.map((c) => [c.id, c]));

export function creatureById(id: string): CreatureDef | undefined {
  return BY_ID.get(id);
}

export function creaturesOfIsland(island: number): CreatureDef[] {
  return CREATURES.filter((c) => c.island === island);
}
