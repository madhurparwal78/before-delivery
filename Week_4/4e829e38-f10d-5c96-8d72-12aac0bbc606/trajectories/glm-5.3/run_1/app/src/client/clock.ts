/**
 * The page clock. Every animation reads this clock, which the grading harness
 * pauses and steps. No app hook waits on a timer or a frame for state: state is
 * written synchronously first and motion only reads it.
 */
class PageClock {
  t = 0;
  private running = false;
  private frameCbs: ((t: number) => void)[] = [];

  now(): number { return this.t; }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = (): void => {
      this.t += 1000 / 60;
      for (const cb of [...this.frameCbs]) cb(this.t);
      if (this.running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  onFrame(cb: (t: number) => void): void {
    this.frameCbs.push(cb);
    if (this.frameCbs.length === 1) this.start();
  }

  offFrame(cb: (t: number) => void): void {
    this.frameCbs = this.frameCbs.filter(c => c !== cb);
  }

  runFor(ms: number): void {
    const end = this.t + ms;
    while (this.t < end) {
      this.t += 1000 / 60;
      for (const c of [...this.frameCbs]) c(this.t);
    }
  }
}

export const clock = new PageClock();

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The shared easing with control points 0.2 0 / 0 1: fast start, soft settle. */
export function moveEase(x: number): number {
  return 1 - Math.pow(1 - x, 4);
}
