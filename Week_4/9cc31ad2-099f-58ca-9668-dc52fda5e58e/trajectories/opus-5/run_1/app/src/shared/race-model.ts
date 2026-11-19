import {
  type CarStats,
  type Corner,
  type Lane,
  type LayoutSpec,
  type RaceMode,
  DRIFT_STEP_LIMIT,
  INVALID_LAP_OFF_TRACK_STEPS,
  STEPS_PER_SECOND,
} from './catalogue.js';

export interface InputState {
  throttle: 0 | 1;
  brake: 0 | 1;
  drift: 0 | 1;
  lane: Lane;
}

export interface InputEvent extends InputState {
  step: number;
}

export interface LapResult {
  lapMs: number;
  valid: boolean;
  offTrackSteps: number;
  sectorsMs: [number, number, number];
}

export interface StepOutcome {
  lap: LapResult | null;
  coinsGained: number;
  offTrack: boolean;
}

export const LANES: Lane[] = ['left', 'middle', 'right'];
export const COAST_DECEL = 0.5;
export const DRIFT_DECEL = 1.0;
export const OFF_TRACK_TOLERANCE_MPS = 0.5;
export const OFF_TRACK_SPEED_CAP_MPS = 8;
export const DRIFT_MIN_SPEED_MPS = 10;
export const DRIFT_MULTIPLIER_STEPS = 60;
export const DRIFT_MAX_MULTIPLIER = 5;
export const COIN_BASE_VALUE = 5;
export const COIN_MAX_BONUS = 5;

export function stepsToMs(steps: number): number {
  return Math.round((steps * 1000) / STEPS_PER_SECOND);
}

export function effectiveLimit(corner: Corner, gripPct: number): number {
  return (corner.limitMps * gripPct) / 100;
}

export function cornerIndexAt(layout: LayoutSpec, lapPos: number): number {
  return layout.corners.findIndex((corner) => lapPos >= corner.start && lapPos < corner.end);
}

export interface RunConfig {
  layout: LayoutSpec;
  stats: CarStats;
  mode: RaceMode;
  laps: number;
  stepLimit: number;
}

/** One car driven through the deterministic race model. Created per run, never shared. */
export class CarSim {
  readonly config: RunConfig;
  speed = 0;
  lapPos = 0;
  totalDistance = 0;
  lapsCompleted = 0;
  stepsCompleted = 0;
  lane: Lane = 'middle';
  topSpeedMps = 0;
  coinsCollected = 0;
  driftScore = 0;
  offTrackStepsTotal = 0;
  readonly lapResults: LapResult[] = [];
  readonly distanceByStep: number[] = [0];

  private laneChangeStepsLeft = 0;
  private laneChangeTarget: Lane = 'middle';
  private offTrackCorner: number | null = null;
  private offTrackStepsThisLap = 0;
  private lapStartSteps = 0;
  private sectorIndex = 0;
  private sectorStartSteps = 0;
  private sectorsMs: number[] = [];
  private coinStreak = 0;
  private driftRunSteps = 0;

  constructor(config: RunConfig) {
    this.config = config;
  }

  get collectsCoins(): boolean {
    return this.config.mode === 'practice' || this.config.mode === 'circuit';
  }

  get reachedEnd(): boolean {
    return this.lapsCompleted >= this.config.laps;
  }

  get ended(): boolean {
    return this.reachedEnd || this.stepsCompleted >= this.config.stepLimit;
  }

  get raceMs(): number {
    return stepsToMs(this.stepsCompleted);
  }

  get clean(): boolean {
    return this.offTrackStepsTotal === 0;
  }

  get bestLapMs(): number | null {
    const valid = this.lapResults.filter((lap) => lap.valid).map((lap) => lap.lapMs);
    return valid.length > 0 ? Math.min(...valid) : null;
  }

  get driftSecondsLeft(): number {
    return Math.ceil((DRIFT_STEP_LIMIT - this.stepsCompleted) / STEPS_PER_SECOND);
  }

  step(input: InputState): StepOutcome {
    const { layout, stats } = this.config;

    if (input.throttle === 1) this.speed += stats.accelMps2 / STEPS_PER_SECOND;
    if (input.brake === 1) this.speed -= stats.brakeMps2 / STEPS_PER_SECOND;
    if (input.throttle === 0 && input.brake === 0) this.speed -= COAST_DECEL / STEPS_PER_SECOND;
    if (input.drift === 1) this.speed -= DRIFT_DECEL / STEPS_PER_SECOND;
    this.speed = Math.min(Math.max(this.speed, 0), stats.topMps);
    if (this.speed > this.topSpeedMps) this.topSpeedMps = this.speed;

    const previousPos = this.lapPos;
    const advance = this.speed / STEPS_PER_SECOND;
    let newPos = previousPos + advance;
    this.totalDistance += advance;
    const lapEnded = newPos >= layout.lengthM;
    if (lapEnded) newPos -= layout.lengthM;
    this.lapPos = newPos;
    this.stepsCompleted += 1;
    this.distanceByStep.push(this.totalDistance);

    let lap: LapResult | null = null;
    if (lapEnded) {
      while (this.sectorIndex < 3) this.closeSector();
      const sectors = this.sectorsMs as [number, number, number];
      lap = {
        lapMs: stepsToMs(this.stepsCompleted) - stepsToMs(this.lapStartSteps),
        valid: this.offTrackStepsThisLap < INVALID_LAP_OFF_TRACK_STEPS,
        offTrackSteps: this.offTrackStepsThisLap,
        sectorsMs: sectors,
      };
      this.lapResults.push(lap);
      this.lapsCompleted += 1;
      this.lapStartSteps = this.stepsCompleted;
      this.offTrackStepsThisLap = 0;
      this.sectorIndex = 0;
      this.sectorStartSteps = this.stepsCompleted;
      this.sectorsMs = [];
    } else {
      while (this.sectorIndex < 2 && newPos >= layout.sectors[this.sectorIndex]!.end) {
        this.closeSector();
      }
    }

    const cornerIndex = cornerIndexAt(layout, newPos);
    if (this.offTrackCorner !== null && this.offTrackCorner !== cornerIndex) {
      this.offTrackCorner = null;
    }
    let offTrack = false;
    if (cornerIndex >= 0) {
      const corner = layout.corners[cornerIndex]!;
      const limit = effectiveLimit(corner, stats.gripPct);
      if (this.offTrackCorner === cornerIndex || this.speed > limit + OFF_TRACK_TOLERANCE_MPS) {
        offTrack = true;
        this.offTrackCorner = cornerIndex;
        this.offTrackStepsThisLap += 1;
        this.offTrackStepsTotal += 1;
        if (this.speed > OFF_TRACK_SPEED_CAP_MPS) this.speed = OFF_TRACK_SPEED_CAP_MPS;
      }
    }

    const between = this.advanceLane(input.lane);
    const coinsGained = this.collectsCoins
      ? this.collectCoins(previousPos, newPos, lapEnded, between)
      : 0;
    this.scoreDrift(input, cornerIndex);

    return { lap, coinsGained, offTrack };
  }

  private closeSector(): void {
    this.sectorsMs.push(stepsToMs(this.stepsCompleted) - stepsToMs(this.sectorStartSteps));
    this.sectorStartSteps = this.stepsCompleted;
    this.sectorIndex += 1;
  }

  private advanceLane(requested: Lane): boolean {
    if (this.laneChangeStepsLeft === 0 && requested !== this.lane) {
      const from = LANES.indexOf(this.lane);
      const to = LANES.indexOf(requested);
      this.laneChangeTarget = LANES[from + (to > from ? 1 : -1)]!;
      this.laneChangeStepsLeft = this.config.stats.laneChangeSteps;
    }
    if (this.laneChangeStepsLeft === 0) return false;
    this.laneChangeStepsLeft -= 1;
    if (this.laneChangeStepsLeft === 0) this.lane = this.laneChangeTarget;
    return true;
  }

  private collectCoins(
    previousPos: number,
    newPos: number,
    lapEnded: boolean,
    between: boolean,
  ): number {
    const { layout } = this.config;
    const passed: Lane[] = [];
    if (lapEnded) {
      for (const coin of layout.coins) {
        if (coin.distance > previousPos && coin.distance <= layout.lengthM) passed.push(coin.lane);
      }
      for (const coin of layout.coins) {
        if (coin.distance > 0 && coin.distance <= newPos) passed.push(coin.lane);
      }
    } else {
      for (const coin of layout.coins) {
        if (coin.distance > previousPos && coin.distance <= newPos) passed.push(coin.lane);
      }
    }
    let gained = 0;
    for (const coinLane of passed) {
      if (!between && coinLane === this.lane) {
        this.coinStreak += 1;
        gained += COIN_BASE_VALUE + Math.min(this.coinStreak - 1, COIN_MAX_BONUS);
      } else {
        this.coinStreak = 0;
      }
    }
    this.coinsCollected += gained;
    return gained;
  }

  private scoreDrift(input: InputState, cornerIndex: number): void {
    const scores = input.drift === 1 && this.speed >= DRIFT_MIN_SPEED_MPS && cornerIndex >= 0;
    if (!scores) {
      this.driftRunSteps = 0;
      return;
    }
    this.driftRunSteps += 1;
    const multiplier = Math.min(
      1 + Math.floor((this.driftRunSteps - 1) / DRIFT_MULTIPLIER_STEPS),
      DRIFT_MAX_MULTIPLIER,
    );
    const weight = this.config.layout.corners[cornerIndex]!.driftWeight;
    this.driftScore += Math.floor(this.speed * weight) * multiplier;
  }
}

function inputAtStep(inputs: InputEvent[], step: number, cursor: number): number {
  let index = cursor;
  while (index + 1 < inputs.length && inputs[index + 1]!.step <= step) index += 1;
  return index;
}

/** Drives a sim through a full input list until the run ends or the inputs run out of steps. */
export function replayInputs(config: RunConfig, inputs: InputEvent[]): CarSim {
  const sim = new CarSim(config);
  let cursor = 0;
  while (!sim.ended) {
    cursor = inputAtStep(inputs, sim.stepsCompleted, cursor);
    const event = inputs[cursor]!;
    sim.step({ throttle: event.throttle, brake: event.brake, drift: event.drift, lane: event.lane });
  }
  return sim;
}

/** The reference driver's pedal choice: the single place this decision is made. */
export function referencePedals(
  layout: LayoutSpec,
  stats: CarStats,
  lapPos: number,
  speed: number,
): { throttle: 0 | 1; brake: 0 | 1 } {
  const insideIndex = cornerIndexAt(layout, lapPos);
  if (insideIndex >= 0) {
    const limit = effectiveLimit(layout.corners[insideIndex]!, stats.gripPct);
    return speed < limit ? { throttle: 1, brake: 0 } : { throttle: 0, brake: 0 };
  }
  const ahead = layout.corners.find((corner) => corner.start > lapPos);
  const next = ahead ?? layout.corners[0]!;
  const distance = ahead
    ? ahead.start - lapPos
    : layout.lengthM - lapPos + layout.corners[0]!.start;
  const limit = effectiveLimit(next, stats.gripPct);
  if (speed > limit) {
    const brakingDistance =
      (speed * speed - limit * limit) / (2 * stats.brakeMps2) + speed / (STEPS_PER_SECOND / 2);
    if (distance <= brakingDistance) return { throttle: 0, brake: 1 };
  }
  return { throttle: 1, brake: 0 };
}

export interface ReferenceRun {
  sim: CarSim;
  inputs: InputEvent[];
}

/** Runs the reference driver and records its input list. */
export function runReferenceDriver(config: RunConfig): ReferenceRun {
  const sim = new CarSim(config);
  const inputs: InputEvent[] = [];
  let previous: { throttle: 0 | 1; brake: 0 | 1 } | null = null;
  while (!sim.ended) {
    const pedals = referencePedals(config.layout, config.stats, sim.lapPos, sim.speed);
    if (previous === null || pedals.throttle !== previous.throttle || pedals.brake !== previous.brake) {
      inputs.push({ step: sim.stepsCompleted, ...pedals, drift: 0, lane: 'middle' });
      previous = pedals;
    }
    sim.step({ ...pedals, drift: 0, lane: 'middle' });
  }
  return { sim, inputs };
}

export interface ReferenceLap {
  lapMs: number;
  sectorsMs: [number, number, number];
}

export function referenceLap(layout: LayoutSpec, stats: CarStats): ReferenceLap {
  const { sim } = runReferenceDriver({
    layout,
    stats,
    mode: 'time-trial',
    laps: 1,
    stepLimit: 7200,
  });
  const lap = sim.lapResults[0];
  if (!lap) return { lapMs: sim.raceMs, sectorsMs: [0, 0, 0] };
  return { lapMs: lap.lapMs, sectorsMs: lap.sectorsMs };
}

/** An AI car: the reference driver's trace slowed by its pace factor. */
export class AiCar {
  readonly name: string;
  readonly carId: string;
  readonly paceFactor: number;
  readonly finishStep: number;
  private readonly distances: number[];
  private readonly totalDistance: number;

  constructor(
    name: string,
    carId: string,
    paceFactor: number,
    config: RunConfig,
  ) {
    this.name = name;
    this.carId = carId;
    this.paceFactor = paceFactor;
    const { sim } = runReferenceDriver(config);
    this.distances = sim.distanceByStep;
    this.totalDistance = config.laps * config.layout.lengthM;
    const referenceStep = this.distances.findIndex((distance) => distance >= this.totalDistance);
    this.finishStep =
      referenceStep < 0 ? config.stepLimit : Math.ceil(referenceStep * paceFactor);
  }

  distanceAtStep(step: number): number {
    const index = Math.min(Math.floor(step / this.paceFactor), this.distances.length - 1);
    return Math.min(this.distances[index]!, this.totalDistance);
  }

  get finishMs(): number {
    return stepsToMs(this.finishStep);
  }
}

export interface Contender {
  name: string;
  isPlayer: boolean;
  lapsCompleted: number;
  lapPos: number;
  finishStep: number | null;
}

/** Live and final positions: finished cars by finish time, then by laps and distance, ties to the player. */
export function rankContenders(contenders: Contender[]): Contender[] {
  return [...contenders].sort((a, b) => {
    if (a.finishStep !== null && b.finishStep !== null) {
      if (a.finishStep !== b.finishStep) return a.finishStep - b.finishStep;
      return a.isPlayer ? -1 : 1;
    }
    if (a.finishStep !== null) return -1;
    if (b.finishStep !== null) return 1;
    if (a.lapsCompleted !== b.lapsCompleted) return b.lapsCompleted - a.lapsCompleted;
    if (a.lapPos !== b.lapPos) return b.lapPos - a.lapPos;
    return a.isPlayer ? -1 : 1;
  });
}
