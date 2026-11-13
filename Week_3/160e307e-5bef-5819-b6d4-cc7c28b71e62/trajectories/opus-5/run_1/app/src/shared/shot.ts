import {
  STRIKER_SPEED_PER_POWER,
  baselineY,
  offsetToBoardX,
  round1,
  strikerStart,
} from './geometry.js';
import { applyFinalPositions, offsetOnGrid, onBoard, placementLegal, ruleShot } from './laws.js';
import { aimGuide, makeBody, simulate } from './physics.js';
import type { BoardState, Frame, Intent, PieceId, Ruling, Seat, ShotEvents } from './types.js';

export type ShotRejection = 'INVALID_INTENT' | 'ILLEGAL_PLACEMENT';

export interface ShotOutcome {
  events: ShotEvents;
  frames: Frame[];
  final: { id: PieceId; x: number | null; y: number | null; state: 'board' | 'pocketed' }[];
  ruling: Ruling;
  nextTurn: Seat;
}

export function intentValid(intent: Intent): boolean {
  if (!offsetOnGrid(intent.x)) return false;
  const length = Math.sqrt(intent.dx * intent.dx + intent.dy * intent.dy);
  if (!Number.isFinite(length) || Math.abs(length - 1) > 0.001) return false;
  if (!Number.isFinite(intent.p) || intent.p < 0 || intent.p > 1) return false;
  const steps = intent.p / 0.001;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

export function checkShot(state: BoardState, seat: Seat, intent: Intent): ShotRejection | null {
  if (!intentValid(intent)) return 'INVALID_INTENT';
  if (!placementLegal(intent.x, seat, state.pieces)) return 'ILLEGAL_PLACEMENT';
  return null;
}

/**
 * The one place a shot is played: dc-model-1 runs the striker, then the laws of carrom
 * rule what happened. The board state is changed in place.
 */
export function playShot(state: BoardState, seat: Seat, intent: Intent): ShotOutcome {
  const speed = STRIKER_SPEED_PER_POWER * intent.p;
  const bodies = [
    makeBody(
      'striker',
      offsetToBoardX(intent.x, seat),
      baselineY(seat),
      intent.dx * speed,
      intent.dy * speed,
    ),
    ...onBoard(state.pieces).map((p) => makeBody(p.id, p.x, p.y, 0, 0)),
  ];
  const sim = simulate(bodies);
  applyFinalPositions(state, seat, sim.events, sim.final);
  const applied = ruleShot(state, seat, sim.events);
  const start = strikerStart(applied.nextTurn);

  const final: ShotOutcome['final'] = [
    { id: 'striker', x: start.x, y: start.y, state: 'board' },
    ...state.pieces.map((p) => ({
      id: p.id,
      x: p.x === null ? null : round1(p.x),
      y: p.y === null ? null : round1(p.y),
      state: p.state,
    })),
  ];

  return { events: sim.events, frames: sim.frames, final, ruling: applied.ruling, nextTurn: applied.nextTurn };
}

/** The piece or cushion the striker would first touch from a placement and aim. */
export function guideFrom(state: BoardState, seat: Seat, offset: number, direction: { dx: number; dy: number }) {
  return aimGuide(
    { x: offsetToBoardX(offset, seat), y: baselineY(seat) },
    direction,
    onBoard(state.pieces),
  );
}
