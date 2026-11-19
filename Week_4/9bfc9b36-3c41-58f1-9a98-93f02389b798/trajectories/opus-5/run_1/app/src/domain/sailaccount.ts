import { roundHalfAway } from '../shared/units';

/** The one place that works out a sail account, in exact pence. */

export const TAX_RATE_PERCENT = 20;
export const DEPOSIT_PERCENT = 40;

export type SailAccountStatus = 'deposit_due' | 'balance_due' | 'settled';

export interface SailAccountFigures {
  readonly area_mm2: number;
  readonly rate_pence_per_m2: number;
  readonly charge_pence: number;
  readonly tax_rate_percent: number;
  readonly tax_pence: number;
  readonly total_pence: number;
  readonly deposit_pence: number;
  readonly paid_pence: number;
  readonly credited_pence: number;
  readonly balance_pence: number;
  readonly status: SailAccountStatus;
}

export function sailAccountFigures(
  areaMm2: number,
  ratePencePerM2: number,
  paidPence: number,
  creditedPence: number,
): SailAccountFigures {
  const chargePence = roundHalfAway(BigInt(areaMm2) * BigInt(ratePencePerM2), 1000000n);
  const taxPence = roundHalfAway(BigInt(chargePence) * BigInt(TAX_RATE_PERCENT), 100n);
  const totalPence = chargePence + taxPence;
  const depositPence = roundHalfAway(BigInt(totalPence) * BigInt(DEPOSIT_PERCENT), 100n);
  const balancePence = totalPence - paidPence - creditedPence;
  const status: SailAccountStatus =
    balancePence === 0 ? 'settled' : paidPence + creditedPence < depositPence ? 'deposit_due' : 'balance_due';
  return {
    area_mm2: areaMm2,
    rate_pence_per_m2: ratePencePerM2,
    charge_pence: chargePence,
    tax_rate_percent: TAX_RATE_PERCENT,
    tax_pence: taxPence,
    total_pence: totalPence,
    deposit_pence: depositPence,
    paid_pence: paidPence,
    credited_pence: creditedPence,
    balance_pence: balancePence,
    status,
  };
}
