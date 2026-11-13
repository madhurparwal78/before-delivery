import type { SceneDocument } from "../../shared/doc";
import type { Bounds } from "../../shared/gltf";
import { STEP_SECONDS, Simulation } from "../../shared/sim";
import type { Pose } from "./scene";

export interface Telemetry {
  fps: number;
  ms: number;
  step: number;
  hash: string;
}

export interface RunSnapshot {
  running: boolean;
  paused: boolean;
  telemetry: Telemetry;
}

const STEP_MS = STEP_SECONDS * 1000;
const MAX_STEPS_PER_FRAME = 8;
const TELEMETRY_MS = 450;

interface RunnerHooks {
  doc: () => SceneDocument;
  overrides: () => Record<string, number>;
  bounds: (assetId: string) => Bounds | null;
  changed: (snapshot: RunSnapshot) => void;
  poses: (poses: Map<string, Pose>) => void;
}

/** Runs a scene on the fixed-step bench: whole 1/120 s steps, at most 8 per display frame, telemetry twice a second. */
export class Runner {
  snapshot: RunSnapshot = { running: false, paused: false, telemetry: { fps: 0, ms: 0, step: 0, hash: "" } };
  private sim: Simulation | null = null;
  private last = 0;
  private acc = 0;
  private windowStart = 0;
  private frames = 0;

  constructor(private readonly hooks: RunnerHooks) {}

  private publish(patch: Partial<RunSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.hooks.changed(this.snapshot);
  }

  private fresh(): Simulation {
    return new Simulation(this.hooks.doc(), this.hooks.overrides(), this.hooks.bounds);
  }

  /** The pre-run state hash for the scene and the overrides currently in effect. */
  restingTelemetry(): Telemetry {
    return { fps: this.snapshot.telemetry.fps, ms: this.snapshot.telemetry.ms, step: 0, hash: this.fresh().hash() };
  }

  /** Re-reads the resting state (after the scene or an override changed while stopped). */
  refreshResting(): void {
    if (this.sim) return;
    this.publish({ telemetry: this.restingTelemetry() });
    this.hooks.poses(this.currentPoses());
  }

  fullHash(): string {
    return (this.sim ?? this.fresh()).hash();
  }

  currentPoses(): Map<string, Pose> {
    const sim = this.sim ?? this.fresh();
    const poses = new Map<string, Pose>();
    for (const object of this.hooks.doc().objects) {
      const pose = sim.pose(object.id);
      if (pose) poses.set(object.id, { position: [...pose.position], rotation: [...pose.rotation] });
    }
    return poses;
  }

  get colliders(): Simulation["colliders"] {
    return this.fresh().colliders;
  }

  start(): void {
    if (this.sim) return;
    this.sim = this.fresh();
    const now = performance.now();
    this.last = now;
    this.windowStart = now;
    this.acc = 0;
    this.frames = 0;
    this.publish({ running: true, paused: false, telemetry: { fps: 0, ms: 0, step: 0, hash: this.sim.hash() } });
  }

  stop(): void {
    if (!this.sim) return;
    this.sim = null;
    this.publish({ running: false, paused: false, telemetry: this.restingTelemetry() });
    this.hooks.poses(this.currentPoses());
  }

  togglePause(): void {
    if (!this.sim) return;
    this.last = performance.now();
    this.acc = 0;
    this.publish({ paused: !this.snapshot.paused, telemetry: this.reading() });
  }

  stepOnce(): void {
    if (!this.sim) return;
    this.sim.advance(1);
    this.publish({ paused: true, telemetry: this.reading() });
    this.hooks.poses(this.currentPoses());
  }

  private reading(): Telemetry {
    const sim = this.sim as Simulation;
    return { ...this.snapshot.telemetry, step: sim.step, hash: sim.hash() };
  }

  /** Runs inside the stage's animation frame; returns true while the stage must keep drawing. */
  frame = (now: number): boolean => {
    const sim = this.sim;
    if (!sim) return false;
    this.frames++;
    if (!this.snapshot.paused) {
      this.acc = Math.min(this.acc + (now - this.last), MAX_STEPS_PER_FRAME * STEP_MS);
      const steps = Math.min(Math.floor(this.acc / STEP_MS), MAX_STEPS_PER_FRAME);
      this.acc -= steps * STEP_MS;
      sim.advance(steps);
    }
    this.last = now;
    if (now - this.windowStart >= TELEMETRY_MS) {
      const elapsed = now - this.windowStart;
      this.publish({ telemetry: { fps: Math.round((this.frames * 1000) / elapsed), ms: Math.round((elapsed / this.frames) * 10) / 10, step: sim.step, hash: sim.hash() } });
      this.windowStart = now;
      this.frames = 0;
    }
    this.hooks.poses(this.currentPoses());
    return !this.snapshot.paused;
  };
}
