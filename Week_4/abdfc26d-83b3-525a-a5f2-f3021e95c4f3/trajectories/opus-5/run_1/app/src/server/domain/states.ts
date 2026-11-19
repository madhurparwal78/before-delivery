import { ApiError } from '../errors.js';

export type PieceState = 'draft' | 'published' | 'withdrawn';
export type EditionOrderState =
  | 'held'
  | 'paying'
  | 'paid'
  | 'invoiced'
  | 'receipted'
  | 'refunded'
  | 'failed'
  | 'expired';
export type RenderState =
  | 'accepted'
  | 'queued'
  | 'rendering'
  | 'stored'
  | 'ready'
  | 'failed'
  | 'timed_out'
  | 'credits_released';
export type PlanState = 'pending_payment' | 'active' | 'cancelling' | 'ended';

/** Every legal move of every state machine, each declared exactly once. */
const PIECE_MOVES: ReadonlyMap<PieceState, readonly PieceState[]> = new Map([
  ['draft', ['published']],
  ['published', ['withdrawn']],
  ['withdrawn', []],
]);

const ORDER_MOVES: ReadonlyMap<EditionOrderState, readonly EditionOrderState[]> = new Map([
  ['held', ['paying', 'expired']],
  ['paying', ['paid', 'failed']],
  ['paid', ['invoiced']],
  ['invoiced', ['receipted']],
  ['receipted', ['refunded']],
  ['refunded', []],
  ['failed', []],
  ['expired', []],
]);

const RENDER_MOVES: ReadonlyMap<RenderState, readonly RenderState[]> = new Map([
  ['accepted', ['queued']],
  ['queued', ['rendering', 'credits_released']],
  ['rendering', ['stored', 'failed', 'timed_out']],
  ['stored', ['ready', 'failed', 'timed_out']],
  ['ready', []],
  ['failed', ['credits_released']],
  ['timed_out', ['credits_released']],
  ['credits_released', []],
]);

const PLAN_MOVES: ReadonlyMap<PlanState, readonly PlanState[]> = new Map([
  ['pending_payment', ['active']],
  ['active', ['cancelling']],
  ['cancelling', ['ended']],
  ['ended', []],
]);

function allows<S>(moves: ReadonlyMap<S, readonly S[]>, from: S, to: S): boolean {
  return (moves.get(from) ?? []).includes(to);
}

export function canMovePiece(from: PieceState, to: PieceState): boolean {
  return allows(PIECE_MOVES, from, to);
}

export function canMoveOrder(from: EditionOrderState, to: EditionOrderState): boolean {
  return allows(ORDER_MOVES, from, to);
}

export function canMoveRender(from: RenderState, to: RenderState): boolean {
  return allows(RENDER_MOVES, from, to);
}

export function canMovePlan(from: PlanState, to: PlanState): boolean {
  return allows(PLAN_MOVES, from, to);
}

export function requirePieceMove(from: PieceState, to: PieceState): void {
  if (!canMovePiece(from, to)) {
    throw ApiError.invalidTransition(`A ${from} piece cannot become ${to}.`);
  }
}

export function requireOrderMove(from: EditionOrderState, to: EditionOrderState): void {
  if (!canMoveOrder(from, to)) {
    throw ApiError.invalidTransition(`A ${from} order cannot become ${to}.`);
  }
}

export function requireRenderMove(from: RenderState, to: RenderState): void {
  if (!canMoveRender(from, to)) {
    throw ApiError.invalidTransition(`A ${from} render cannot become ${to}.`);
  }
}
