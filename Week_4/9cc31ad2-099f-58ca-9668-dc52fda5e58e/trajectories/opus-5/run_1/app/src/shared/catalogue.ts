export type Lane = 'left' | 'middle' | 'right';
export type CarClass = 'D' | 'C' | 'B';
export type SystemName = 'engine' | 'tires' | 'brakes' | 'suspension';
export type LayoutId = 'saltflat-ring' | 'quarry-switchbacks';
export type RaceMode = 'practice' | 'circuit' | 'drift' | 'time-trial';
export type BoardMode = 'time-trial' | 'circuit' | 'drift';

export interface CarStats {
  accelMps2: number;
  brakeMps2: number;
  topMps: number;
  gripPct: number;
  laneChangeSteps: number;
}

export interface StageMap {
  engine: number;
  tires: number;
  brakes: number;
  suspension: number;
}

export interface CarSpec {
  carId: string;
  name: string;
  class: CarClass;
  pi: number;
  price: number | null;
  starter: boolean;
  stats: CarStats;
}

export interface Corner {
  start: number;
  end: number;
  limitMps: number;
  driftWeight: number;
}

export interface Sector {
  start: number;
  end: number;
}

export interface CoinSpot {
  distance: number;
  lane: Lane;
}

export interface LayoutSpec {
  layoutId: LayoutId;
  name: string;
  lengthM: number;
  corners: Corner[];
  sectors: [Sector, Sector, Sector];
  coins: CoinSpot[];
}

export const STEPS_PER_SECOND = 60;
export const OPENING_BALANCE = 1000;
export const INVALID_LAP_OFF_TRACK_STEPS = 60;
export const DRIFT_STEP_LIMIT = 5400;
export const STEPS_PER_LAP_LIMIT = 7200;
export const LEAGUE_TARGET_POINTS = 50;
export const FINALS_REWARD_COINS = 1000;
export const BOARD_SIZE = 50;
export const MAX_INPUT_EVENTS = 2000;
export const MAX_REPLAY_DEPTH = 4;
export const MAX_HUMANS_PER_LOBBY = 2;
export const LOBBY_COUNTDOWN_SECONDS = 3;

export const CLASS_LIMITS: Record<CarClass, { min: number; max: number }> = {
  D: { min: 100, max: 299 },
  C: { min: 300, max: 499 },
  B: { min: 500, max: 699 },
};

export const CARS: CarSpec[] = [
  {
    carId: 'kestrel-hatch',
    name: 'Kestrel Hatch',
    class: 'D',
    pi: 220,
    price: null,
    starter: true,
    stats: { accelMps2: 4.0, brakeMps2: 8.0, topMps: 45, gripPct: 100, laneChangeSteps: 30 },
  },
  {
    carId: 'wren-coupe',
    name: 'Wren Coupe',
    class: 'D',
    pi: 230,
    price: null,
    starter: true,
    stats: { accelMps2: 3.6, brakeMps2: 8.5, topMps: 47, gripPct: 102, laneChangeSteps: 30 },
  },
  {
    carId: 'moth-roadster',
    name: 'Moth Roadster',
    class: 'D',
    pi: 215,
    price: null,
    starter: true,
    stats: { accelMps2: 4.2, brakeMps2: 7.5, topMps: 43, gripPct: 98, laneChangeSteps: 24 },
  },
  {
    carId: 'halcyon-rs',
    name: 'Halcyon RS',
    class: 'C',
    pi: 360,
    price: 4000,
    starter: false,
    stats: { accelMps2: 5.0, brakeMps2: 9.0, topMps: 52, gripPct: 106, laneChangeSteps: 24 },
  },
  {
    carId: 'ferrule-sport',
    name: 'Ferrule Sport',
    class: 'C',
    pi: 380,
    price: 5500,
    starter: false,
    stats: { accelMps2: 5.4, brakeMps2: 8.8, topMps: 54, gripPct: 104, laneChangeSteps: 24 },
  },
  {
    carId: 'vantor-8',
    name: 'Vantor 8',
    class: 'B',
    pi: 560,
    price: 12000,
    starter: false,
    stats: { accelMps2: 6.2, brakeMps2: 10.0, topMps: 60, gripPct: 110, laneChangeSteps: 18 },
  },
];

export const STARTER_CAR_IDS = ['kestrel-hatch', 'wren-coupe', 'moth-roadster'] as const;

export function findCar(carId: string): CarSpec | undefined {
  return CARS.find((car) => car.carId === carId);
}

export function carSpec(carId: string): CarSpec {
  const car = findCar(carId);
  if (!car) throw new Error(`unknown car ${carId}`);
  return car;
}

export const LAYOUTS: Record<LayoutId, LayoutSpec> = {
  'saltflat-ring': {
    layoutId: 'saltflat-ring',
    name: 'Saltflat Ring',
    lengthM: 1200,
    corners: [
      { start: 300, end: 380, limitMps: 22, driftWeight: 1.0 },
      { start: 600, end: 660, limitMps: 14, driftWeight: 1.5 },
      { start: 1000, end: 1200, limitMps: 28, driftWeight: 1.2 },
    ],
    sectors: [
      { start: 0, end: 380 },
      { start: 380, end: 660 },
      { start: 660, end: 1200 },
    ],
    coins: [
      { distance: 120, lane: 'middle' },
      { distance: 200, lane: 'middle' },
      { distance: 340, lane: 'left' },
      { distance: 450, lane: 'right' },
      { distance: 520, lane: 'right' },
      { distance: 640, lane: 'left' },
      { distance: 800, lane: 'middle' },
      { distance: 1100, lane: 'middle' },
    ],
  },
  'quarry-switchbacks': {
    layoutId: 'quarry-switchbacks',
    name: 'Quarry Switchbacks',
    lengthM: 1000,
    corners: [
      { start: 200, end: 260, limitMps: 12, driftWeight: 1.5 },
      { start: 480, end: 560, limitMps: 16, driftWeight: 1.3 },
      { start: 800, end: 1000, limitMps: 20, driftWeight: 1.0 },
    ],
    sectors: [
      { start: 0, end: 260 },
      { start: 260, end: 560 },
      { start: 560, end: 1000 },
    ],
    coins: [
      { distance: 100, lane: 'middle' },
      { distance: 230, lane: 'left' },
      { distance: 400, lane: 'middle' },
      { distance: 520, lane: 'right' },
      { distance: 700, lane: 'middle' },
      { distance: 900, lane: 'left' },
    ],
  },
};

export const LAYOUT_IDS: LayoutId[] = ['saltflat-ring', 'quarry-switchbacks'];

export function isLayoutId(value: unknown): value is LayoutId {
  return value === 'saltflat-ring' || value === 'quarry-switchbacks';
}

export const SYSTEMS: SystemName[] = ['engine', 'tires', 'brakes', 'suspension'];

export const SYSTEM_LABELS: Record<SystemName, string> = {
  engine: 'Engine',
  tires: 'Tires',
  brakes: 'Brakes',
  suspension: 'Suspension',
};

export const STAGE_PRICES: Record<CarClass, [number, number, number]> = {
  D: [300, 700, 1500],
  C: [600, 1400, 3000],
  B: [1000, 2400, 5000],
};

export const MAX_STAGE = 3;

export const STAGE_PI: Record<SystemName, number> = {
  engine: 20,
  tires: 15,
  brakes: 10,
  suspension: 5,
};

export function stagePrice(carClass: CarClass, stage: number): number {
  const prices = STAGE_PRICES[carClass];
  const price = prices[stage - 1];
  if (price === undefined) throw new Error(`no price for stage ${stage}`);
  return price;
}

export function statsWithStages(carId: string, stages: StageMap): CarStats {
  const base = carSpec(carId).stats;
  return {
    accelMps2: base.accelMps2 + 1.0 * stages.engine,
    brakeMps2: base.brakeMps2 + 1.5 * stages.brakes,
    topMps: base.topMps + 2 * stages.engine,
    gripPct: base.gripPct + 4 * stages.tires,
    laneChangeSteps: Math.max(6, base.laneChangeSteps - 6 * stages.suspension),
  };
}

export function piWithStages(carId: string, stages: StageMap): number {
  const base = carSpec(carId).pi;
  return (
    base +
    STAGE_PI.engine * stages.engine +
    STAGE_PI.tires * stages.tires +
    STAGE_PI.brakes * stages.brakes +
    STAGE_PI.suspension * stages.suspension
  );
}

export function overClassLimit(carId: string, stages: StageMap): boolean {
  const car = carSpec(carId);
  return piWithStages(carId, stages) > CLASS_LIMITS[car.class].max;
}

export function isEligible(carId: string, stages: StageMap, eventClass: CarClass): boolean {
  const car = carSpec(carId);
  if (car.class !== eventClass) return false;
  const pi = piWithStages(carId, stages);
  const limits = CLASS_LIMITS[eventClass];
  return pi >= limits.min && pi <= limits.max;
}

export const LOANER_CAR_BY_CLASS: Record<CarClass, string> = {
  D: 'kestrel-hatch',
  C: 'halcyon-rs',
  B: 'vantor-8',
};

export type LeagueId = 'rookie' | 'club';

export interface EventSpec {
  eventId: string;
  name: string;
  leagueId: LeagueId | null;
  mode: RaceMode;
  layoutId: LayoutId;
  class: CarClass | null;
  laps: number;
  aiCarId: string | null;
}

export const EVENTS: EventSpec[] = [
  {
    eventId: 'rookie-circuit',
    name: 'Rookie Circuit',
    leagueId: 'rookie',
    mode: 'circuit',
    layoutId: 'saltflat-ring',
    class: 'D',
    laps: 3,
    aiCarId: 'kestrel-hatch',
  },
  {
    eventId: 'rookie-drift',
    name: 'Rookie Drift',
    leagueId: 'rookie',
    mode: 'drift',
    layoutId: 'saltflat-ring',
    class: 'D',
    laps: 1,
    aiCarId: null,
  },
  {
    eventId: 'rookie-time-trial',
    name: 'Rookie Time Trial',
    leagueId: 'rookie',
    mode: 'time-trial',
    layoutId: 'saltflat-ring',
    class: 'D',
    laps: 3,
    aiCarId: null,
  },
  {
    eventId: 'club-circuit',
    name: 'Club Circuit',
    leagueId: 'club',
    mode: 'circuit',
    layoutId: 'quarry-switchbacks',
    class: 'C',
    laps: 3,
    aiCarId: 'halcyon-rs',
  },
  {
    eventId: 'club-time-trial',
    name: 'Club Time Trial',
    leagueId: 'club',
    mode: 'time-trial',
    layoutId: 'quarry-switchbacks',
    class: 'C',
    laps: 3,
    aiCarId: null,
  },
  {
    eventId: 'guided-first-race',
    name: 'Guided first race',
    leagueId: null,
    mode: 'practice',
    layoutId: 'saltflat-ring',
    class: null,
    laps: 1,
    aiCarId: null,
  },
];

export function findEvent(eventId: string): EventSpec | undefined {
  return EVENTS.find((event) => event.eventId === eventId);
}

export const LEAGUE_IDS: LeagueId[] = ['rookie', 'club'];

export const LEAGUE_NAMES: Record<LeagueId, string> = {
  rookie: 'Rookie league',
  club: 'Club league',
};

export const AI_DRIVERS = [
  { name: 'Pip Marlowe', paceFactor: 1.15, grade: 'Rookie' as const },
  { name: 'Isa Corrow', paceFactor: 1.04, grade: 'Pro' as const },
];

export const LOBBY_AI_NAMES = ['Rookie AI 1', 'Rookie AI 2'];
export const LOBBY_LAYOUT: LayoutId = 'saltflat-ring';
export const LOBBY_LAPS = 1;
export const LOBBY_AI_CAR_ID = 'kestrel-hatch';
export const LOBBY_AI_PACE_FACTOR = 1.15;

export function defaultLaps(mode: RaceMode): number {
  if (mode === 'circuit') return 3;
  if (mode === 'time-trial') return 3;
  return 1;
}

export function lapsAllowed(mode: RaceMode, laps: number): boolean {
  if (mode === 'practice' || mode === 'time-trial') return laps >= 1 && laps <= 5;
  if (mode === 'circuit') return laps === 3;
  return laps === 1;
}

export function stepLimitFor(mode: RaceMode, laps: number): number {
  return mode === 'drift' ? DRIFT_STEP_LIMIT : laps * STEPS_PER_LAP_LIMIT;
}

export function isBoardMode(mode: string): mode is BoardMode {
  return mode === 'time-trial' || mode === 'circuit' || mode === 'drift';
}
