import { ease } from '../shared/easing';
import { REST_LIGHT_FOCUS, smoothToward } from '../shared/evaluator';

export interface Pointer {
  /** Normalised 0..1 over the stage. */
  x: number;
  y: number;
  inside: boolean;
}

/** Counts 60 Hz frames from elapsed clock time so results don't depend on the display rate. */
export class MotionClock {
  private last = 0;
  private carry = 0;

  step(now: number): number {
    if (this.last === 0) {
      this.last = now;
      return 0;
    }
    this.carry += ((now - this.last) * 60) / 1000;
    this.last = now;
    const frames = Math.floor(this.carry);
    this.carry -= frames;
    return Math.min(frames, 20);
  }
}

const LEAVE_MS = 1200;

export class LightField {
  level = 0;
  focus = { ...REST_LIGHT_FOCUS };
  private entranceStart: number | null = null;
  private leaveStart: number | null = null;
  private leaveFrom = { ...REST_LIGHT_FOCUS };
  private wasInside = false;

  /** The light rises and brightens over 800 ms from the first frame. */
  advanceLevel(now: number, reducedMotion: boolean): void {
    if (reducedMotion) {
      this.level = 1;
      return;
    }
    if (this.entranceStart === null) {
      this.entranceStart = now;
      this.level = 0;
      return;
    }
    const elapsed = now - this.entranceStart;
    this.level = ease('ease-out', Math.max(0, Math.min(1, elapsed / 800)));
  }

  advanceFocus(
    now: number,
    frames: number,
    pointer: Pointer,
    momentum: number,
    reducedMotion: boolean,
  ): void {
    if (reducedMotion) {
      this.focus = { ...REST_LIGHT_FOCUS };
      return;
    }
    if (pointer.inside) {
      this.leaveStart = null;
      this.wasInside = true;
      for (let i = 0; i < frames; i += 1) {
        this.focus = {
          x: smoothToward(this.focus.x, pointer.x, momentum),
          y: smoothToward(this.focus.y, pointer.y, momentum),
        };
      }
      return;
    }
    if (this.wasInside && this.leaveStart === null) {
      this.leaveStart = now;
      this.leaveFrom = { ...this.focus };
      this.wasInside = false;
    }
    if (this.leaveStart !== null) {
      const progress = ease('glide', Math.max(0, Math.min(1, (now - this.leaveStart) / LEAVE_MS)));
      this.focus = {
        x: this.leaveFrom.x + (REST_LIGHT_FOCUS.x - this.leaveFrom.x) * progress,
        y: this.leaveFrom.y + (REST_LIGHT_FOCUS.y - this.leaveFrom.y) * progress,
      };
    }
  }
}

export interface TiltSettings {
  maxTilt: number;
  sensitivity: number;
  momentum: number;
}

export class TiltField {
  current = { x: 0, y: 0 };
  target = { x: 0, y: 0 };
  private leaveStart: number | null = null;
  private leaveFrom = { x: 0, y: 0 };
  private wasInside = false;

  advance(
    now: number,
    frames: number,
    pointer: Pointer,
    settings: TiltSettings,
    reducedMotion: boolean,
  ): void {
    const n = pointer.x * 2 - 1;
    const m = pointer.y * 2 - 1;
    this.target = pointer.inside
      ? {
          x: -m * settings.sensitivity * settings.maxTilt,
          y: n * settings.sensitivity * settings.maxTilt,
        }
      : { x: 0, y: 0 };
    if (reducedMotion) {
      this.current = { x: 0, y: 0 };
      return;
    }
    if (pointer.inside) {
      this.leaveStart = null;
      this.wasInside = true;
      for (let i = 0; i < frames; i += 1) {
        this.current = {
          x: smoothToward(this.current.x, this.target.x, settings.momentum),
          y: smoothToward(this.current.y, this.target.y, settings.momentum),
        };
      }
      return;
    }
    if (this.wasInside && this.leaveStart === null) {
      this.leaveStart = now;
      this.leaveFrom = { ...this.current };
      this.wasInside = false;
    }
    if (this.leaveStart !== null) {
      const progress = ease('glide', Math.max(0, Math.min(1, (now - this.leaveStart) / LEAVE_MS)));
      this.current = {
        x: this.leaveFrom.x + (0 - this.leaveFrom.x) * progress,
        y: this.leaveFrom.y + (0 - this.leaveFrom.y) * progress,
      };
    }
  }
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
