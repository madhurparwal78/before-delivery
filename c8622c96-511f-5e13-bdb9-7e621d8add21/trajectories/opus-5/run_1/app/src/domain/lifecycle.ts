export type EssayState = 'draft' | 'in_review' | 'embargoed' | 'live' | 'withdrawn' | 'taken_down';

export type EssayAction =
  | 'edit'
  | 'submit'
  | 'publish'
  | 'hold'
  | 'lift'
  | 'withdrawal_request'
  | 'withdraw'
  | 'takedown';

const ALLOWED_FROM: Record<EssayAction, EssayState[]> = {
  edit: ['draft'],
  submit: ['draft'],
  publish: ['in_review'],
  hold: ['in_review'],
  lift: ['embargoed'],
  withdrawal_request: ['embargoed', 'live'],
  withdraw: ['embargoed', 'live'],
  takedown: ['embargoed', 'live', 'withdrawn'],
};

export function isLegalEssayAction(from: EssayState, action: EssayAction): boolean {
  return ALLOWED_FROM[action].includes(from);
}

/** The state an essay reaches through a legal action. */
export function essayStateAfter(action: EssayAction, liftInFuture: boolean): EssayState {
  switch (action) {
    case 'submit':
      return 'in_review';
    case 'publish':
      return liftInFuture ? 'embargoed' : 'live';
    case 'hold':
      return 'draft';
    case 'lift':
      return 'live';
    case 'withdraw':
      return 'withdrawn';
    case 'takedown':
      return 'taken_down';
    case 'edit':
    case 'withdrawal_request':
      return 'draft';
  }
}

export function isLicensableState(state: EssayState): boolean {
  return state === 'embargoed' || state === 'live';
}
