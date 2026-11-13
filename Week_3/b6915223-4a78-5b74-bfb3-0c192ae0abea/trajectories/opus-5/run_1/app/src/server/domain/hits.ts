export const HIT_POINTS_PER_TRANSFER = 4;
export const FREE_TRANSFER_STORE_LIMIT = 5;

export interface HitInput {
  /** Free transfers held when the gameweek opened. */
  freeTransfersAtStart: number;
  /** Paid-rule transfers already counted in this gameweek. */
  transfersCounted: number;
  /** Transfer pairs in this batch. */
  count: number;
  /** Wildcard or Free Hit makes the batch free and uses no free transfers. */
  chipMakesFree: boolean;
}

export interface HitOutcome {
  freeTransfersUsed: number;
  hitPoints: number;
  gameweekHitPoints: number;
}

/** The gameweek's hit so far: every counted transfer beyond the free ones held at its start. */
export const gameweekHitPoints = (freeTransfersAtStart: number, transfersCounted: number): number =>
  HIT_POINTS_PER_TRANSFER * Math.max(0, transfersCounted - freeTransfersAtStart);

export const freeTransfersLeft = (freeTransfersAtStart: number, transfersCounted: number): number =>
  Math.max(0, freeTransfersAtStart - transfersCounted);

/** The one place free transfers and hits are decided. */
export const hitForBatch = (input: HitInput): HitOutcome => {
  const { freeTransfersAtStart, transfersCounted, count, chipMakesFree } = input;
  const before = gameweekHitPoints(freeTransfersAtStart, transfersCounted);
  if (chipMakesFree) {
    return { freeTransfersUsed: 0, hitPoints: 0, gameweekHitPoints: before };
  }
  const after = gameweekHitPoints(freeTransfersAtStart, transfersCounted + count);
  return {
    freeTransfersUsed: Math.min(count, freeTransfersLeft(freeTransfersAtStart, transfersCounted)),
    hitPoints: after - before,
    gameweekHitPoints: after,
  };
};

/** Free transfers added at each deadline. */
export const freeTransfersAfterDeadline = (remaining: number): number =>
  Math.min(FREE_TRANSFER_STORE_LIMIT, remaining + 1);
