import {
  LAYOUTS, MAX_INPUT_EVENTS, STEPS_PER_SECOND, aiDistanceAt, aiTrack, carModel, createCar, distance, rankStandings,
  simulate, step, stepsToMs, type AiTrack, type CarState, type CarStats, type Input, type InputEvent,
} from "../../shared/model";
import { inputFrom, laneAfter } from "./keys";
import { frames } from "../motion";
import type { RunCreated } from "../types";
import { laneOffset, type RaceView } from "./view";

// A ghost: per lap, the ghost's position in the lap after each step since that lap began.
export interface Ghost {
  readonly name: string;
  readonly carId: string;
  readonly laps: readonly Float64Array[];
}

export function ghostFromReplay(name: string, carId: string, stats: CarStats, layoutId: RunCreated["layoutId"],
  mode: RunCreated["mode"], laps: number, limit: number, inputs: InputEvent[]): Ghost {
  const car = createCar(LAYOUTS[layoutId], stats, mode, laps);
  const lapsOut: number[][] = [[0]];
  simulate(car, inputs, limit, (outcome) => {
    if (outcome.lapCompleted) {
      lapsOut[lapsOut.length - 1].push(LAYOUTS[layoutId].length);
      if (!car.finished) lapsOut.push([car.position]);
    } else {
      lapsOut[lapsOut.length - 1].push(car.position);
    }
  });
  return { name, carId, laps: lapsOut.filter((lap) => lap.length > 1).map((lap) => Float64Array.from(lap)) };
}

export type GhostState = { kind: "none" } | { kind: "loading" } | { kind: "unavailable" } | { kind: "ready"; ghost: Ghost };

export interface HudModel {
  readonly lap: number;
  readonly laps: number;
  readonly position: { readonly p: number; readonly cars: number } | null;
  readonly speedMps: number;
  readonly coins: number | null;
  readonly drift: { readonly score: number; readonly secondsLeft: number } | null;
  readonly deltaMs: number | null;
  readonly prompt: boolean;
}

type Phase = "prestart" | "running" | "paused" | "over";

// One run's race: the player's car stepped 60 times per second of page time through the shared
// race model, the AI drivers, the ghost and the recorded input list. Created per run.
export class RaceSession {
  private phase: Phase = "prestart";
  private readonly car: CarState;
  private readonly ai: { carId: string; track: AiTrack }[];
  private readonly held = new Set<string>();
  private requestedLane = 1;
  private readonly inputs: InputEvent[] = [];
  private startedAt = 0;
  private pausedAt = 0;
  private pausedTotal = 0;
  private stop: (() => void) | null = null;

  constructor(
    private readonly run: RunCreated,
    private readonly view: RaceView,
    private readonly ghost: () => GhostState,
    private readonly callbacks: {
      readonly hud: (model: HudModel) => void;
      readonly lapDone: (lap: number, lapMs: number, valid: boolean) => void;
      readonly finished: (body: string) => void;
    },
  ) {
    const layout = LAYOUTS[run.layoutId];
    this.car = createCar(layout, run.car.stats, run.mode, run.laps);
    this.ai = run.ai.map((entry) => ({
      carId: entry.carId,
      track: aiTrack(layout, carModel(entry.carId)!.stats, run.laps, Math.round(entry.paceFactor * 100)),
    }));
    this.paint();
  }

  get running(): boolean {
    return this.phase === "running";
  }

  get waiting(): boolean {
    return this.phase === "prestart";
  }

  begin(): void {
    if (this.phase !== "prestart") return;
    this.phase = "running";
    this.startedAt = performance.now();
    this.stop = frames((now) => this.tick(now));
  }

  pause(): void {
    if (this.phase !== "running") return;
    this.phase = "paused";
    this.pausedAt = performance.now();
    this.stop?.();
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.phase = "running";
    this.pausedTotal += performance.now() - this.pausedAt;
    this.stop = frames((now) => this.tick(now));
  }

  dispose(): void {
    this.phase = "over";
    this.stop?.();
  }

  keyDown(key: string, repeat: boolean): void {
    this.held.add(key);
    if (!repeat) this.requestedLane = laneAfter(this.requestedLane, key);
  }

  keyUp(key: string): void {
    this.held.delete(key);
  }

  // The input in force on this step, recorded as an event whenever it changes.
  private recordedInput(): Input {
    const wanted = inputFrom(this.held, this.requestedLane);
    const last = this.inputs[this.inputs.length - 1];
    const same = last && last.throttle === wanted.throttle && last.brake === wanted.brake && last.drift === wanted.drift
      && last.lane === wanted.lane;
    if (same || (last && this.inputs.length >= MAX_INPUT_EVENTS)) return last;
    const event: InputEvent = { step: this.car.steps, ...wanted };
    this.inputs.push(event);
    return event;
  }

  private tick(now: number): boolean {
    if (this.phase !== "running") return false;
    const target = Math.floor(((now - this.startedAt - this.pausedTotal) * STEPS_PER_SECOND) / 1000);
    const before = this.car.steps;
    while (this.car.steps < target && !this.car.finished && this.car.steps < this.run.stepLimit) {
      const outcome = step(this.car, this.recordedInput());
      if (outcome.lapCompleted) {
        this.callbacks.lapDone(this.car.lapsCompleted, outcome.lapCompleted.lapMs, outcome.lapCompleted.valid);
      }
    }
    if (this.car.steps !== before) this.paint();
    if (this.car.finished || this.car.steps >= this.run.stepLimit) {
      this.phase = "over";
      this.callbacks.finished(JSON.stringify({ seed: this.run.seed, inputs: this.inputs }));
      return false;
    }
    return true;
  }

  private ghostLap(): Float64Array | null {
    const state = this.ghost();
    if (state.kind !== "ready" || state.ghost.laps.length === 0) return null;
    const laps = state.ghost.laps;
    return laps[Math.min(this.car.lapsCompleted, laps.length - 1)];
  }

  // Player's time into the lap at their distance, minus the ghost's time to that distance in the same lap.
  private delta(lap: Float64Array): number {
    const target = this.car.position;
    let lo = 0;
    let hi = lap.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lap[mid] >= target) hi = mid;
      else lo = mid + 1;
    }
    return stepsToMs(this.car.steps - this.car.lapStartStep) - stepsToMs(lo);
  }

  // Draws the view and reports the HUD for the current step.
  paint(): void {
    const { car, run } = this;
    const length = car.layout.length;
    const into = car.steps - car.lapStartStep;
    const lap = this.ghostLap();
    const ghostState = this.ghost();
    this.view.draw({
      player: { carId: run.carId, distance: distance(car), offset: laneOffset(car.lane, car.change, car.stats.laneChangeSteps) },
      others: this.ai.map((ai) => ({ carId: ai.carId, distance: aiDistanceAt(ai.track, car.steps), offset: 0 })),
      ghost: lap && ghostState.kind === "ready"
        ? { carId: ghostState.ghost.carId, distance: car.lapsCompleted * length + lap[Math.min(into, lap.length - 1)], offset: 0 }
        : null,
    });
    let position: HudModel["position"] = null;
    if (run.mode === "circuit") {
      const ranks = rankStandings([
        { finishSteps: car.finished ? car.steps : null, distance: distance(car) },
        ...this.ai.map((ai) => ({
          finishSteps: car.steps >= ai.track.finishSteps ? ai.track.finishSteps : null,
          distance: aiDistanceAt(ai.track, car.steps),
        })),
      ]);
      position = { p: ranks[0], cars: ranks.length };
    }
    this.callbacks.hud({
      lap: Math.min(car.lapsCompleted + 1, run.laps),
      laps: run.laps,
      position,
      speedMps: car.speed,
      coins: run.mode === "practice" || run.mode === "circuit" ? car.coins : null,
      drift: run.mode === "drift" ? { score: car.driftScore, secondsLeft: Math.ceil((run.stepLimit - car.steps) / STEPS_PER_SECOND) } : null,
      deltaMs: lap ? (car.steps === 0 ? 0 : this.delta(lap)) : null,
      prompt: this.phase === "prestart",
    });
  }
}
