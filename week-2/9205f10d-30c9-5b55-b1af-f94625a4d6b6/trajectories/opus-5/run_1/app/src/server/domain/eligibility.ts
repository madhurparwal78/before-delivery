import type { CredentialType } from '../../shared/types.js';

export interface CredentialRecord {
  credential_type: CredentialType;
  verified: boolean;
  expires_on: string | null;
}

/**
 * The one claim-eligibility rule: a verified credential of the required type whose
 * expiry falls on or after the job's agency date. The claim date does not matter.
 */
export function hasCredentialOnDate(
  credentials: readonly CredentialRecord[],
  required: CredentialType,
  jobDate: string,
): boolean {
  return credentials.some(
    (credential) =>
      credential.credential_type === required &&
      credential.verified &&
      credential.expires_on !== null &&
      credential.expires_on >= jobDate,
  );
}

export interface Window {
  starts_at: Date;
  ends_at: Date;
}

/**
 * The one overlap rule: a window runs from its start up to but not including its end,
 * so back-to-back jobs do not overlap.
 */
export function windowsOverlap(left: Window, right: Window): boolean {
  return (
    left.starts_at.getTime() < right.ends_at.getTime() &&
    right.starts_at.getTime() < left.ends_at.getTime()
  );
}

/** Credential badges: verified, unexpired codes today in agency time, alphabetical. */
export function credentialBadges(
  credentials: readonly CredentialRecord[],
  today: string,
): CredentialType[] {
  const codes = credentials
    .filter(
      (credential) =>
        credential.verified && credential.expires_on !== null && credential.expires_on >= today,
    )
    .map((credential) => credential.credential_type);
  return [...new Set(codes)].sort((left, right) => left.localeCompare(right));
}

/** The one credential status rule: verified lapses into expired the day after its expiry. */
export function credentialStatus(
  credential: CredentialRecord,
  today: string,
): 'uploaded' | 'verified' | 'expired' {
  if (!credential.verified) return 'uploaded';
  if (credential.expires_on !== null && credential.expires_on < today) return 'expired';
  return 'verified';
}
