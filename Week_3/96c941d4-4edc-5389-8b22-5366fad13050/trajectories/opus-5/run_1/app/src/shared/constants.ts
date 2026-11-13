import type { Definition, Difficulty } from './types.js';

export const RULESET = 'orrel-1';
export const TICK_RATE = 20;

export const LANES = 5;
export const CELLS_PER_LANE = 9;
export const CELL_WIDTH = 1000;
export const SPAWN_POSITION = 8999;
export const HARBOUR_POSITION = 0;

export const INITIAL_RESERVE = 120000;
export const INITIAL_HEALTH = 10;
export const HARBOUR_GENERATION = 1000;
export const GENERATION_PERIOD = 20;

export const INITIAL_ENTITY_ID = 1;
export const INITIAL_MOVEMENT_ID = 1;
export const MAX_UPGRADES = 1;
export const UPGRADE_DAMAGE_MULTIPLIER = 2;
export const UPGRADE_GENERATION_MULTIPLIER = 2;
export const SALVAGE_REFUND_DIVISOR = 2;

export const FORECAST_TRANSITIONS = 100;
export const FORECAST_PHASES: { phase: string; durationMs: number }[] = [
  { phase: 'beam', durationMs: 180 },
  { phase: 'contacts', durationMs: 260 },
  { phase: 'ready', durationMs: 0 },
];

export const USAGE_SCALE = 1000;

export const SEASON_TIME_ZONE = 'Asia/Kathmandu';
export const SEASON_UTC_OFFSET = '+05:45';
export const SEASON_OFFSET_MINUTES = 5 * 60 + 45;
export const SEASON_DAY_START = '05:00';
export const SEASON_DAY_START_MINUTES = 5 * 60;
export const SEASON_DAY_FORMAT = 'YYYY-MM-DD';
export const SEASON_SELECTION_EPOCH = '1970-01-01';
export const SEASON_REFRESH_SECONDS = 30;

export const LIMITS = {
  lanes: LANES,
  cellsPerLane: CELLS_PER_LANE,
  minWaves: 1,
  maxWaves: 40,
  maxCreatures: 600,
  maxCompletedTicks: 18000,
  minCommandTick: 0,
  maxCommandTick: 17999,
  minEndTick: 0,
  maxEndTick: 18000,
  maxCommands: 2000,
  commandBodyBytes: 262144,
  otherBodyBytes: 1048576,
  maxDepth: 16,
  minSeed: 1,
  maxSeed: 4294967295,
  minWaveCount: 1,
  minWaveInterval: 1,
  minWaveTick: 0,
  maxWaveLane: LANES,
  maxFramePage: 201,
  minLoadout: 1,
  maxLoadout: 4,
  maxSearchCodePoints: 100,
  minPlayerNameCodePoints: 1,
  maxPlayerNameCodePoints: 32,
  minTitleCodePoints: 1,
  maxTitleCodePoints: 60,
  minDescriptionCodePoints: 0,
  maxDescriptionCodePoints: 500,
  maxEmailCodePoints: 254,
  minPasswordBytes: 12,
  maxPasswordBytes: 128,
  maxInstantFractionDigits: 3,
} as const;

export interface DeviceSpec {
  id: string;
  name: string;
  silhouette: string;
  cost: number;
  upgradeCost: number;
  range: number | null;
  cooldown: number | null;
  damage: number;
  maxTargets: number;
  laneOffsets: number[];
  ignoresArmour: boolean;
  generation: number;
  slowdownDivisor: number | null;
  upgradedSlowdownDivisor: number | null;
  effect: string;
}

export const DEVICES: DeviceSpec[] = [
  {
    id: 'wick',
    name: 'Wickwarden',
    silhouette: 'Narrow tower with square light hood',
    cost: 20000,
    upgradeCost: 10000,
    range: 3500,
    cooldown: 10,
    damage: 12,
    maxTargets: 1,
    laneOffsets: [0],
    ignoresArmour: false,
    generation: 0,
    slowdownDivisor: null,
    upgradedSlowdownDivisor: null,
    effect: 'One same-lane hit for 12',
  },
  {
    id: 'chime',
    name: 'Undertow Chime',
    silhouette: 'Twin hanging bells',
    cost: 30000,
    upgradeCost: 15000,
    range: 2500,
    cooldown: 20,
    damage: 10,
    maxTargets: 2,
    laneOffsets: [0],
    ignoresArmour: false,
    generation: 0,
    slowdownDivisor: null,
    upgradedSlowdownDivisor: null,
    effect: 'Up to two same-lane targets, each hit for 10',
  },
  {
    id: 'siphon',
    name: 'Brine Siphon',
    silhouette: 'Three open tide cups',
    cost: 25000,
    upgradeCost: 12500,
    range: null,
    cooldown: null,
    damage: 0,
    maxTargets: 0,
    laneOffsets: [],
    ignoresArmour: false,
    generation: 3000,
    slowdownDivisor: null,
    upgradedSlowdownDivisor: null,
    effect: 'Generate 3000 at each harbour generation boundary',
  },
  {
    id: 'wall',
    name: 'Foldwall',
    silhouette: 'Hinged zigzag plates',
    cost: 15000,
    upgradeCost: 7500,
    range: 1000,
    cooldown: null,
    damage: 0,
    maxTargets: 0,
    laneOffsets: [],
    ignoresArmour: false,
    generation: 0,
    slowdownDivisor: 2,
    upgradedSlowdownDivisor: 4,
    effect: 'Divide affected speed by two; upgraded divides by four',
  },
  {
    id: 'prism',
    name: 'Salt Prism',
    silhouette: 'Faceted triangular beacon',
    cost: 35000,
    upgradeCost: 17500,
    range: 3000,
    cooldown: 15,
    damage: 9,
    maxTargets: 1,
    laneOffsets: [0],
    ignoresArmour: true,
    generation: 0,
    slowdownDivisor: null,
    upgradedSlowdownDivisor: null,
    effect: 'One same-lane hit for 9, ignoring armour',
  },
  {
    id: 'gong',
    name: 'Crosswake Gong',
    silhouette: 'Circular gong on branching stand',
    cost: 40000,
    upgradeCost: 20000,
    range: 2000,
    cooldown: 25,
    damage: 8,
    maxTargets: 1,
    laneOffsets: [-1, 0, 1],
    ignoresArmour: false,
    generation: 0,
    slowdownDivisor: null,
    upgradedSlowdownDivisor: null,
    effect: 'One hit for 8 among its lane and immediately adjacent lanes',
  },
];

export const DEVICE_IDS: string[] = DEVICES.map((d) => d.id);
const DEVICE_BY_ID = new Map(DEVICES.map((d) => [d.id, d]));

export function deviceSpec(id: string): DeviceSpec {
  const spec = DEVICE_BY_ID.get(id);
  if (spec === undefined) throw new Error(`unknown device ${id}`);
  return spec;
}

export function isDeviceId(id: string): boolean {
  return DEVICE_BY_ID.has(id);
}

export interface LaneChangeSpec {
  everyMovements: number;
  laneDelta: number;
  wrap: boolean;
}

export interface CreatureSpec {
  id: string;
  name: string;
  silhouette: string;
  health: number;
  speed: number;
  armour: number;
  laneChange: LaneChangeSpec | null;
  special: string;
}

export const CREATURES: CreatureSpec[] = [
  {
    id: 'mote',
    name: 'Foam Mote',
    silhouette: 'Ragged teardrop',
    health: 24,
    speed: 30,
    armour: 0,
    laneChange: null,
    special: 'No armour or lane change',
  },
  {
    id: 'shell',
    name: 'Shingleback',
    silhouette: 'Broad layered shell',
    health: 60,
    speed: 20,
    armour: 4,
    laneChange: null,
    special: 'Reduce ordinary hits by 4',
  },
  {
    id: 'skipper',
    name: 'Seam Skipper',
    silhouette: 'Split-finned crescent',
    health: 32,
    speed: 40,
    armour: 0,
    laneChange: { everyMovements: 40, laneDelta: 1, wrap: true },
    special: 'After every 40 movements increase lane by one, wrapping to the first',
  },
  {
    id: 'mass',
    name: 'Wreckmass',
    silhouette: 'Square driftwood knot',
    health: 120,
    speed: 15,
    armour: 0,
    laneChange: null,
    special: 'No armour or lane change',
  },
];

export const CREATURE_IDS: string[] = CREATURES.map((c) => c.id);
const CREATURE_BY_ID = new Map(CREATURES.map((c) => [c.id, c]));

export function creatureSpec(id: string): CreatureSpec {
  const spec = CREATURE_BY_ID.get(id);
  if (spec === undefined) throw new Error(`unknown creature ${id}`);
  return spec;
}

export function isCreatureId(id: string): boolean {
  return CREATURE_BY_ID.has(id);
}

function allCells(exclusions: [number, number][]): { lane: number; cell: number }[] {
  const excluded = new Set(exclusions.map(([lane, cell]) => `${lane}:${cell}`));
  const cells: { lane: number; cell: number }[] = [];
  for (let lane = 1; lane <= LANES; lane += 1) {
    for (let cell = 1; cell <= CELLS_PER_LANE; cell += 1) {
      if (!excluded.has(`${lane}:${cell}`)) cells.push({ lane, cell });
    }
  }
  return cells;
}

const STANDARD_EXCLUSIONS: [number, number][] = [
  [2, 4],
  [4, 6],
];

type WaveTuple = [number, string, number, number, number];

function waves(tuples: WaveTuple[]) {
  return tuples.map(([tick, creature, count, interval, lane]) => ({
    tick,
    creature,
    count,
    interval,
    lane,
  }));
}

export interface CampaignEncounter {
  id: string;
  title: string;
  definition: Definition;
}

interface CampaignSeedRow {
  id: string;
  title: string;
  topic: string;
  difficulty: Difficulty;
  seed: number;
  exclusions: [number, number][];
  waves: WaveTuple[];
}

const CAMPAIGN_SEED: CampaignSeedRow[] = [
  {
    id: 'c1',
    title: 'First Lantern',
    topic: 'Placement and forecast',
    difficulty: 'calm',
    seed: 1,
    exclusions: [],
    waves: [[0, 'mote', 5, 80, 3]],
  },
  {
    id: 'c2',
    title: 'Cup of Tide',
    topic: 'Charge generation',
    difficulty: 'calm',
    seed: 7,
    exclusions: [],
    waves: [
      [0, 'mote', 6, 60, 2],
      [200, 'mote', 5, 70, 4],
    ],
  },
  {
    id: 'c3',
    title: 'Bellwater',
    topic: 'Multiple targets',
    difficulty: 'calm',
    seed: 19,
    exclusions: [],
    waves: [
      [0, 'mote', 10, 30, 3],
      [240, 'mote', 6, 40, 1],
    ],
  },
  {
    id: 'c4',
    title: 'Shingle Reach',
    topic: 'Armour',
    difficulty: 'rough',
    seed: 31,
    exclusions: STANDARD_EXCLUSIONS,
    waves: [
      [0, 'shell', 6, 90, 3],
      [180, 'mote', 6, 50, 5],
    ],
  },
  {
    id: 'c5',
    title: 'Crossing Foam',
    topic: 'Lane changes',
    difficulty: 'rough',
    seed: 43,
    exclusions: STANDARD_EXCLUSIONS,
    waves: [
      [0, 'skipper', 8, 70, 2],
      [280, 'mote', 6, 50, 4],
    ],
  },
  {
    id: 'c6',
    title: 'Hinged Breakwater',
    topic: 'Delay and salvage',
    difficulty: 'rough',
    seed: 59,
    exclusions: STANDARD_EXCLUSIONS,
    waves: [
      [0, 'mass', 4, 140, 3],
      [240, 'shell', 6, 80, 1],
    ],
  },
  {
    id: 'c7',
    title: 'Storm Choir',
    topic: 'Mixed defence',
    difficulty: 'severe',
    seed: 73,
    exclusions: STANDARD_EXCLUSIONS,
    waves: [
      [0, 'mote', 12, 35, 0],
      [200, 'skipper', 8, 60, 0],
      [400, 'shell', 8, 80, 0],
    ],
  },
  {
    id: 'c8',
    title: 'Orrel Unbroken',
    topic: 'Complete strategy',
    difficulty: 'severe',
    seed: 97,
    exclusions: STANDARD_EXCLUSIONS,
    waves: [
      [0, 'mass', 6, 120, 0],
      [200, 'skipper', 10, 50, 0],
      [400, 'shell', 10, 70, 0],
    ],
  },
];

export const CAMPAIGN: CampaignEncounter[] = CAMPAIGN_SEED.map((row) => ({
  id: row.id,
  title: row.title,
  definition: {
    title: row.title,
    description: row.topic,
    difficulty: row.difficulty,
    seed: row.seed,
    buildable: allCells(row.exclusions),
    waves: waves(row.waves),
  },
}));

export function campaignEncounter(id: string): CampaignEncounter | undefined {
  return CAMPAIGN.find((e) => e.id === id);
}

export const DRAFT_DEFINITION: Definition = {
  title: 'Untitled harbour',
  description: '',
  difficulty: 'calm',
  seed: 101,
  buildable: allCells([]),
  waves: waves([[0, 'mote', 3, 80, 3]]),
};

export const DEFAULT_WAVE = { tick: 0, creature: 'mote', count: 3, interval: 80, lane: 3 };

export const DIFFICULTIES: Difficulty[] = ['calm', 'rough', 'severe'];

export const COMMAND_REASONS = [
  'Unknown command',
  'Command sequence is not increasing',
  'Command tick moved backwards',
  'Command follows terminal state',
  'Invalid cell',
  'Device is outside the loadout',
  'Cell is occupied',
  'No installed device',
  'Device is already upgraded',
  'Insufficient charge',
] as const;

export const NO_TERMINAL_REASON = 'Run has no terminal outcome';

export const TICK_ORDER = [
  'commands',
  'spawn',
  'move-and-change-lane',
  'prepare-attacks',
  'simultaneous-damage',
  'deaths',
  'generation',
  'breaches',
  'terminal-check',
] as const;
