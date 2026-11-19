// The map's viewport: a flat projection, hard limits and every way the viewport moves.
import { MOTION, easeOutQuint, reducedMotion } from "../lib/motion";

export interface View {
  lon: number;
  lat: number;
  zoom: number;
}

export type Phase = "idle" | "dragging" | "moving" | "settled";

export const LON_PX = 31;
export const LAT_PX = 40;
export const OPENING_VIEW: View = { lon: -18.75, lat: 39.5, zoom: 1 };
export const SELECT_ZOOM = 6;
export const CLUSTER_ZOOM = 3;
const LIMITS = { lon: [-31.5, -6.0], lat: [36.8, 42.2], zoom: [1, 8] } as const;
const PAN_KEY_PX = 40;

function clamp(value: number, [low, high]: readonly [number, number]): number {
  return Math.min(high, Math.max(low, value));
}

function limit(view: View): View {
  return { lon: clamp(view.lon, LIMITS.lon), lat: clamp(view.lat, LIMITS.lat), zoom: clamp(view.zoom, LIMITS.zoom) };
}

export function viewText(view: View): string {
  return `${view.lon.toFixed(4)},${view.lat.toFixed(4)},${view.zoom.toFixed(2)}`;
}

export function project(view: View, size: { width: number; height: number }, lon: number, lat: number): { x: number; y: number } {
  return { x: size.width / 2 + (lon - view.lon) * LON_PX * view.zoom, y: size.height / 2 - (lat - view.lat) * LAT_PX * view.zoom };
}

export interface EngineState {
  view: View;
  phase: Phase;
}

/** Owns the viewport; every change is published through `publish` in the frame it happens. */
export class MapEngine {
  private view: View = OPENING_VIEW;
  private phase: Phase = "idle";
  private frame = 0;
  private velocity = { x: 0, y: 0 };
  private samples: { t: number; x: number; y: number }[] = [];
  private readonly publish: (state: EngineState) => void;

  constructor(publish: (state: EngineState) => void) {
    this.publish = publish;
  }

  get state(): EngineState {
    return { view: this.view, phase: this.phase };
  }

  private emit(view: View, phase: Phase): void {
    this.view = limit(view);
    this.phase = phase;
    this.publish({ view: this.view, phase });
  }

  private stop(): void {
    window.cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  dispose(): void {
    this.stop();
  }

  /** Puts the viewport at `view` at once and reports settled. */
  jump(view: View): void {
    this.stop();
    this.emit(view, "settled");
  }

  /** Moves the centre by screen pixels; the keyboard and the drag both use this. */
  shift(dx: number, dy: number, phase: Phase = "settled"): void {
    const { view } = this;
    this.emit({ ...view, lon: view.lon + dx / (LON_PX * view.zoom), lat: view.lat - dy / (LAT_PX * view.zoom) }, phase);
  }

  panKey(dx: number, dy: number): void {
    this.stop();
    this.shift(dx * PAN_KEY_PX, dy * PAN_KEY_PX);
  }

  zoomBy(delta: number): void {
    this.stop();
    this.emit({ ...this.view, zoom: this.view.zoom + delta }, "settled");
  }

  /** Zooms keeping the geographic point under `anchor` (pixels from the region centre) where it is. */
  zoomAbout(zoom: number, anchor: { x: number; y: number }): void {
    const before = this.view;
    const next = clamp(zoom, LIMITS.zoom);
    const lon = before.lon + anchor.x / (LON_PX * before.zoom) - anchor.x / (LON_PX * next);
    const lat = before.lat - anchor.y / (LAT_PX * before.zoom) + anchor.y / (LAT_PX * next);
    this.stop();
    this.emit({ lon, lat, zoom: next }, this.phase === "dragging" ? "dragging" : "settled");
  }

  /** Travels to `target` on a quintic ease-out; under reduced motion cuts there at once. */
  glideTo(target: View, done: () => void): void {
    this.stop();
    const goal = limit(target);
    if (reducedMotion()) {
      this.emit(goal, "settled");
      done();
      return;
    }
    const from = this.view;
    let started: number | null = null;
    this.emit(from, "moving");
    const step = (now: number) => {
      started ??= now;
      const progress = Math.min(1, (now - started) / MOTION.glideMs);
      const eased = easeOutQuint(progress);
      const view = { lon: from.lon + (goal.lon - from.lon) * eased, lat: from.lat + (goal.lat - from.lat) * eased, zoom: from.zoom + (goal.zoom - from.zoom) * eased };
      if (progress >= 1) {
        this.emit(goal, "settled");
        done();
      } else {
        this.emit(view, "moving");
        this.frame = window.requestAnimationFrame(step);
      }
    };
    this.frame = window.requestAnimationFrame(step);
  }

  dragStart(): void {
    this.stop();
    this.samples = [];
  }

  dragMove(dx: number, dy: number): void {
    const now = performance.now();
    this.samples.push({ t: now, x: dx, y: dy });
    this.samples = this.samples.filter((sample) => now - sample.t <= 120);
    this.shift(-dx, -dy, "dragging");
  }

  /** Releasing a drag keeps the map moving in the release direction, its speed halving every 240 ms. */
  dragEnd(): void {
    const recent = this.samples;
    this.samples = [];
    const first = recent[0];
    const last = recent[recent.length - 1];
    const span = first && last ? last.t - first.t : 0;
    const moved = recent.reduce((sum, sample) => ({ x: sum.x + sample.x, y: sum.y + sample.y }), { x: 0, y: 0 });
    const speed = span > 0 ? { x: moved.x / span, y: moved.y / span } : { x: 0, y: 0 };
    const pixelsPerSecond = Math.hypot(speed.x, speed.y) * 1000;
    if (reducedMotion() || pixelsPerSecond < MOTION.dragStopSpeed) {
      this.emit(this.view, "settled");
      return;
    }
    this.velocity = { x: speed.x, y: speed.y };
    this.emit(this.view, "moving");
    const decay = Math.LN2 / MOTION.dragHalfLifeMs;
    let last_t: number | null = null;
    const step = (now: number) => {
      const dt = last_t === null ? 16 : now - last_t;
      last_t = now;
      const travel = (1 - Math.exp(-decay * dt)) / decay;
      this.shift(-this.velocity.x * travel, -this.velocity.y * travel, "moving");
      const factor = Math.exp(-decay * dt);
      this.velocity = { x: this.velocity.x * factor, y: this.velocity.y * factor };
      if (Math.hypot(this.velocity.x, this.velocity.y) * 1000 < MOTION.dragStopSpeed) {
        this.emit(this.view, "settled");
        return;
      }
      this.frame = window.requestAnimationFrame(step);
    };
    this.frame = window.requestAnimationFrame(step);
  }
}
