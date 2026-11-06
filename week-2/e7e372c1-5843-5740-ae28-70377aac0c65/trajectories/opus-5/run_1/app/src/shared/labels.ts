/** Domain labels and keys shared by the server and the browser. */

export const ROW_KEYS = [
  'beginning-balance',
  'eth-acquired',
  'staking-rewards',
  'ending-balance',
  'cumulative-staking-rewards',
  'diluted-shares',
] as const;

export type RowKey = (typeof ROW_KEYS)[number];

export const ROW_LABELS: Readonly<Record<RowKey, string>> = {
  'beginning-balance': 'Beginning ETH balance',
  'eth-acquired': 'ETH acquired',
  'staking-rewards': 'Staking rewards',
  'ending-balance': 'Ending ETH balance',
  'cumulative-staking-rewards': 'Cumulative staking rewards',
  'diluted-shares': 'Assumed diluted shares',
};

export const FIGURE_KEYS = ['eth-held', 'staking-rewards', 'eth-per-1000-diluted', 'mnav'] as const;

export type FigureKey = (typeof FIGURE_KEYS)[number];

export const FIGURE_LABELS: Readonly<Record<FigureKey, string>> = {
  'eth-held': 'Total ETH held',
  'staking-rewards': 'Cumulative staking rewards',
  'eth-per-1000-diluted': 'ETH per 1,000 diluted shares',
  mnav: 'mNAV',
};

export const SHARE_EVENT_KINDS = ['atm_settlement', 'warrant_exercise', 'buyback'] as const;

export type ShareEventKind = (typeof SHARE_EVENT_KINDS)[number];

export const SHARE_EVENT_LABELS: Readonly<Record<ShareEventKind, string>> = {
  atm_settlement: 'ATM settlement',
  warrant_exercise: 'Warrant exercise',
  buyback: 'Buyback',
};

export const CLOCK_BADGES = {
  holdings: 'Holdings week',
  equity: 'Equity',
  eth: 'ETH live',
} as const;

export type ClockKey = keyof typeof CLOCK_BADGES;

export const RESTATEMENT_STATES = [
  'draft',
  'in_review',
  'returned',
  'cleared',
  'queued',
  'published',
  'superseded',
] as const;

export type RestatementState = (typeof RESTATEMENT_STATES)[number];
