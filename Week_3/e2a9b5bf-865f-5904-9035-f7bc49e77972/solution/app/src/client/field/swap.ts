import type { Derived } from "../../shared/types";
import type { View } from "./draw";

const COUNT_MS = 320;
const ORIENT_MS = 180;

/** Everything the Field region paints: the circle's view and the counting numerals. */
export interface Frame {
  view: View;
  mag: number;
  field: number;
  pupil: number;
  /** True from the pick until the swap ends: the counting figures show and the readout is hidden. */
  active: boolean;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function target(d: Derived): { half: number; rot: number; sx: number } {
  return { half: d.true_field_arcmin / 2, rot: d.orientation.rotation_deg, sx: d.orientation.mirrored ? -1 : 1 };
}

/** The Field swap: numerals count, the circle rescales, then the compass and sketch turn and flip. */
export class FieldController {
  frame: Frame;
  private raf = 0;
  private run: {
    from: Frame;
    to: Derived;
    t0: number;
    announce: boolean;
  } | null = null;

  constructor(
    initial: Derived,
    private readonly paint: (frame: Frame) => void,
    private readonly ended: (derived: Derived, announce: boolean) => void,
    private readonly reducedMotion: () => boolean,
  ) {
    this.frame = this.settled(initial);
  }

  private settled(d: Derived): Frame {
    return { view: target(d), mag: d.magnification, field: d.true_field_arcmin, pupil: d.exit_pupil_mm, active: false };
  }

  get swapping(): boolean {
    return this.run !== null;
  }

  /** Shows these optics at once with no swap, no figures and no announcement. */
  reset(d: Derived): void {
    this.stop();
    this.frame = this.settled(d);
    this.paint(this.frame);
  }

  /** A local optics pick: swap from what is on screen now to the new optics. */
  start(d: Derived, announce = true): void {
    if (this.reducedMotion()) {
      this.stop();
      this.frame = this.settled(d);
      this.paint(this.frame);
      this.ended(d, announce);
      return;
    }
    this.stop();
    this.run = { from: this.frame, to: d, t0: performance.now(), announce };
    this.step();
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Jumps to the end of the swap in progress and fires its ending. */
  finish(): void {
    const run = this.run;
    if (!run) return;
    this.stop();
    this.frame = this.settled(run.to);
    this.paint(this.frame);
    this.ended(run.to, run.announce);
  }

  dispose(): void {
    this.stop();
  }

  private stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.run = null;
  }

  private tick = (): void => {
    this.step();
    if (this.run) this.raf = requestAnimationFrame(this.tick);
  };

  private step(): void {
    const run = this.run;
    if (!run) return;
    const elapsed = performance.now() - run.t0;
    if (elapsed >= COUNT_MS + ORIENT_MS) {
      this.finish();
      return;
    }
    const goal = target(run.to);
    const count = easeOut(clamp01(elapsed / COUNT_MS));
    const turn = easeOut(clamp01((elapsed - COUNT_MS) / ORIENT_MS));
    const from = run.from;
    const ratio = from.view.half / goal.half;
    const limited = Math.min(5, Math.max(0.2, ratio));
    const half = elapsed >= COUNT_MS ? goal.half : from.view.half / lerp(1, limited, count);
    const flip = (1 - Math.cos(Math.PI * turn)) / 2;
    const orient = elapsed < COUNT_MS ? 0 : turn;
    this.frame = {
      view: {
        half,
        rot: lerp(from.view.rot, goal.rot, orient),
        sx: elapsed < COUNT_MS ? from.view.sx : lerp(from.view.sx, goal.sx, flip),
      },
      mag: Math.round(lerp(from.mag, run.to.magnification, count)),
      field: Math.round(lerp(from.field, run.to.true_field_arcmin, count)),
      pupil: Math.round(lerp(from.pupil, run.to.exit_pupil_mm, count) * 10) / 10,
      active: true,
    };
    this.paint(this.frame);
  }
}
