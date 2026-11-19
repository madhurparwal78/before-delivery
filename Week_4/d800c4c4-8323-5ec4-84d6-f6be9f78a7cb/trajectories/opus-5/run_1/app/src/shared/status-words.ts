import type { FeeStatus, ItemStatus, LoanStatus, PartState } from './types';

/** The one place that decides the word and shape a part outline shows. */
export function outlineStateWord(partState: PartState, itemStatus: ItemStatus): string {
  if (partState === 'missing') return 'missing';
  if (partState === 'out') return itemStatus === 'pending-photo' ? 'pending photo' : 'out';
  if (itemStatus === 'reserved') return 'reserved';
  if (itemStatus === 'held') return 'held';
  return 'on the wall';
}

const ITEM_STATUS_WORDS: Record<ItemStatus, string> = {
  'on-wall': 'on the wall',
  reserved: 'reserved',
  out: 'out',
  'pending-photo': 'pending photo',
  incomplete: 'incomplete',
  held: 'held',
};

const LOAN_STATUS_WORDS: Record<LoanStatus, string> = {
  reserved: 'reserved',
  out: 'out',
  'pending-photo': 'pending photo',
  'returned-partial': 'incomplete',
  'returned-complete': 'returned',
};

const FEE_STATUS_WORDS: Record<FeeStatus, string> = {
  raised: 'raised',
  settled: 'settled',
  'waived-by-coordinator': 'waived',
};

export function itemStatusWord(status: ItemStatus): string {
  return ITEM_STATUS_WORDS[status];
}

export function loanStatusWord(status: LoanStatus): string {
  return LOAN_STATUS_WORDS[status];
}

export function feeStatusWord(status: FeeStatus): string {
  return FEE_STATUS_WORDS[status];
}

/** The class that draws each status as an outline shape, never colour alone. */
export function shapeClassFor(word: string): string {
  return `stamp stamp-${word.replace(/ /g, '-')}`;
}
