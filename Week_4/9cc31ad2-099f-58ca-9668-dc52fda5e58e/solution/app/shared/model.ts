// The one Kerbline race model. The browser race, the ghost, the lobby race and the server's
// verification all step cars through `step` with the constants defined here.

export const STEPS_PER_SECOND = 60;
export const STEP_LIMIT_PER_LAP = 7200;
export const MAX_INPUT_EVENTS = 2000;
const DRIFT_STEP_LIMIT = 5400;
const COAST_DECEL = 0.5;
const DRIFT_DECEL = 1.0;
const OFF_TRACK_MARGIN = 0.5;
const OFF_TRACK_SPEED = 8;
const INVALID_LAP_OFF_TRACK_STEPS = 60;
const COIN_BASE = 5;
const COIN_STREAK_CAP = 5;
const DRIFT_MIN_SPEED = 10;
const DRIFT_MULTIPLIER_STEPS = 60;
const DRIFT_MULTIPLIER_CAP = 5;
const MIN_LANE_CHANGE_STEPS = 6;

export type Lane = "left" | "middle" | "right";
export const LANES: readonly Lane[] = ["left", "middle", "right"];

export type LayoutId = "saltflat-ring" | "quarry-switchbacks";
export type Mode = "practice" | "circuit" | "drift" | "time-trial";
export type CarClass = "D" | "C" | "B";
export type System = "engine" | "tires" | "brakes" | "suspension";
export const SYSTEMS: readonly System[] = ["engine", "tires", "brakes", "suspension"];
export const MAX_STAGE = 3;

interface Corner {
  readonly start: number;
  readonly end: number;
  readonly limit: number;
  readonly weight: number;
}

export interface Coin {
  readonly at: number;
  readonly lane: Lane;
}

export interface Layout {
  readonly id: LayoutId;
  readonly name: string;
  readonly length: number;
  readonly corners: readonly Corner[];
  readonly sectorEnds: readonly [number, number, number];
  readonly coins: readonly Coin[];
}

export const LAYOUTS: Readonly<Record<LayoutId, Layout>> = {
  "saltflat-ring": {
    id: "saltflat-ring",
    name: "Saltflat Ring",
    length: 1200,
    corners: [
      { start: 300, end: 380, limit: 22, weight: 1.0 },
      { start: 600, end: 660, limit: 14, weight: 1.5 },
      { start: 1000, end: 1200, limit: 28, weight: 1.2 },
    ],
    sectorEnds: [380, 660, 1200],
    coins: [
      { at: 120, lane: "middle" },
      { at: 200, lane: "middle" },
      { at: 340, lane: "left" },
      { at: 450, lane: "right" },
      { at: 520, lane: "right" },
      { at: 640, lane: "left" },
      { at: 800, lane: "middle" },
      { at: 1100, lane: "middle" },
    ],
  },
  "quarry-switchbacks": {
    id: "quarry-switchbacks",
    name: "Quarry Switchbacks",
    length: 1000,
    corners: [
      { start: 200, end: 260, limit: 12, weight: 1.5 },
      { start: 480, end: 560, limit: 16, weight: 1.3 },
      { start: 800, end: 1000, limit: 20, weight: 1.0 },
    ],
    sectorEnds: [260, 560, 1000],
    coins: [
      { at: 100, lane: "middle" },
      { at: 230, lane: "left" },
      { at: 400, lane: "middle" },
      { at: 520, lane: "right" },
      { at: 700, lane: "middle" },
      { at: 900, lane: "left" },
    ],
  },
};

export const LAYOUT_IDS = Object.keys(LAYOUTS) as LayoutId[];

export interface CarStats {
  readonly accelMps2: number;
  readonly brakeMps2: number;
  readonly topMps: number;
  readonly gripPct: number;
  readonly laneChangeSteps: number;
}

interface CarModel {
  readonly carId: string;
  readonly name: string;
  readonly class: CarClass;
  readonly stats: CarStats;
  readonly pi: number;
  readonly price: number | null;
}

export const CARS: readonly CarModel[] = [
  { carId: "kestrel-hatch", name: "Kestrel Hatch", class: "D", pi: 220, price: null,
    stats: { accelMps2: 4.0, brakeMps2: 8.0, topMps: 45, gripPct: 100, laneChangeSteps: 30 } },
  { carId: "wren-coupe", name: "Wren Coupe", class: "D", pi: 230, price: null,
    stats: { accelMps2: 3.6, brakeMps2: 8.5, topMps: 47, gripPct: 102, laneChangeSteps: 30 } },
  { carId: "moth-roadster", name: "Moth Roadster", class: "D", pi: 215, price: null,
    stats: { accelMps2: 4.2, brakeMps2: 7.5, topMps: 43, gripPct: 98, laneChangeSteps: 24 } },
  { carId: "halcyon-rs", name: "Halcyon RS", class: "C", pi: 360, price: 4000,
    stats: { accelMps2: 5.0, brakeMps2: 9.0, topMps: 52, gripPct: 106, laneChangeSteps: 24 } },
  { carId: "ferrule-sport", name: "Ferrule Sport", class: "C", pi: 380, price: 5500,
    stats: { accelMps2: 5.4, brakeMps2: 8.8, topMps: 54, gripPct: 104, laneChangeSteps: 24 } },
  { carId: "vantor-8", name: "Vantor 8", class: "B", pi: 560, price: 12000,
    stats: { accelMps2: 6.2, brakeMps2: 10.0, topMps: 60, gripPct: 110, laneChangeSteps: 18 } },
];

export const CLASS_PI: Readonly<Record<CarClass, { readonly min: number; readonly max: number }>> = {
  D: { min: 100, max: 299 },
  C: { min: 300, max: 499 },
  B: { min: 500, max: 699 },
};

export const STAGE_PRICES: Readonly<Record<CarClass, readonly [number, number, number]>> = {
  D: [300, 700, 1500],
  C: [600, 1400, 3000],
  B: [1000, 2400, 5000],
};

const STAGE_EFFECTS = {
  engine: { accelMps2: 1.0, topMps: 2, pi: 20 },
  tires: { gripPct: 4, pi: 15 },
  brakes: { brakeMps2: 1.5, pi: 10 },
  suspension: { laneChangeSteps: -6, pi: 5 },
} as const;

export type Stages = Record<System, number>;

export const STOCK: Readonly<Stages> = { engine: 0, tires: 0, brakes: 0, suspension: 0 };

export function carModel(carId: string): CarModel | undefined {
  return CARS.find((car) => car.carId === carId);
}

export function tunedStats(base: CarStats, stages: Stages): CarStats {
  return {
    accelMps2: base.accelMps2 + stages.engine * STAGE_EFFECTS.engine.accelMps2,
    brakeMps2: base.brakeMps2 + stages.brakes * STAGE_EFFECTS.brakes.brakeMps2,
    topMps: base.topMps + stages.engine * STAGE_EFFECTS.engine.topMps,
    gripPct: base.gripPct + stages.tires * STAGE_EFFECTS.tires.gripPct,
    laneChangeSteps: Math.max(MIN_LANE_CHANGE_STEPS,
      base.laneChangeSteps + stages.suspension * STAGE_EFFECTS.suspension.laneChangeSteps),
  };
}

export function tunedPi(base: number, stages: Stages): number {
  return base + SYSTEMS.reduce((sum, system) => sum + stages[system] * STAGE_EFFECTS[system].pi, 0);
}

export function overClassLimit(carClass: CarClass, pi: number): boolean {
  return pi > CLASS_PI[carClass].max;
}

export function stagePrice(carClass: CarClass, stage: number): number {
  return STAGE_PRICES[carClass][stage - 1];
}

export const DEFAULT_LAPS: Readonly<Record<Mode, number>> = { practice: 1, circuit: 3, drift: 1, "time-trial": 3 };
export const MAX_LAPS = 5;

export function stepLimit(mode: Mode, laps: number): number {
  return mode === "drift" ? DRIFT_STEP_LIMIT : laps * STEP_LIMIT_PER_LAP;
}

export function stepsToMs(steps: number): number {
  return Math.round((steps * 1000) / STEPS_PER_SECOND);
}

export interface Input {
  readonly throttle: 0 | 1;
  readonly brake: 0 | 1;
  readonly drift: 0 | 1;
  readonly lane: Lane;
}

export interface InputEvent extends Input {
  readonly step: number;
}

export const IDLE_INPUT: Input = { throttle: 0, brake: 0, drift: 0, lane: "middle" };

export interface LapResult {
  lapMs: number;
  valid: boolean;
  offTrackSteps: number;
  sectorsMs: [number, number, number];
}

interface StepOutcome {
  readonly lapCompleted: LapResult | null;
  readonly finished: boolean;
}

// The state of one car in one run. Created per run, never shared.
export interface CarState {
  readonly layout: Layout;
  readonly stats: CarStats;
  readonly laps: number;
  readonly mode: Mode | "online";
  steps: number;
  position: number;
  speed: number;
  lapsCompleted: number;
  lane: number;
  change: { target: number; done: number } | null;
  offCorner: Corner | null;
  lapOffTrack: number;
  lapStartStep: number;
  sectorIndex: number;
  sectorStartStep: number;
  sectorsMs: number[];
  lapResults: LapResult[];
  streak: number;
  coins: number;
  driftRun: number;
  driftScore: number;
  topSpeed: number;
  clean: boolean;
  finished: boolean;
}

export function createCar(layout: Layout, stats: CarStats, mode: Mode | "online", laps: number): CarState {
  return {
    layout, stats, laps, mode,
    steps: 0, position: 0, speed: 0, lapsCompleted: 0, lane: 1, change: null, offCorner: null,
    lapOffTrack: 0, lapStartStep: 0, sectorIndex: 0, sectorStartStep: 0, sectorsMs: [], lapResults: [],
    streak: 0, coins: 0, driftRun: 0, driftScore: 0, topSpeed: 0, clean: true, finished: false,
  };
}

function cornerAt(layout: Layout, position: number): Corner | null {
  return layout.corners.find((corner) => corner.start <= position && position < corner.end) ?? null;
}

function effectiveLimit(corner: Corner, stats: CarStats): number {
  return (corner.limit * stats.gripPct) / 100;
}

function collectCoins(car: CarState, from: number, to: number): void {
  for (const coin of car.layout.coins) {
    if (from < coin.at && coin.at <= to) {
      if (car.change === null && LANES[car.lane] === coin.lane) {
        car.streak += 1;
        car.coins += COIN_BASE + Math.min(car.streak - 1, COIN_STREAK_CAP);
      } else {
        car.streak = 0;
      }
    }
  }
}

function endSector(car: CarState): void {
  car.sectorsMs.push(stepsToMs(car.steps) - stepsToMs(car.sectorStartStep));
  car.sectorStartStep = car.steps;
  car.sectorIndex += 1;
}

// One step of the published race model, in the published order.
export function step(car: CarState, input: Input): StepOutcome {
  const { stats, layout } = car;
  let speed = car.speed;
  if (input.throttle) speed += stats.accelMps2 / STEPS_PER_SECOND;
  if (input.brake) speed -= stats.brakeMps2 / STEPS_PER_SECOND;
  if (!input.throttle && !input.brake) speed -= COAST_DECEL / STEPS_PER_SECOND;
  if (input.drift) speed -= DRIFT_DECEL / STEPS_PER_SECOND;
  speed = Math.min(Math.max(speed, 0), stats.topMps);

  const previous = car.position;
  const advanced = previous + speed / STEPS_PER_SECOND;
  car.steps += 1;

  while (car.sectorIndex < 2 && advanced >= layout.sectorEnds[car.sectorIndex]) endSector(car);

  let lapCompleted: LapResult | null = null;
  let position = advanced;
  const lapEnded = advanced >= layout.length;
  if (lapEnded) {
    endSector(car);
    position = advanced - layout.length;
  }

  const corner = cornerAt(layout, position);
  let offTrackStep = false;
  if (corner && (speed > effectiveLimit(corner, stats) + OFF_TRACK_MARGIN || car.offCorner === corner)) {
    offTrackStep = true;
    car.offCorner = corner;
    speed = Math.min(speed, OFF_TRACK_SPEED);
  } else if (car.offCorner !== corner) {
    car.offCorner = null;
  }

  if (lapEnded) {
    const [s1, s2, s3] = car.sectorsMs;
    lapCompleted = {
      lapMs: stepsToMs(car.steps) - stepsToMs(car.lapStartStep),
      valid: car.lapOffTrack < INVALID_LAP_OFF_TRACK_STEPS,
      offTrackSteps: car.lapOffTrack,
      sectorsMs: [s1, s2, s3],
    };
    car.lapResults.push(lapCompleted);
    car.lapsCompleted += 1;
    car.lapStartStep = car.steps;
    car.lapOffTrack = 0;
    car.sectorIndex = 0;
    car.sectorStartStep = car.steps;
    car.sectorsMs = [];
  }
  if (offTrackStep) {
    car.lapOffTrack += 1;
    car.clean = false;
  }

  if (car.change && car.change.done >= stats.laneChangeSteps) {
    car.lane = car.change.target;
    car.change = null;
  }
  const wanted = LANES.indexOf(input.lane);
  if (!car.change && wanted !== car.lane) car.change = { target: car.lane + Math.sign(wanted - car.lane), done: 0 };
  if (car.change) car.change.done += 1;

  if (car.mode === "practice" || car.mode === "circuit") {
    if (lapEnded) {
      collectCoins(car, previous, layout.length);
      collectCoins(car, 0, position);
    } else {
      collectCoins(car, previous, position);
    }
  }

  if (input.drift && speed >= DRIFT_MIN_SPEED && corner) {
    car.driftRun += 1;
    const multiplier = Math.min(1 + Math.floor((car.driftRun - 1) / DRIFT_MULTIPLIER_STEPS), DRIFT_MULTIPLIER_CAP);
    car.driftScore += Math.floor(speed * corner.weight) * multiplier;
  } else {
    car.driftRun = 0;
  }

  car.speed = speed;
  car.position = position;
  car.topSpeed = Math.max(car.topSpeed, speed);
  car.finished = car.lapsCompleted >= car.laps || (car.mode === "drift" && car.steps >= DRIFT_STEP_LIMIT);
  return { lapCompleted, finished: car.finished };
}

// Distance covered since the start line of lap 1.
export function distance(car: CarState): number {
  return car.lapsCompleted * car.layout.length + car.position;
}

// Laps-in-progress validity: a drift stage that ends on its timer judges its unfinished lap too.
export function openLapInvalid(car: CarState): boolean {
  return car.lapOffTrack >= INVALID_LAP_OFF_TRACK_STEPS;
}

// The reference driver's pedals, chosen from the position and speed at the start of the step.
function referencePedals(car: CarState): Pick<Input, "throttle" | "brake"> {
  const { layout, stats, position, speed } = car;
  const inside = cornerAt(layout, position);
  if (inside) return { throttle: speed < effectiveLimit(inside, stats) ? 1 : 0, brake: 0 };
  const ahead = layout.corners.find((corner) => corner.start > position);
  const next = ahead ?? layout.corners[0];
  const gap = ahead ? next.start - position : layout.length - position + next.start;
  const limit = effectiveLimit(next, stats);
  const braking = speed > limit && gap <= (speed * speed - limit * limit) / (2 * stats.brakeMps2) + speed / 30;
  return braking ? { throttle: 0, brake: 1 } : { throttle: 1, brake: 0 };
}

export function referenceInputs(layout: Layout, stats: CarStats, mode: Mode, laps: number): InputEvent[] {
  const car = createCar(layout, stats, mode, laps);
  const limit = stepLimit(mode, laps);
  const events: InputEvent[] = [];
  while (!car.finished && car.steps < limit) {
    const pedals = referencePedals(car);
    const last = events[events.length - 1];
    if (!last || last.throttle !== pedals.throttle || last.brake !== pedals.brake) {
      events.push({ step: car.steps, ...pedals, drift: 0, lane: "middle" });
    }
    step(car, { ...pedals, drift: 0, lane: "middle" });
  }
  return events;
}

// Drives a car through an input list until it finishes or reaches the step limit; `observe`
// sees every step's outcome.
export function simulate(car: CarState, inputs: readonly InputEvent[], limit: number,
  observe?: (outcome: StepOutcome) => void): CarState {
  let next = 0;
  let current: Input = IDLE_INPUT;
  while (!car.finished && car.steps < limit) {
    while (next < inputs.length && inputs[next].step <= car.steps) current = inputs[next++];
    const outcome = step(car, current);
    observe?.(outcome);
  }
  return car;
}

interface ReferenceLap {
  lapMs: number;
  sectorsMs: [number, number, number];
}

export function referenceLap(layout: Layout, stats: CarStats): ReferenceLap {
  const car = createCar(layout, stats, "practice", 1);
  simulate(car, referenceInputs(layout, stats, "practice", 1), STEP_LIMIT_PER_LAP);
  const lap = car.lapResults[0];
  return { lapMs: lap.lapMs, sectorsMs: lap.sectorsMs };
}

// AI drivers: the reference driver slowed by a pace factor, written in hundredths.
interface AiDriver {
  readonly name: string;
  readonly pacePercent: number;
}

export const AI_DRIVERS: readonly AiDriver[] = [
  { name: "Pip Marlowe", pacePercent: 115 },
  { name: "Isa Corrow", pacePercent: 104 },
];
export const LOBBY_AI_PACE_PERCENT = 115;

// The reference driver's distance after each completed step, for an AI car.
export interface AiTrack {
  readonly distances: Float64Array;
  readonly finishSteps: number;
  readonly pacePercent: number;
}

export function aiTrack(layout: Layout, stats: CarStats, laps: number, pacePercent: number): AiTrack {
  const car = createCar(layout, stats, "circuit", laps);
  const limit = laps * STEP_LIMIT_PER_LAP;
  const distances = [0];
  while (!car.finished && car.steps < limit) {
    step(car, { ...referencePedals(car), drift: 0, lane: "middle" });
    distances.push(distance(car));
  }
  const refSteps = car.finished ? car.steps : Number.POSITIVE_INFINITY;
  return {
    distances: Float64Array.from(distances),
    finishSteps: Math.ceil((refSteps * pacePercent) / 100 - 1e-9),
    pacePercent,
  };
}

export function aiDistanceAt(track: AiTrack, raceSteps: number): number {
  const refStep = Math.floor((raceSteps * 100) / track.pacePercent);
  return track.distances[Math.min(refStep, track.distances.length - 1)];
}

// Live ranking: finished cars by finish steps first, then laps completed and distance into the lap.
// Ties go to the earlier entry in the list (the player is listed first).
interface Standing {
  readonly finishSteps: number | null;
  readonly distance: number;
}

export function rankStandings(standings: readonly Standing[]): number[] {
  const order = standings.map((_, index) => index).sort((a, b) => {
    const x = standings[a];
    const y = standings[b];
    if (x.finishSteps !== null && y.finishSteps !== null) return x.finishSteps - y.finishSteps || a - b;
    if (x.finishSteps !== null) return -1;
    if (y.finishSteps !== null) return 1;
    return y.distance - x.distance || a - b;
  });
  const positions = new Array<number>(standings.length);
  order.forEach((index, rank) => { positions[index] = rank + 1; });
  return positions;
}
