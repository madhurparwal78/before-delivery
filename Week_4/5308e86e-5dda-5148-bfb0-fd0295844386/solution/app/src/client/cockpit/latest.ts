/** Latest answer wins: only the most recent request may show its answer. */
export class Latest {
  private current = 0;

  begin(): number {
    this.current += 1;
    return this.current;
  }

  /** Makes every request started so far stale. */
  invalidate(): void {
    this.current += 1;
  }

  isCurrent(ticket: number): boolean {
    return ticket === this.current;
  }
}
