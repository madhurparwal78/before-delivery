// The one deterministic race model shared by the browser race, ghosts and server verification.
import type { CarStats, CornerSpec, LayoutSpec, LaneId } from './domain.js';

export interface InputEvent {
  step: number;
  throttle: 0 | 1;
  brake: 0 | 1;
  drift: 0 | 1;
  lane: LaneId;
}

export interface Pedals {
  throttle: 0 | 1;
  brake: 0 | 1;
  drift: 0 | 1;
  lane: LaneId;
}

export const OFF_TRACK_INVALID_STEPS = 60;
export const OFF_TRACK_SPEED_CAP = 8;
export const COAST_DECEL = 0.5;
export const DRIFT_DECEL = 1.0;
export const OFF_TRACK_TOLERANCE = 0.5;
export const LANE_ORDER: LaneId[] = ['left', 'middle', 'right'];
export const DRIFT_MIN_SPEED = 10;

export const stepsToMs = (steps: number): number => Math.round((steps * 1000) / 60);

export interface LapResult {
  lapMs: number;
  valid: boolean;
  offTrackSteps: number;
  sectorsMs: [number, number, number];
}

export interface CarProgress {
  position: number;
  speed: number;
  lane: LaneId;
  lap: number;
  finished: boolean;
  finishStep: number | null;
  distance: number;
}

export interface RaceOutcome {
  lapResults: LapResult[];
  raceMs: number;
  bestLapMs: number | null;
  driftScore: number;
  coinsCollected: number;
  clean: boolean;
  topSpeedMps: number;
  finished: boolean;
}

export interface StepEvents {
  lapEnded: LapResult | null;
  coinPassed: { at: number; lane: LaneId } | null;
  coins: number;
  driftScore: number;
}

interface CarState {
  position: number;
  speed: number;
  lane: LaneId;
  laneChangeRemaining: number;
  offInCorner: CornerSpec | null;
  lap: number;
  lapStartStep: number;
  sectorStartStep: number;
  sectorIndex: number;
  sectorsMs: [number, number, number];
  offTrackStepsInLap: number;
  totalOffTrackSteps: number;
  coinsCollected: number;
  coinStreak: number;
  driftScore: number;
  driftRunSteps: number;
  topSpeed: number;
  finished: boolean;
  finishStep: number | null;
  distance: number;
}

/** Per-run race model state. One instance per run, never shared at module or process level. */
export class RaceCar {
  private st: CarState;

  constructor(readonly layout: LayoutSpec, readonly stats: CarStats, readonly laps: number,
              readonly collectCoins: boolean, readonly scoreDrift: boolean) {
    this.st = {
      position: 0, speed: 0, lane: 'middle', laneChangeRemaining: 0, offInCorner: null,
      lap: 1, lapStartStep: 0, sectorStartStep: 0, sectorIndex: 0, sectorsMs: [0, 0, 0],
      offTrackStepsInLap: 0, totalOffTrackSteps: 0, coinsCollected: 0, coinStreak: 0,
      driftScore: 0, driftRunSteps: 0, topSpeed: 0, finished: false, finishStep: null, distance: 0
    };
  }

  get position(): number { return this.st.position; }
  get speed(): number { return this.st.speed; }
  get lane(): LaneId { return this.st.lane; }
  get lap(): number { return this.st.lap; }
  get finished(): boolean { return this.st.finished; }
  get finishStep(): number | null { return this.st.finishStep; }
  get distance(): number { return this.st.distance; }
  get coinsCollected(): number { return this.st.coinsCollected; }
  get driftScore(): number { return this.st.driftScore; }
  get topSpeedMps(): number { return this.st.topSpeed; }
  get clean(): boolean { return this.st.totalOffTrackSteps === 0; }
  get progress(): CarProgress {
    return {
      position: this.st.position, speed: this.st.speed, lane: this.st.lane, lap: this.st.lap,
      finished: this.st.finished, finishStep: this.st.finishStep, distance: this.st.distance
    };
  }
  get sectorTimes(): [number, number, number] { return [...this.st.sectorsMs] as [number, number, number]; }

  effectiveLimit(c: CornerSpec): number {
    return (c.limit * this.stats.gripPct) / 100;
  }

  cornerAt(pos: number): CornerSpec | null {
    for (const c of this.layout.corners) {
      if (pos >= c.start && pos < c.end) return c;
    }
    return null;
  }

  /** The reference driver's pedal choice, decided from position and speed at the start of a step. */
  referencePedals(): Pedals {
    const pos = this.st.position;
    const speed = this.st.speed;
    const inside = this.cornerAt(pos);
    if (inside) {
      const limit = this.effectiveLimit(inside);
      return { throttle: speed < limit ? 1 : 0, brake: 0, drift: 0, lane: 'middle' };
    }
    let next: CornerSpec | null = null;
    let dist: number;
    let found = false;
    for (const c of this.layout.corners) {
      if (c.start > pos) { next = c; found = true; break; }
    }
    if (found && next) {
      dist = next.start - pos;
    } else {
      next = this.layout.corners[0];
      dist = this.layout.length - pos + next.start;
    }
    const limit = this.effectiveLimit(next);
    const brakeDist = (speed * speed - limit * limit) / (2 * this.stats.brakeMps2) + speed / 30;
    const shouldBrake = speed > limit && dist <= brakeDist;
    return { throttle: shouldBrake ? 0 : 1, brake: shouldBrake ? 1 : 0, drift: 0, lane: 'middle' };
  }

  /** One step. k is the step number. input is in force on this step. */
  step(k: number, input: Pedals): StepEvents {
    const ev: StepEvents = { lapEnded: null, coinPassed: null, coins: 0, driftScore: this.st.driftScore };
    const s = this.stats;

    // 1-3. Speed update
    if (input.throttle) this.st.speed += s.accelMps2 / 60;
    if (input.brake) this.st.speed -= s.brakeMps2 / 60;
    if (!input.throttle && !input.brake) this.st.speed -= COAST_DECEL / 60;
    if (input.drift) this.st.speed -= DRIFT_DECEL / 60;
    if (this.st.speed < 0) this.st.speed = 0;
    if (this.st.speed > s.topMps) this.st.speed = s.topMps;

    // 4. Advance
    const prevPos = this.st.position;
    this.st.position += this.st.speed / 60;
    this.st.distance += this.st.speed / 60;

    // 5. Lap end
    let lapEnded = false;
    if (this.st.position >= this.layout.length) {
      this.st.position -= this.layout.length;
      lapEnded = true;
    }

    // 6. Off-track check on the new position
    const corner = this.cornerAt(this.st.position);
    let offTrackStep = false;
    if (corner) {
      const limit = this.effectiveLimit(corner);
      if (this.st.speed > limit + OFF_TRACK_TOLERANCE || this.st.offInCorner === corner) {
        offTrackStep = true;
        this.st.offInCorner = corner;
        if (this.st.speed > OFF_TRACK_SPEED_CAP) this.st.speed = OFF_TRACK_SPEED_CAP;
      }
    } else {
      this.st.offInCorner = null;
    }
    if (offTrackStep) {
      this.st.offTrackStepsInLap++;
      this.st.totalOffTrackSteps++;
      this.st.coinStreak = 0;
      this.st.driftRunSteps = 0;
    }

    // 7. Lane change
    const betweenLanes = this.st.laneChangeRemaining > 0;
    if (!betweenLanes && input.lane !== this.st.lane) {
      this.st.laneChangeRemaining = s.laneChangeSteps;
    }
    if (this.st.laneChangeRemaining > 0) {
      this.st.laneChangeRemaining--;
      if (this.st.laneChangeRemaining === 0) {
        const idx = LANE_ORDER.indexOf(this.st.lane);
        const tIdx = LANE_ORDER.indexOf(input.lane);
        if (tIdx > idx) this.st.lane = LANE_ORDER[idx + 1];
        else this.st.lane = LANE_ORDER[idx - 1];
      }
    }

    // 7. Coins
    if (this.collectCoins) {
      ev.coins = this.collectStepCoins(prevPos, this.st.position, lapEnded, betweenLanes, offTrackStep, ev);
    }

    // 7. Drift scoring
    if (this.scoreDrift) {
      const c = this.cornerAt(this.st.position);
      const scoring = input.drift && !offTrackStep && this.st.speed >= DRIFT_MIN_SPEED && c !== null;
      if (scoring) {
        const mult = Math.min(1 + Math.floor(this.st.driftRunSteps / 60), 5);
        this.st.driftScore += Math.floor(this.st.speed * c.driftWeight) * mult;
        this.st.driftRunSteps++;
      } else {
        this.st.driftRunSteps = 0;
      }
    }

    if (this.st.speed > this.st.topSpeed) this.st.topSpeed = this.st.speed;

    // Sectors: each pending sector ends when the new position reaches or passes its end
    while (this.st.sectorIndex < 3) {
      const end = this.layout.sectors[this.st.sectorIndex];
      if (this.sectorCrossed(prevPos, this.st.position, lapEnded, end)) {
        this.st.sectorsMs[this.st.sectorIndex] = stepsToMs(k + 1 - this.st.sectorStartStep);
        this.st.sectorIndex++;
        this.st.sectorStartStep = k + 1;
        continue;
      }
      break;
    }

    if (lapEnded) {
      ev.lapEnded = {
        lapMs: stepsToMs(k + 1 - this.st.lapStartStep),
        valid: this.st.offTrackStepsInLap < OFF_TRACK_INVALID_STEPS,
        offTrackSteps: this.st.offTrackStepsInLap,
        sectorsMs: [...this.st.sectorsMs] as [number, number, number]
      };
      this.st.lap++;
      this.st.lapStartStep = k + 1;
      this.st.offTrackStepsInLap = 0;
      this.st.sectorIndex = 0;
      this.st.sectorStartStep = k + 1;
      this.st.sectorsMs = [0, 0, 0];
      if (this.st.lap > this.laps) {
        this.st.finished = true;
        this.st.finishStep = k;
      }
    }
    ev.driftScore = this.st.driftScore;
    return ev;
  }

  private sectorCrossed(prevPos: number, newPos: number, lapEnded: boolean, sectorEnd: number): boolean {
    if (lapEnded) {
      // A lap-end step covers the old lap's tail up to the length and the new lap's head,
      // so every pending sector ends here.
      void newPos;
      return true;
    }
    if (prevPos === newPos) return false;
    return prevPos < sectorEnd && newPos >= sectorEnd;
  }

  private collectStepCoins(prevPos: number, newPos: number, lapEnded: boolean, betweenLanes: boolean,
                           offTrackStep: boolean, ev: StepEvents): number {
    let collected = 0;
    const check = (from: number, to: number): void => {
      for (const coin of this.layout.coins) {
        if (coin.at > from && coin.at <= to) {
          ev.coinPassed = coin;
          if (!betweenLanes && !offTrackStep && this.st.lane === coin.lane) {
            this.st.coinStreak++;
            const value = 5 + Math.min(this.st.coinStreak - 1, 5);
            this.st.coinsCollected += value;
            collected += value;
          } else {
            this.st.coinStreak = 0;
          }
        }
      }
    };
    if (lapEnded) {
      check(prevPos, this.layout.length);
      check(0, newPos);
    } else {
      check(prevPos, newPos);
    }
    return collected;
  }
}

/** The reference driver as an input list, running until the run ends or the step limit. */
export function referenceInputs(layout: LayoutSpec, stats: CarStats, laps: number, stepLimit: number): InputEvent[] {
  const car = new RaceCar(layout, stats, laps, false, false);
  const events: InputEvent[] = [];
  let prevThrottle: number | null = null;
  let prevBrake: number | null = null;
  let prevDrift: number | null = null;
  for (let k = 0; k < stepLimit && !car.finished; k++) {
    const p = car.referencePedals();
    if (p.throttle !== prevThrottle || p.brake !== prevBrake || p.drift !== prevDrift) {
      events.push({ step: k, throttle: p.throttle, brake: p.brake, drift: p.drift, lane: 'middle' });
      prevThrottle = p.throttle; prevBrake = p.brake; prevDrift = p.drift;
    }
    car.step(k, p);
  }
  return events;
}

/** Runs a whole race. inputAt gives the input in force on each step. */
export function runRace(layout: LayoutSpec, stats: CarStats, laps: number, stepLimit: number,
                        collectCoins: boolean, scoreDrift: boolean,
                        inputAt: (step: number) => Pedals): RaceOutcome {
  const car = new RaceCar(layout, stats, laps, collectCoins, scoreDrift);
  const lapResults: LapResult[] = [];
  let stepsUsed = 0;
  for (let k = 0; k < stepLimit; k++) {
    const ev = car.step(k, inputAt(k));
    stepsUsed = k + 1;
    if (ev.lapEnded) lapResults.push(ev.lapEnded);
    if (car.finished) break;
  }
  const raceMs = stepsToMs(car.finished ? (car.finishStep ?? stepsUsed - 1) + 1 : stepsUsed);
  const bestLapMs = lapResults.reduce<number | null>((best, l) => {
    if (!l.valid) return best;
    return best === null || l.lapMs < best ? l.lapMs : best;
  }, null);
  return {
    lapResults,
    raceMs,
    bestLapMs,
    driftScore: car.driftScore,
    coinsCollected: car.coinsCollected,
    clean: car.clean,
    topSpeedMps: car.topSpeedMps,
    finished: car.finished
  };
}
