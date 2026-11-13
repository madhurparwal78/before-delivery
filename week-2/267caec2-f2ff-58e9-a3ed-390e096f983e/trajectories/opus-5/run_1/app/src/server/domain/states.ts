import { invalidTransition } from '../copy';
import type { Award, EntryState, RoundState } from './types';

export type EntryAction =
  | 'edit'
  | 'delete'
  | 'add_asset'
  | 'remove_asset'
  | 'submit'
  | 'withdraw'
  | 'pass'
  | 'disqualify'
  | 'reinstate';

const ENTRY_TRANSITIONS: Record<EntryAction, readonly EntryState[]> = {
  edit: ['draft'],
  delete: ['draft'],
  add_asset: ['draft'],
  remove_asset: ['draft'],
  submit: ['draft'],
  withdraw: ['submitted'],
  pass: ['submitted'],
  disqualify: ['submitted', 'screened'],
  reinstate: ['disqualified'],
};

export function requireEntryState(state: EntryState, action: EntryAction): void {
  if (!ENTRY_TRANSITIONS[action].includes(state)) {
    throw invalidTransition(state, action);
  }
}

export type RoundAction = 'open' | 'close' | 'confirm' | 'publish' | 'add_juror';

const ROUND_TRANSITIONS: Record<RoundAction, readonly RoundState[]> = {
  open: ['scheduled'],
  close: ['open'],
  confirm: ['closed'],
  publish: ['normalised'],
  add_juror: ['scheduled', 'open'],
};

export function requireRoundState(state: RoundState, action: RoundAction): void {
  if (!ROUND_TRANSITIONS[action].includes(state)) {
    throw invalidTransition(state, action);
  }
}

const STATUS_LABEL: Record<EntryState, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  screened: 'Screened',
  disqualified: 'Disqualified',
  withdrawn: 'Withdrawn',
  round_1: 'Round 1',
  shortlisted: 'Shortlisted',
  eliminated: 'Not shortlisted',
  final_round: 'Final round',
  winner: 'Winner',
  finalist: 'Finalist',
  honourable_mention: 'Honourable mention',
  published: 'Published',
};

export function statusLabel(state: EntryState, award: Award | null): string {
  return state === 'published' && award !== null ? STATUS_LABEL[award] : STATUS_LABEL[state];
}
