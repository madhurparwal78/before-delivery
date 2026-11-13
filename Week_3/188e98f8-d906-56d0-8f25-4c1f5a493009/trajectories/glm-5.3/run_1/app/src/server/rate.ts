/** The one submit allowance: 6 submits in any rolling 60 seconds. */
export interface SubmitWindow {
  readonly teamId: number;
  readonly at: Date;
}

export function parseRoundSeconds(raw: string | undefined): number {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value) || value < 5 || value > 3600) return 240;
  return value;
}

/** The one rule for a submit's wait: whole seconds, rounded up, until the oldest counted submit turns 60. */
export function submitWait(counted: readonly Date[], now: Date): number {
  if (counted.length === 0) return 0;
  const oldest = counted.reduce(
    (min, at) => (at.getTime() < min.getTime() ? at : min),
    counted[0]!,
  );
  const remaining = oldest.getTime() + 60_000 - now.getTime();
  return Math.max(1, Math.ceil(remaining / 1000));
}
