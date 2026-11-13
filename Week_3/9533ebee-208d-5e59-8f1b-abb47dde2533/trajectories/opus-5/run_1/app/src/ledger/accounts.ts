/** The ledger account names, each held per asset. */

export const CUSTODY = 'custody';
export const SUPPLY = 'supply';
export const RESERVE = 'reserve';
export const SWAP = 'swap';

export const walletAccount = (actorId: string): string => `wallet:${actorId}`;
export const collateralAccount = (positionId: string): string => `collateral:${positionId}`;
export const loanAccount = (positionId: string): string => `loan:${positionId}`;

/** The kinds of posting the market writes. */
export const POSTING_KINDS = [
  'transfer_in',
  'supply',
  'withdrawal',
  'lock',
  'release',
  'draw',
  'accrual',
  'repay',
  'swap',
  'liquidation',
] as const;

export type PostingKind = (typeof POSTING_KINDS)[number];
