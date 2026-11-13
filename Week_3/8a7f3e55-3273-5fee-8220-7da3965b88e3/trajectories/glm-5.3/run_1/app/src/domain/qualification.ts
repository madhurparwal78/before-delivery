// Qualification, decided once here: an interpreter qualifies when they hold an unexpired
// credential from the setting's list on the booking's agency-local start date.
export const SETTING_CREDENTIALS: Record<string, string[]> = {
  medical: ['NIC', 'BEI'],
  educational: ['EIPA', 'NIC'],
  legal: ['SC:L'],
  workplace: ['NIC', 'BEI'],
};

export interface CredentialRecord {
  code: string;
  expires_on: string;
}

export function isQualified(
  setting: string,
  credentials: CredentialRecord[],
  assignmentDate: string,
): boolean {
  const wanted = SETTING_CREDENTIALS[setting];
  if (!wanted) return false;
  return credentials.some((c) => wanted.includes(c.code) && c.expires_on >= assignmentDate);
}

/** Busy means holding a seat on another booking that is not cancelled and whose start-to-end
 * span overlaps this one. Spans that only touch do not overlap. */
export function spansOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}
