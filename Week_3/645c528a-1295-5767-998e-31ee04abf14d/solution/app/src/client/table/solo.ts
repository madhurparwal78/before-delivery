import { CUE_BALL, cueSpotFrom, HEAD_SPOT, respotted, simulate, type BallSpots, type SimulatedShot, type Strike } from '../../shared/physics';
import type { StrikeRequest } from './model';

export const FRAME_MS = 50;

export function runLocalShot(spots: BallSpots, request: StrikeRequest, breaking: boolean): SimulatedShot {
  const strike: Strike = { ...request, powerBonus: 0, spinBonus: 0 };
  return simulate(spots, strike, breaking);
}

export function receiptText(firstBall: number | null, cut: number): string {
  return firstBall === null ? 'No first ball.' : `First ball ${firstBall}. Cut ${cut.toFixed(1)}°.`;
}

/** Rest positions after a shot: cue ball back on the head spot after a scratch, listed balls returned to the table. */
export function settleSpots(rest: BallSpots, balls: number[], inHand: boolean): BallSpots {
  const spots: BallSpots = {};
  for (const ball of [CUE_BALL, ...balls]) if (rest[ball] !== undefined) spots[ball] = rest[ball];
  for (const ball of balls) if (spots[ball] === undefined) spots[ball] = respotted(spots, ball);
  if (spots[CUE_BALL] === undefined || inHand) spots[CUE_BALL] = cueSpotFrom(spots, HEAD_SPOT);
  return spots;
}
