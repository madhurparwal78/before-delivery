// The server clock (Business rules): the real clock unless STOWDECK_NOW fixes it.
// Intervals and delays always run on real elapsed time.

export class ServerClock {
  private fixed: number | null;
  private startReal = Date.now();

  constructor(fixedIso?: string) {
    this.fixed = fixedIso ? Date.parse(fixedIso) : null;
  }

  now(): Date {
    return this.fixed === null ? new Date() : new Date(this.fixed);
  }

  nowMs(): number {
    return this.fixed === null ? Date.now() : this.fixed;
  }

  // Real elapsed time, independent of the frozen clock.
  elapsedMs(): number {
    return Date.now() - this.startReal;
  }
}

export function toIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
