const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const easeOut =(t: number): number => 1 - (1 - t) ** 3;

/** A number that eases towards a target over a duration measured on the page clock (performance.now()). */
export class Transition {
  private from: number;
  private target: number;
  private start = 0;
  private duration = 0;

  constructor(public value: number) {
    this.from = value;
    this.target = value;
  }

  get goal(): number {
    return this.target;
  }

  retarget(target: number, now: number, duration: number, delay = 0): void {
    this.from = this.value;
    this.target = target;
    this.start = now + delay;
    this.duration = duration;
    if (duration <= 0) {
      this.value = target;
    }
  }

  /** Moves the value to the page clock's `now`; true while it is still on its way. */
  step(now: number): boolean {
    if (this.duration <= 0) return false;
    const t = clamp01((now - this.start) / this.duration);
    this.value = this.from + (this.target - this.from) * easeOut(t);
    if (t >= 1) {
      this.duration = 0;
      this.value = this.target;
      return false;
    }
    return true;
  }
}
