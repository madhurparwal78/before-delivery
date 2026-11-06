/** The settlement split: the one place that divides a deposit between release and damage. */

export interface SettlementSplit {
  readonly depositCents: number;
  readonly releasedCents: number;
  readonly damageCents: number;
  readonly damageFromDepositCents: number;
  readonly extraDamageCents: number;
  readonly lateFeeCents: number;
  readonly totalChargedCents: number;
}

export function splitSettlement(
  depositCents: number,
  damageCents: number,
  lateFeeCents: number,
): SettlementSplit {
  const damageFromDepositCents = Math.min(damageCents, depositCents);
  return {
    depositCents,
    releasedCents: depositCents - damageFromDepositCents,
    damageCents,
    damageFromDepositCents,
    extraDamageCents: damageCents - damageFromDepositCents,
    lateFeeCents,
    totalChargedCents: damageCents + lateFeeCents,
  };
}

/** A settlement needs billing only when it has a billing record to write. */
export function needsBilling(split: SettlementSplit): boolean {
  return split.releasedCents > 0 || split.extraDamageCents > 0 || split.lateFeeCents > 0;
}
