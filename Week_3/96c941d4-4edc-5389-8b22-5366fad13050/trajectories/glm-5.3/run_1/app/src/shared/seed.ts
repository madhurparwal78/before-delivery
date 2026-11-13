// All gameplay constants, published limits, seed data and rule text in one module.

export type DeviceId = 'wick' | 'chime' | 'siphon' | 'wall' | 'prism' | 'gong';
export type CreatureId = 'mote' | 'shell' | 'skipper' | 'mass';
export type Difficulty = 'calm' | 'rough' | 'severe';

export interface DeviceSeed {
  id: DeviceId;
  name: string;
  silhouette: string;
  cost: number;        // milli-charge
  upgradeCost: number;  // milli-charge
  range: number | null;      // thousandth-cells
  cooldown: number | null;   // ticks
  damage: number;            // per-target base tier
  maxTargets: number;
  laneOffsets: number[];
  ignoresArmour: boolean;
  generation: number;        // milli-charge per boundary, base tier
  slowdownDivisor: number | null;
  upgradedSlowdownDivisor: number | null;
}

export const DEVICES: DeviceSeed[] = [
  { id: 'wick', name: 'Wickwarden', silhouette: 'narrow-tower-square-hood', cost: 20000, upgradeCost: 10000, range: 3500, cooldown: 10, damage: 12, maxTargets: 1, laneOffsets: [0], ignoresArmour: false, generation: 0, slowdownDivisor: null, upgradedSlowdownDivisor: null },
  { id: 'chime', name: 'Undertow Chime', silhouette: 'twin-hanging-bells', cost: 30000, upgradeCost: 15000, range: 2500, cooldown: 20, damage: 10, maxTargets: 2, laneOffsets: [0], ignoresArmour: false, generation: 0, slowdownDivisor: null, upgradedSlowdownDivisor: null },
  { id: 'siphon', name: 'Brine Siphon', silhouette: 'three-open-tide-cups', cost: 25000, upgradeCost: 12500, range: null, cooldown: null, damage: 0, maxTargets: 0, laneOffsets: [], ignoresArmour: false, generation: 3000, slowdownDivisor: null, upgradedSlowdownDivisor: null },
  { id: 'wall', name: 'Foldwall', silhouette: 'hinged-zigzag-plates', cost: 15000, upgradeCost: 7500, range: 1000, cooldown: null, damage: 0, maxTargets: 0, laneOffsets: [], ignoresArmour: false, generation: 0, slowdownDivisor: 2, upgradedSlowdownDivisor: 4 },
  { id: 'prism', name: 'Salt Prism', silhouette: 'faceted-triangular-beacon', cost: 35000, upgradeCost: 17500, range: 3000, cooldown: 15, damage: 9, maxTargets: 1, laneOffsets: [0], ignoresArmour: true, generation: 0, slowdownDivisor: null, upgradedSlowdownDivisor: null },
  { id: 'gong', name: 'Crosswake Gong', silhouette: 'circular-gong-branching-stand', cost: 40000, upgradeCost: 20000, range: 2000, cooldown: 25, damage: 8, maxTargets: 1, laneOffsets: [-1, 0, 1], ignoresArmour: false, generation: 0, slowdownDivisor: null, upgradedSlowdownDivisor: null },
];

export interface CreatureSeed {
  id: CreatureId;
  name: string;
  silhouette: string;
  health: number;
  speed: number; // thousandth-cells per tick
  armour: number;
  laneChange: { everyMovements: number; laneDelta: number; wrap: boolean } | null;
}

export const CREATURES: CreatureSeed[] = [
  { id: 'mote', name: 'Foam Mote', silhouette: 'ragged-teardrop', health: 24, speed: 30, armour: 0, laneChange: null },
  { id: 'shell', name: 'Shingleback', silhouette: 'broad-layered-shell', health: 60, speed: 20, armour: 4, laneChange: null },
  { id: 'skipper', name: 'Seam Skipper', silhouette: 'split-finned-crescent', health: 32, speed: 40, armour: 0, laneChange: { everyMovements: 40, laneDelta: 1, wrap: true } },
  { id: 'mass', name: 'Wreckmass', silhouette: 'square-driftwood-knot', health: 120, speed: 15, armour: 0, laneChange: null },
];

export const deviceById = (id: string): DeviceSeed | undefined => DEVICES.find((d) => d.id === id);
export const creatureById = (id: string): CreatureSeed | undefined => CREATURES.find((c) => c.id === id);
export const deviceOrder = (): DeviceId[] => DEVICES.map((d) => d.id);

export interface WaveTuple {
  tick: number;
  creature: CreatureId;
  count: number;
  interval: number;
  lane: number; // 0 = random each spawn
}

export interface Definition {
  title: string;
  description: string;
  difficulty: Difficulty;
  seed: number;
  buildable: Array<{ lane: number; cell: number }>;
  waves: WaveTuple[];
}

export const RULESET = 'orrel-1';

export const INITIAL_RESERVE = 120000;
export const INITIAL_HEALTH = 10;
export const HARBOUR_GENERATION = 1000;
export const GENERATION_PERIOD = 20;

export const CAMPAIGN_ORDER = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'] as const;
export type CampaignId = (typeof CAMPAIGN_ORDER)[number];

function buildableAll(): Array<{ lane: number; cell: number }> {
  const cells: Array<{ lane: number; cell: number }> = [];
  for (let lane = 1; lane <= 5; lane++) {
    for (let cell = 1; cell <= 9; cell++) cells.push({ lane, cell });
  }
  return cells;
}

function buildableWithExclusions(exclusions: Array<[number, number]>): Array<{ lane: number; cell: number }> {
  return buildableAll().filter((c) => !exclusions.some((e) => e[0] === c.lane && e[1] === c.cell));
}

export interface CampaignEncounter {
  id: CampaignId;
  title: string;
  teachingTopic: string;
  difficulty: Difficulty;
  seed: number;
  definition: Definition;
}

function encounter(
  id: CampaignId,
  title: string,
  difficulty: Difficulty,
  seed: number,
  exclusions: Array<[number, number]>,
  waves: WaveTuple[],
): CampaignEncounter {
  return {
    id,
    title,
    teachingTopic: title,
    difficulty,
    seed,
    definition: {
      title,
      description: title,
      difficulty,
      seed,
      buildable: exclusions.length ? buildableWithExclusions(exclusions) : buildableAll(),
      waves,
    },
  };
}

export const CAMPAIGN_ENCOUNTERS: CampaignEncounter[] = [
  encounter('c1', 'First Lantern', 'calm', 1, [], [{ tick: 0, creature: 'mote', count: 5, interval: 80, lane: 3 }]),
  encounter('c2', 'Cup of Tide', 'calm', 7, [], [
    { tick: 0, creature: 'mote', count: 6, interval: 60, lane: 2 },
    { tick: 200, creature: 'mote', count: 5, interval: 70, lane: 4 },
  ]),
  encounter('c3', 'Bellwater', 'calm', 19, [], [
    { tick: 0, creature: 'mote', count: 10, interval: 30, lane: 3 },
    { tick: 240, creature: 'mote', count: 6, interval: 40, lane: 1 },
  ]),
  encounter('c4', 'Shingle Reach', 'rough', 31, [[2, 4], [4, 6]], [
    { tick: 0, creature: 'shell', count: 6, interval: 90, lane: 3 },
    { tick: 180, creature: 'mote', count: 6, interval: 50, lane: 5 },
  ]),
  encounter('c5', 'Crossing Foam', 'rough', 43, [[2, 4], [4, 6]], [
    { tick: 0, creature: 'skipper', count: 8, interval: 70, lane: 2 },
    { tick: 280, creature: 'mote', count: 6, interval: 50, lane: 4 },
  ]),
  encounter('c6', 'Hinged Breakwater', 'rough', 59, [[2, 4], [4, 6]], [
    { tick: 0, creature: 'mass', count: 4, interval: 140, lane: 3 },
    { tick: 240, creature: 'shell', count: 6, interval: 80, lane: 1 },
  ]),
  encounter('c7', 'Storm Choir', 'severe', 73, [[2, 4], [4, 6]], [
    { tick: 0, creature: 'mote', count: 12, interval: 35, lane: 0 },
    { tick: 200, creature: 'skipper', count: 8, interval: 60, lane: 0 },
    { tick: 400, creature: 'shell', count: 8, interval: 80, lane: 0 },
  ]),
  encounter('c8', 'Orrel Unbroken', 'severe', 97, [[2, 4], [4, 6]], [
    { tick: 0, creature: 'mass', count: 6, interval: 120, lane: 0 },
    { tick: 200, creature: 'skipper', count: 10, interval: 50, lane: 0 },
    { tick: 400, creature: 'shell', count: 10, interval: 70, lane: 0 },
  ]),
];

export function campaignById(id: string): CampaignEncounter | undefined {
  return CAMPAIGN_ENCOUNTERS.find((c) => c.id === id);
}

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
export type CommandReason = (typeof COMMAND_REASONS)[number];

export const MISSING_TERMINAL_REASON = 'Run has no terminal outcome';

// Published inclusive bounds.
export const LIMITS = {
  lanes: 5,
  cellsPerLane: 9,
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
  maxWaveLane: 5,
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

export const DRAFT_DEFAULTS = {
  title: 'Untitled harbour',
  description: '',
  difficulty: 'calm' as Difficulty,
  seed: 101,
  wave: { tick: 0, creature: 'mote' as CreatureId, count: 3, interval: 80, lane: 3 },
};

export const SEASON = {
  timeZone: 'Asia/Kathmandu',
  utcOffset: '+05:45',
  dayStart: '05:00',
  dayFormat: 'YYYY-MM-DD',
  selectionEpoch: '1970-01-01',
  refreshSeconds: 30,
};
