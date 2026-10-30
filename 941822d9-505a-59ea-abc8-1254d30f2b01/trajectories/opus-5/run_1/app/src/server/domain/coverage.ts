import { floorShare } from './money.js';

/**
 * The coverage policy in effect at an instant, and the split of a list price into the
 * hospital's share and the nurse's share, are decided only here.
 */

export interface CoveragePolicyRow {
  readonly coveragePercentHundredths: number;
  readonly effectiveOn: string;
}

/**
 * The policy in effect is the latest row whose effective date is today or earlier,
 * read in the provider's time zone. Later-dated rows are the scheduled change and
 * take effect at 00:00 provider time on their date with no request needed.
 */
export function policyInEffect(rows: readonly CoveragePolicyRow[], today: string): CoveragePolicyRow | null {
  let inEffect: CoveragePolicyRow | null = null;
  for (const row of rows) {
    if (row.effectiveOn <= today) inEffect = row;
  }
  return inEffect;
}

export function scheduledPolicy(rows: readonly CoveragePolicyRow[], today: string): CoveragePolicyRow | null {
  for (const row of rows) {
    if (row.effectiveOn > today) return row;
  }
  return null;
}

export interface Shares {
  readonly listPriceCents: number;
  readonly employerShareCents: number;
  readonly learnerShareCents: number;
  readonly coveragePercentHundredths: number;
}

/**
 * The employer share is the list price times the coverage percent, rounded down to the
 * cent; the learner pays the remainder, so the two add up to the list price exactly.
 */
export function splitShares(listPriceCents: number, coveragePercentHundredths: number): Shares {
  const employerShareCents = floorShare(listPriceCents, coveragePercentHundredths, 10000);
  return {
    listPriceCents,
    employerShareCents,
    learnerShareCents: listPriceCents - employerShareCents,
    coveragePercentHundredths,
  };
}

export type Funding = 'card' | 'co_pay' | 'seat';

export function fundingForShares(employerShareCents: number): Funding {
  return employerShareCents === 0 ? 'card' : 'co_pay';
}
