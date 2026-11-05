import type { Credit } from '../../shared/types.ts';

/** Spendable credit: the one place a household's holds meet its balance. */

export function holdForUnits(units: number, priceCents: number, pack: number): number {
  return units * Math.ceil(priceCents / pack);
}

export function creditOf(balanceCents: number, heldCents: number): Credit {
  return {
    balance_cents: balanceCents,
    held_cents: heldCents,
    spendable_cents: balanceCents - heldCents,
  };
}

export function householdAccount(code: string): string {
  return `household:${code}`;
}
