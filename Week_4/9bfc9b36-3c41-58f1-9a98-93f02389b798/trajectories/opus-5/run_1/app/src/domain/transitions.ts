import { refuse, type AppError } from '../http/errors';

/** The one place that holds the drawing state machine and the four-step derivation. */

export type DrawingStatus =
  | 'measuring'
  | 'remeasure'
  | 'drawn'
  | 'nested'
  | 'cutting'
  | 'cut'
  | 'pending_store'
  | 'issued';

export type Step = 'measure' | 'draw' | 'nest' | 'confirm';

export const SEALED_STATUSES: readonly DrawingStatus[] = ['pending_store', 'issued'];

export function isSealed(status: DrawingStatus): boolean {
  return SEALED_STATUSES.includes(status);
}

export interface NestingFacts {
  readonly status: DrawingStatus;
  readonly panelCount: number;
  readonly uncutPanelCount: number;
  readonly uncutPanelsLaidOnHeldClaim: number;
  readonly cutPanelCount: number;
}

export function measureStepMet(status: DrawingStatus): boolean {
  return status !== 'remeasure';
}

export function drawStepMet(facts: NestingFacts): boolean {
  return facts.panelCount > 0;
}

export function nestStepMet(facts: NestingFacts): boolean {
  if (facts.panelCount === 0) return false;
  if (facts.cutPanelCount === facts.panelCount) return true;
  return facts.uncutPanelCount > 0 && facts.uncutPanelsLaidOnHeldClaim === facts.uncutPanelCount;
}

export function confirmStepMet(status: DrawingStatus): boolean {
  return status === 'cut' || status === 'pending_store' || status === 'issued';
}

/** `step` is the first step that is not met, or `confirm` when all are met. */
export function deriveStep(facts: NestingFacts): Step {
  if (!measureStepMet(facts.status)) return 'measure';
  if (!drawStepMet(facts)) return 'draw';
  if (!nestStepMet(facts)) return 'nest';
  if (!confirmStepMet(facts.status)) return 'confirm';
  return 'confirm';
}

/** A step address is reachable when every earlier step is met. */
export function stepReachable(step: Step, facts: NestingFacts): boolean {
  switch (step) {
    case 'measure':
      return true;
    case 'draw':
      return measureStepMet(facts.status);
    case 'nest':
      return measureStepMet(facts.status) && drawStepMet(facts);
    case 'confirm':
      return measureStepMet(facts.status) && drawStepMet(facts) && nestStepMet(facts);
  }
}

/** Draw is legal only from Measuring. */
export function refusalForDraw(status: DrawingStatus): AppError | null {
  if (status === 'measuring') return null;
  if (status === 'remeasure') return refuse('remeasure_required');
  if (isSealed(status)) return refuse('sealed');
  return refuse('wrong_state');
}

/** Claiming and laying are legal only from Drawn, Nested or Cutting. */
export function refusalForNestingAction(status: DrawingStatus): AppError | null {
  if (status === 'drawn' || status === 'nested' || status === 'cutting') return null;
  if (isSealed(status)) return refuse('sealed');
  return refuse('wrong_state');
}

/** Assigning is legal until the drawing is sealed. */
export function refusalForAssign(status: DrawingStatus): AppError | null {
  return isSealed(status) ? refuse('sealed') : null;
}

export function refusalForIssue(status: DrawingStatus): AppError | null {
  if (status === 'cut') return null;
  if (status === 'pending_store' || status === 'issued') return refuse('already_issued');
  return refuse('wrong_state');
}

export function refusalForRevise(status: DrawingStatus, hasSuccessor: boolean): AppError | null {
  if (status !== 'issued') return refuse('wrong_state');
  if (hasSuccessor) return refuse('already_revised');
  return null;
}

/**
 * The status a drawing settles into once its lays, cuts and flagged dimensions
 * are known. Cutting and later keep the figures recorded at Draw.
 */
export function settleStatus(facts: NestingFacts, anyUsedDimensionFlagged: boolean): DrawingStatus {
  const status = facts.status;
  if (status === 'cut' || status === 'pending_store' || status === 'issued') return status;
  if (status === 'cutting') return facts.cutPanelCount === facts.panelCount ? 'cut' : 'cutting';
  if (anyUsedDimensionFlagged) return 'remeasure';
  if (facts.panelCount === 0) return 'measuring';
  if (facts.cutPanelCount === facts.panelCount) return 'cut';
  if (facts.cutPanelCount > 0) return 'cutting';
  return nestStepMet(facts) ? 'nested' : 'drawn';
}
