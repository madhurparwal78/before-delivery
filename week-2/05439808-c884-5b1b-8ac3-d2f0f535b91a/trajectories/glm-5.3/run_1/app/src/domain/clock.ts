// Server clock. When SALTREACH_CLOCK_START is set, the clock reads that instant at process
// start and advances in real time from it; it drives every server time rule.
export class Clock {
  private readonly virtualStart: number | null;
  private readonly realStart: number;

  constructor(startIso?: string) {
    this.realStart = Date.now();
    this.virtualStart = startIso ? Date.parse(startIso) : null;
    if (startIso && Number.isNaN(this.virtualStart)) {
      throw new Error('invalid SALTREACH_CLOCK_START');
    }
  }

  now(): number {
    if (this.virtualStart === null) return Date.now();
    return this.virtualStart + (Date.now() - this.realStart);
  }
}
