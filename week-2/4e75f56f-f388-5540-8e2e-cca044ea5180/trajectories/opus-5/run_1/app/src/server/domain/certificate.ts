export type CertificateGap =
  | 'balance_unpaid'
  | 'day1_check_in'
  | 'day2_check_in'
  | 'licence_not_matched';

export interface CertificateEligibilityInput {
  readonly balanceCents: number;
  readonly day1: boolean;
  readonly day2: boolean;
  readonly licenceStatus: 'none' | 'submitted' | 'matched' | 'rejected';
}

/** The eligibility gaps, always in the published order. */
export function certificateGaps(input: CertificateEligibilityInput): CertificateGap[] {
  const gaps: CertificateGap[] = [];
  if (input.balanceCents > 0) gaps.push('balance_unpaid');
  if (!input.day1) gaps.push('day1_check_in');
  if (!input.day2) gaps.push('day2_check_in');
  if (input.licenceStatus !== 'matched') gaps.push('licence_not_matched');
  return gaps;
}

export function formatCertificateNumber(sequence: number): string {
  return `OB-2027-${sequence.toString().padStart(4, '0')}`;
}
