/** Every state machine in the workspace, decided here and nowhere else. */

import type {
  CaseStudyState,
  SnagAction,
  SnagState,
  StageState,
  TenderStatus,
  VariationAction,
  VariationState,
} from '../../shared/domain.js';

export type StageAction = 'request' | 'sign_off' | 'return';

const STAGE_TRANSITIONS: Record<StageAction, readonly StageState[]> = {
  request: ['not_started', 'returned'],
  sign_off: ['requested'],
  return: ['requested'],
};

export function stageAllows(from: StageState, action: StageAction): boolean {
  return STAGE_TRANSITIONS[action].includes(from);
}

export type TenderAction =
  | 'publish'
  | 'move_close'
  | 'open_bids'
  | 'award'
  | 'edit_setup'
  | 'bid';

const TENDER_TRANSITIONS: Record<TenderAction, readonly TenderStatus[]> = {
  edit_setup: ['draft'],
  publish: ['draft'],
  move_close: ['open'],
  open_bids: ['closed'],
  award: ['opened'],
  bid: ['open'],
};

export function tenderAllows(from: TenderStatus, action: TenderAction): boolean {
  return TENDER_TRANSITIONS[action].includes(from);
}

const VARIATION_TRANSITIONS: Record<VariationAction, readonly VariationState[]> = {
  start_review: ['raised'],
  approve: ['under_review'],
  reject: ['under_review'],
  withdraw: ['raised', 'under_review'],
};

export const VARIATION_EDITABLE_STATES: readonly VariationState[] = ['raised', 'under_review'];

export function variationAllows(from: VariationState, action: VariationAction): boolean {
  return VARIATION_TRANSITIONS[action].includes(from);
}

export function variationStateAfter(action: VariationAction): VariationState {
  switch (action) {
    case 'start_review':
      return 'under_review';
    case 'approve':
      return 'approved';
    case 'reject':
      return 'rejected';
    case 'withdraw':
      return 'withdrawn';
  }
}

const SNAG_TRANSITIONS: Record<SnagAction, readonly SnagState[]> = {
  fix: ['open', 'reopened'],
  close: ['fixed'],
  reopen: ['fixed', 'closed'],
};

export function snagAllows(from: SnagState, action: SnagAction): boolean {
  return SNAG_TRANSITIONS[action].includes(from);
}

export function snagStateAfter(action: SnagAction): SnagState {
  switch (action) {
    case 'fix':
      return 'fixed';
    case 'close':
      return 'closed';
    case 'reopen':
      return 'reopened';
  }
}

export function snagMovable(from: SnagState): boolean {
  return from !== 'closed';
}

export type CaseStudyAction = 'send_preview' | 'approve' | 'publish' | 'withdraw';

const CASE_STUDY_TRANSITIONS: Record<CaseStudyAction, readonly CaseStudyState[]> = {
  send_preview: ['draft', 'preview_sent'],
  approve: ['preview_sent'],
  publish: ['client_approved'],
  withdraw: ['published'],
};

export function caseStudyAllows(from: CaseStudyState, action: CaseStudyAction): boolean {
  return CASE_STUDY_TRANSITIONS[action].includes(from);
}

export function caseStudyStateAfter(action: CaseStudyAction): CaseStudyState {
  switch (action) {
    case 'send_preview':
      return 'preview_sent';
    case 'approve':
      return 'client_approved';
    case 'publish':
      return 'published';
    case 'withdraw':
      return 'withdrawn';
  }
}

/** A shop-drawing submission is returned once; a resubmission needs Code 3 or 4. */
export function resubmissionAllowed(code: number | null): boolean {
  return code === 3 || code === 4;
}
