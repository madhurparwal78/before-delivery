// The library drawer and margin sheet: a critically damped spring, retargeted from its current
// offset and velocity on every press, stepped from animation-frame timestamps.
import { springAt, springSettled } from '../shared/motion.ts';
import { reducedMotion } from './motion.ts';

export class SpringPanel {
  private x0 = 0;
  private v0 = 0;
  private target = 0;
  private start = 0;
  private frame = 0;
  offset = 0;
  velocity = 0;

  constructor(
    private readonly apply: (offset: number, progress: number) => void,
    private readonly closedOffset: () => number,
    private readonly onSettle: (open: boolean) => void,
  ) {}

  /** Moves toward open (0) or closed (its own size), from wherever it is now. */
  retarget(open: boolean, fromRest: boolean): void {
    const now = performance.now();
    if (fromRest) {
      this.offset = this.closedOffset();
      this.velocity = 0;
    } else if (this.frame) {
      const s = springAt(this.x0, this.v0, this.target, (now - this.start) / 1000);
      this.offset = s.offset;
      this.velocity = s.velocity;
    }
    this.x0 = this.offset;
    this.v0 = this.velocity;
    this.target = open ? 0 : this.closedOffset();
    this.start = now;
    cancelAnimationFrame(this.frame);
    if (reducedMotion()) {
      this.finish();
      return;
    }
    this.apply(this.offset, this.progress());
    this.frame = requestAnimationFrame(this.tick);
  }

  private progress(): number {
    const closed = this.closedOffset();
    return closed === 0 ? 1 : Math.min(1, Math.max(0, 1 - this.offset / closed));
  }

  private tick = (time: number): void => {
    const s = springAt(this.x0, this.v0, this.target, Math.max(0, time - this.start) / 1000);
    this.offset = s.offset;
    this.velocity = s.velocity;
    if (springSettled(s.offset, s.velocity, this.target)) {
      this.finish();
      return;
    }
    this.apply(this.offset, this.progress());
    this.frame = requestAnimationFrame(this.tick);
  };

  private finish(): void {
    this.frame = 0;
    this.offset = this.target;
    this.velocity = 0;
    this.apply(this.offset, this.progress());
    this.onSettle(this.target === 0);
  }

  /** Follows a finger drag directly (sheet), keeping the measured velocity for the release. */
  drag(offset: number, velocity: number): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.offset = offset;
    this.velocity = velocity;
    this.apply(offset, this.progress());
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
  }
}
