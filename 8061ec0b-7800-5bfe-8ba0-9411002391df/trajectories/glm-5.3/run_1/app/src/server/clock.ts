// The one server clock (DP-47). Every server time rule reads now() from here.
// With BELLROLL_CLOCK_START the clock reads that instant at process start and
// advances in real time from there.
export class Clock {
  private readonly epochMs: number;
  private readonly startedAtReal: number;

  constructor(clockStart: string | null) {
    this.startedAtReal = Date.now();
    this.epochMs = clockStart ? Date.parse(clockStart) : this.startedAtReal;
    if (clockStart && Number.isNaN(this.epochMs)) {
      throw new Error(`Invalid BELLROLL_CLOCK_START: ${clockStart}`);
    }
  }

  now(): Date {
    return new Date(this.epochMs + (Date.now() - this.startedAtReal));
  }

  nowMs(): number {
    return this.epochMs + (Date.now() - this.startedAtReal);
  }

  nowIso(): string {
    return this.now().toISOString().replace(/\.\d{3}Z$/, "Z");
  }
}
