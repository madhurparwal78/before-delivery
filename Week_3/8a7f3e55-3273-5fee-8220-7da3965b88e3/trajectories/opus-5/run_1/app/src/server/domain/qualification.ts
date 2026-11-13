import type { Setting } from '../../shared/api.js';

const CREDENTIALS_BY_SETTING: Record<Setting, readonly string[]> = {
  medical: ['NIC', 'BEI'],
  educational: ['EIPA', 'NIC'],
  legal: ['SC:L'],
  workplace: ['NIC', 'BEI'],
};

export interface HeldCredential {
  code: string;
  expires_on: string;
}

/**
 * An interpreter qualifies when, on the booking's agency-local start date, they hold an
 * unexpired credential from the setting's list.
 */
export function isQualified(
  credentials: readonly HeldCredential[],
  setting: Setting,
  assignmentDate: string,
): boolean {
  const accepted = CREDENTIALS_BY_SETTING[setting];
  return credentials.some(
    (credential) =>
      accepted.includes(credential.code) && credential.expires_on >= assignmentDate,
  );
}
