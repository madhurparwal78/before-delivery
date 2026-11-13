/**
 * Follow Light: pointer-driven cursor tilt, light focus and hover events, as pure functions and one small engine
 * shared by the landing stage, the editor stage and the embed.
 */
import { ease, glide } from '../easing';
import type { Easing } from '../types';

const FRAME_MS = 1000 / 60;
const LEAVE_MS = 1200;
export const REST_FOCUS = { x: 0.8, y: 0.9 } as const;
/** Longest gap between two ticks that is counted, so a hidden tab does not replay minutes of smoothing. */
const MAX_GAP_MS = 250;

/** Per 60 Hz frame fraction of the way to the target: f = 1 − 0.92·momentum. */
const smoothing = (momentum: number): number => 1 - 0.92 * momentum;

/** Pointer position over a stage of the displayed size, each axis in −1..1. */
export function pointerOf(x: number, y: number, width: number, height: number): { n: number; m: number } {
  return { n: (x / width) * 2 - 1, m: (y / height) * 2 - 1 };
}

const clampUnit = (value: number): number => Math.min(1, Math.max(-1, value));

interface Channel {
  value: number;
  target: number;
  rest: number;
  leave: { from: number; startMs: number } | null;
}

const channel = (rest: number): Channel => ({ value: rest, target: rest, rest, leave: null });

/** One 60 Hz smoothing step toward the target; a channel that is leaving ignores it. */
function stepChannel(c: Channel, momentum: number): void {
  if (c.leave) return;
  c.value += (c.target - c.value) * smoothing(momentum);
}

function beginLeave(c: Channel, now: number): void {
  if (c.leave || c.value === c.rest) {
    c.target = c.rest;
    return;
  }
  c.leave = { from: c.value, startMs: now };
  c.target = c.rest;
}

/** Eases a leaving channel toward rest with Glide over LEAVE_MS. */
function leaveChannel(c: Channel, now: number): void {
  if (!c.leave) return;
  const t = (now - c.leave.startMs) / LEAVE_MS;
  if (t >= 1) {
    c.value = c.rest;
    c.leave = null;
    return;
  }
  c.value = c.rest + (c.leave.from - c.rest) * (1 - glide(Math.max(0, t)));
}

export interface TiltConfig {
  id: string;
  enabled: boolean;
  maxTilt: number;
  sensitivity: number;
  momentum: number;
}

export interface FollowConfig {
  tilts: readonly TiltConfig[];
  light: { enabled: boolean; momentum: number };
  /** Reduced motion: tilt and light stay at rest while the targets are still reported. */
  reduced: boolean;
}

export interface TiltValues {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
}

export interface FollowSnapshot {
  tilt: ReadonlyMap<string, TiltValues>;
  focus: { x: number; y: number };
}

/** Tilt target (X, Y) for a pointer: rotation Y follows the horizontal pointer, rotation X the vertical. */
function tiltTarget(n: number, m: number, config: Pick<TiltConfig, 'maxTilt' | 'sensitivity'>): { x: number; y: number } {
  return { x: -m * config.sensitivity * config.maxTilt + 0, y: n * config.sensitivity * config.maxTilt + 0 };
}

export class FollowEngine {
  private acc = 0;
  private last: number | null = null;
  private pointer: { n: number; m: number } | null = null;
  private pointerSince: number | null = null;
  private readonly channels = new Map<string, Channel>();
  private readonly snapshotTilt = new Map<string, TiltValues>();
  private readonly focusX = channel(REST_FOCUS.x);
  private readonly focusY = channel(REST_FOCUS.y);

  /** The pointer is over the stage (or the virtual pointer was moved). Takes effect at the next frame. */
  setPointer(n: number, m: number): void {
    this.pointer = { n: clampUnit(n), m: clampUnit(m) };
  }

  get pointerPosition(): { n: number; m: number } | null {
    return this.pointer;
  }

  /** The pointer left the stage, or the virtual pointer was released. */
  release(now: number): void {
    if (!this.pointer) return;
    this.pointer = null;
    this.pointerSince = null;
    for (const c of this.channels.values()) beginLeave(c, now);
    beginLeave(this.focusX, now);
    beginLeave(this.focusY, now);
  }

  /** Back to rest at once, as when Preview is switched off. */
  reset(): void {
    this.pointer = null;
    this.pointerSince = null;
    this.channels.clear();
    this.focusX.value = this.focusX.target = REST_FOCUS.x;
    this.focusY.value = this.focusY.target = REST_FOCUS.y;
    this.focusX.leave = this.focusY.leave = null;
    this.last = null;
    this.acc = 0;
  }

  private channelFor(key: string): Channel {
    let c = this.channels.get(key);
    if (!c) {
      c = channel(0);
      this.channels.set(key, c);
    }
    return c;
  }

  /** Advances to `now` (milliseconds on the page clock) and returns whether any value moved. */
  tick(now: number, config: FollowConfig): boolean {
    const gap = this.last === null ? 0 : Math.min(Math.max(now - this.last, 0), MAX_GAP_MS);
    this.last = now;
    this.acc += gap;
    let frames = 0;
    while (this.acc >= FRAME_MS) {
      this.acc -= FRAME_MS;
      frames += 1;
    }
    const before = this.signature();
    const pointer = this.pointer;
    if (pointer) this.pointerSince ??= now;
    for (const tilt of config.tilts) {
      const x = this.channelFor(`${tilt.id}:x`);
      const y = this.channelFor(`${tilt.id}:y`);
      if (pointer && tilt.enabled) {
        const target = tiltTarget(pointer.n, pointer.m, tilt);
        x.target = target.x;
        y.target = target.y;
        if (x.leave || y.leave) {
          x.leave = null;
          y.leave = null;
        }
      }
      if (config.reduced || !tilt.enabled) {
        x.value = y.value = 0;
        x.leave = y.leave = null;
        if (!pointer || !tilt.enabled) x.target = y.target = 0;
      } else {
        for (let i = 0; i < frames; i++) {
          stepChannel(x, tilt.momentum);
          stepChannel(y, tilt.momentum);
        }
        leaveChannel(x, now);
        leaveChannel(y, now);
      }
    }
    if (config.reduced || !config.light.enabled) {
      this.focusX.value = REST_FOCUS.x;
      this.focusY.value = REST_FOCUS.y;
      this.focusX.leave = this.focusY.leave = null;
    } else {
      if (pointer) {
        this.focusX.target = (pointer.n + 1) / 2;
        this.focusY.target = (pointer.m + 1) / 2;
        this.focusX.leave = this.focusY.leave = null;
      }
      for (let i = 0; i < frames; i++) {
        stepChannel(this.focusX, config.light.momentum);
        stepChannel(this.focusY, config.light.momentum);
      }
      leaveChannel(this.focusX, now);
      leaveChannel(this.focusY, now);
    }
    return before !== this.signature();
  }

  private signature(): string {
    let s = `${this.focusX.value},${this.focusY.value}`;
    for (const [key, c] of this.channels) s += `|${key}:${c.value},${c.target}`;
    return s;
  }

  snapshot(config: FollowConfig): FollowSnapshot {
    this.snapshotTilt.clear();
    for (const tilt of config.tilts) {
      const x = this.channelFor(`${tilt.id}:x`);
      const y = this.channelFor(`${tilt.id}:y`);
      this.snapshotTilt.set(tilt.id, { x: x.value, y: y.value, targetX: x.target, targetY: y.target });
    }
    return { tilt: new Map(this.snapshotTilt), focus: { x: this.focusX.value, y: this.focusY.value } };
  }

  /** Whether anything is still moving or the pointer is engaged: an idle stage needs no redraw. */
  get active(): boolean {
    if (this.pointer) return true;
    if (this.focusX.leave || this.focusY.leave) return true;
    for (const c of this.channels.values()) if (c.leave) return true;
    return false;
  }
}

interface HoverConfig {
  enabled: boolean;
  durationMs: number;
  delayMs: number;
  easing: Easing;
  forwardsOnly: boolean;
}

/** Hover progress 0..1 from the time spent hovering: it runs forwards over the duration after the delay. */
export function hoverProgress(hoverMs: number, config: Pick<HoverConfig, 'durationMs' | 'delayMs' | 'easing'>): number {
  if (config.durationMs <= 0) return hoverMs >= config.delayMs ? 1 : 0;
  const t = Math.min(Math.max((hoverMs - config.delayMs) / config.durationMs, 0), 1);
  return ease(config.easing, t, 0);
}

/** Hover time after `dt` more milliseconds: it grows over the layer and, unless forwards only, runs back off it. */
export function advanceHover(hoverMs: number, dt: number, over: boolean, config: Pick<HoverConfig, 'durationMs' | 'delayMs' | 'forwardsOnly'>): number {
  const end = config.delayMs + config.durationMs;
  if (over) return Math.min(hoverMs + dt, end);
  if (config.forwardsOnly) return hoverMs;
  return Math.max(hoverMs - dt, 0);
}

/** Moves numeric values from their own value toward `to` by `progress`. */
export function blendToward(values: Record<string, number>, to: Record<string, number>, progress: number): Record<string, number> {
  const out: Record<string, number> = { ...values };
  for (const [path, target] of Object.entries(to)) {
    const own = values[path];
    if (own !== undefined) out[path] = own + (target - own) * progress;
  }
  return out;
}
