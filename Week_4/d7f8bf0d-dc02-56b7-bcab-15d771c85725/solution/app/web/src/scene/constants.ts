// Scene units are metres. World x runs east, world z runs south (so north is -z), y is up.

export const COLORS = {
  ground: '#FFFFFF',
  surface: '#E8ECF4',
  ink: '#2B3145',
  accent: '#0FA6EE',
  accentDeep: '#0158B4',
  action: '#FF9F0F',
  actionLip: '#C46A00',
  field: '#3FB56B',
  lip: '#AEB8D0',
  lipPale: '#C9D1E6',
  trestle: '#7F8BAA',
  rail: '#D7DEEE',
  sleeper: '#5A6178',
  hall: '#DCE6F7',
  floorShade: '#37A661',
  pink: '#E8478B',
  violet: '#7A5CF0',
} as const

export const TABLE_Y = 0.9
const ELEVATION_SCALE = 6
export const SLAB_HALF_WIDTH = 0.6
export const SLAB_THICKNESS = 0.05
// The green track bed covers the deck but for a thin rim, so two beds that fork merge with no sliver of deck between them.
export const BED_HALF_WIDTH = 0.5
export const STRIP_HALF_WIDTH = 0.42
export const RIBBON_HALF_WIDTH = 0.33
export const GAUGE_HALF = 0.07
export const STRIP_PERIOD = 0.62
export const RIBBON_PERIOD = 0.95
// Heights above the table: a free block's band lies under the sleepers, any other state covers them, the rails stand
// above the band, and the ribbon runs over the rails so its chevrons are never cut by them.
export const BAND_LIFT = 0.046
export const RAIL_LIFT = 0.062
export const RIBBON_LIFT = 0.072
export const STOCK_LIFT = 0.07

export const DURATION = {
  glide: 640,
  ribbonBlock: 180,
  flag: 240,
  sheet: 300,
  camera: 400,
  pigeon: 3000,
} as const

export const FOV_DEG = 30
export const PITCH_DEG = 32
export const MIN_ZOOM = 0.3
export const MAX_ZOOM = 8
export const TAP_SLOP_PX = 6

export function worldX(xMm: number): number {
  return xMm / 1000
}

export function worldZ(yMm: number): number {
  return -yMm / 1000
}

export function worldY(elevationMm: number): number {
  return TABLE_Y + (elevationMm / 1000) * ELEVATION_SCALE
}

// The stages the WebGL stage builds before it reports done: hall, modules, track, details, first frame.
export const BUILD_STAGES = 5
