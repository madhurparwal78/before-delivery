// The one source of business time: real time, or the fixed grading time that only `advance` moves.

export class Clock {
  private fixed: number | null = null;

  nowMs(): number {
    return this.fixed ?? Date.now();
  }

  now(): Date {
    return new Date(this.nowMs());
  }

  iso(): string {
    return this.now().toISOString();
  }

  set(ms: number): void {
    this.fixed = ms;
  }

  advance(ms: number): void {
    this.fixed = this.nowMs() + ms;
  }
}
