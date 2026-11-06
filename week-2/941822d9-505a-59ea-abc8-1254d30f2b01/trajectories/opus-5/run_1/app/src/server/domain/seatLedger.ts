export type LedgerMovementKind = 'purchase' | 'assignment' | 'return' | 'expiry';

export interface LedgerEntryDraft {
  readonly account: string;
  readonly seats: number;
}

export const PACK_ACCOUNT = 'pack';
const PURCHASES_ACCOUNT = 'purchases';
const EXPIRED_ACCOUNT = 'expired';

export function nurseAccount(nurseId: string): string {
  return `nurse:${nurseId}`;
}

/** Every movement is exactly two entries whose seats add up to zero. */
export function movementEntries(
  kind: LedgerMovementKind,
  seats: number,
  nurseId: string | null,
): readonly [LedgerEntryDraft, LedgerEntryDraft] {
  switch (kind) {
    case 'purchase':
      return [
        { account: PACK_ACCOUNT, seats },
        { account: PURCHASES_ACCOUNT, seats: -seats },
      ];
    case 'assignment':
      if (nurseId === null) throw new Error('An assignment movement needs a nurse');
      return [
        { account: PACK_ACCOUNT, seats: -seats },
        { account: nurseAccount(nurseId), seats },
      ];
    case 'return':
      if (nurseId === null) throw new Error('A return movement needs a nurse');
      return [
        { account: PACK_ACCOUNT, seats },
        { account: nurseAccount(nurseId), seats: -seats },
      ];
    case 'expiry':
      return [
        { account: PACK_ACCOUNT, seats: -seats },
        { account: EXPIRED_ACCOUNT, seats },
      ];
  }
}

export function packBalance(entries: readonly LedgerEntryDraft[]): number {
  let balance = 0;
  for (const entry of entries) {
    if (entry.account === PACK_ACCOUNT) balance += entry.seats;
  }
  return balance;
}

export const LEDGER_ACCOUNTS = {
  pack: PACK_ACCOUNT,
  purchases: PURCHASES_ACCOUNT,
  expired: EXPIRED_ACCOUNT,
} as const;
