/** The archipelago: five islands of 24 by 24 tiles, their spots and their twenty creatures (brief: Seed data). */

export type Heading = 'N' | 'E' | 'S' | 'W'
export type Tile = readonly [number, number]
export type Present = 'always' | 'dusk only' | 'rain only'

export const GRID = 24
export const HEADINGS: readonly Heading[] = ['N', 'E', 'S', 'W']
export const HEADING_ANGLE: Record<Heading, number> = { N: 0, E: 90, S: 180, W: 270 }
export const HEADING_STEP: Record<Heading, Tile> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }
export const OPPOSITE: Record<Heading, Heading> = { N: 'S', E: 'W', S: 'N', W: 'E' }

interface Pond { x: readonly [number, number]; y: readonly [number, number] }

export interface Island {
  id: number
  name: string
  pond: Pond
  rocks: readonly Tile[]
  lighthouse?: Tile
}

export const ISLANDS: readonly Island[] = [
  { id: 1, name: 'Saltmarsh Harbour', pond: { x: [15, 17], y: [3, 5] }, rocks: [[6, 6], [7, 6], [8, 6], [14, 14], [14, 15], [14, 16]] },
  { id: 2, name: 'Fernhollow', pond: { x: [4, 6], y: [15, 17] }, rocks: [[10, 4], [10, 5], [10, 6], [17, 17], [18, 17], [19, 17]] },
  { id: 3, name: 'Driftglass Reef', pond: { x: [11, 13], y: [11, 13] }, rocks: [[5, 18], [6, 18], [7, 18], [18, 5], [18, 6], [18, 7]] },
  { id: 4, name: 'Mistcrown Fells', pond: { x: [17, 19], y: [15, 17] }, rocks: [[4, 9], [5, 9], [6, 9], [12, 2], [12, 3], [12, 4]] },
  { id: 5, name: 'Lantern Point', pond: { x: [3, 5], y: [3, 5] }, rocks: [[9, 15], [10, 15], [11, 15], [16, 9], [16, 10], [16, 11]], lighthouse: [20, 4] },
]

interface Spot { spot: number; tile: Tile; heading: Heading }

export const SPOTS: readonly Spot[] = [
  { spot: 1, tile: [3, 12], heading: 'E' },
  { spot: 2, tile: [12, 10], heading: 'N' },
  { spot: 3, tile: [8, 20], heading: 'N' },
  { spot: 4, tile: [20, 12], heading: 'W' },
]

export const HARBOUR = 1

export function islandById(id: number): Island | undefined {
  return ISLANDS.find((island) => island.id === id)
}

type TileKind = 'water' | 'rock' | 'lighthouse' | 'land'

export function tileKind(island: Island, x: number, y: number): TileKind {
  if (x <= 0 || y <= 0 || x >= GRID - 1 || y >= GRID - 1) return 'water'
  const { pond } = island
  if (x >= pond.x[0] && x <= pond.x[1] && y >= pond.y[0] && y <= pond.y[1]) return 'water'
  if (island.rocks.some(([rx, ry]) => rx === x && ry === y)) return 'rock'
  if (island.lighthouse && island.lighthouse[0] === x && island.lighthouse[1] === y) return 'lighthouse'
  return 'land'
}

export function isLand(island: Island, x: number, y: number): boolean {
  return tileKind(island, x, y) === 'land'
}

export interface CreatureDef {
  id: string
  name: string
  island: number
  size: number
  present: Present
  route: { stay: { at: Tile; heading: Heading } } | { patrol: { from: Tile; to: Tile; ticksPerTile: number } }
}

const stay = (x: number, y: number, heading: Heading): CreatureDef['route'] => ({ stay: { at: [x, y], heading } })
const patrol = (ax: number, ay: number, bx: number, by: number, ticksPerTile: number): CreatureDef['route'] => ({
  patrol: { from: [ax, ay], to: [bx, by], ticksPerTile },
})

export const CREATURES: readonly CreatureDef[] = [
  { id: 'mossback-newt', name: 'Mossback newt', island: 1, size: 1, present: 'always', route: stay(12, 6, 'S') },
  { id: 'reedpipe-heron', name: 'Reedpipe heron', island: 1, size: 2, present: 'always', route: patrol(6, 16, 10, 16, 10) },
  { id: 'gloamfin-moth', name: 'Gloamfin moth', island: 1, size: 1, present: 'dusk only', route: stay(18, 12, 'W') },
  { id: 'puddle-lark', name: 'Puddle lark', island: 1, size: 1, present: 'rain only', route: patrol(4, 4, 4, 9, 5) },
  { id: 'bracken-hare', name: 'Bracken hare', island: 2, size: 1, present: 'always', route: patrol(8, 8, 14, 8, 6) },
  { id: 'mossfern-stag', name: 'Mossfern stag', island: 2, size: 3, present: 'always', route: patrol(12, 13, 12, 18, 8) },
  { id: 'lantern-toad', name: 'Lantern toad', island: 2, size: 1, present: 'dusk only', route: stay(16, 12, 'W') },
  { id: 'drizzle-snail', name: 'Drizzle snail', island: 2, size: 1, present: 'rain only', route: stay(20, 6, 'S') },
  { id: 'glasswing-crab', name: 'Glasswing crab', island: 3, size: 1, present: 'always', route: patrol(3, 6, 9, 6, 6) },
  { id: 'tidewhistle-otter', name: 'Tidewhistle otter', island: 3, size: 2, present: 'always', route: patrol(15, 16, 20, 16, 8) },
  { id: 'duskshell-snipe', name: 'Duskshell snipe', island: 3, size: 1, present: 'dusk only', route: stay(6, 12, 'E') },
  { id: 'rainbead-gecko', name: 'Rainbead gecko', island: 3, size: 1, present: 'rain only', route: patrol(15, 3, 15, 8, 5) },
  { id: 'cragtail-goat', name: 'Cragtail goat', island: 4, size: 2, present: 'always', route: patrol(8, 14, 8, 20, 10) },
  { id: 'fell-mouse', name: 'Fell mouse', island: 4, size: 1, present: 'always', route: patrol(15, 4, 20, 4, 4) },
  { id: 'mistcrown-owl', name: 'Mistcrown owl', island: 4, size: 2, present: 'dusk only', route: stay(14, 8, 'S') },
  { id: 'cloudpuff-vole', name: 'Cloudpuff vole', island: 4, size: 1, present: 'rain only', route: stay(6, 4, 'E') },
  { id: 'beacon-gull', name: 'Beacon gull', island: 5, size: 2, present: 'always', route: patrol(12, 20, 18, 20, 6) },
  { id: 'shingle-plover', name: 'Shingle plover', island: 5, size: 1, present: 'always', route: patrol(4, 12, 4, 18, 5) },
  { id: 'wickwing-bat', name: 'Wickwing bat', island: 5, size: 1, present: 'dusk only', route: stay(8, 8, 'S') },
  { id: 'sleetfoot-fox', name: 'Sleetfoot fox', island: 5, size: 2, present: 'rain only', route: patrol(13, 4, 13, 10, 8) },
]

export function creatureById(id: string): CreatureDef | undefined {
  return CREATURES.find((creature) => creature.id === id)
}

export function creaturesOfIsland(island: number): CreatureDef[] {
  return CREATURES.filter((creature) => creature.island === island)
}
