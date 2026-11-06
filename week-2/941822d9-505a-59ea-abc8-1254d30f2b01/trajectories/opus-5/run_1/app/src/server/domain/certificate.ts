export type CertificateVersionState = 'sealing' | 'sealed' | 'reissued' | 'revoked';
export type CertificateState = 'sealing' | 'sealed' | 'revoked';

export interface CertificateVersionRow {
  readonly version: number;
  readonly state: CertificateVersionState;
  readonly nurseName: string;
  readonly sealedOn: string | null;
}

/** The current version is the newest sealed or revoked one, or version 1 while none is sealed. */
export function currentVersion(versions: readonly CertificateVersionRow[]): CertificateVersionRow {
  let current: CertificateVersionRow | null = null;
  let firstVersion: CertificateVersionRow | null = null;
  for (const version of versions) {
    if (version.version === 1) firstVersion = version;
    if (version.state === 'sealed' || version.state === 'revoked') {
      if (current === null || version.version > current.version) current = version;
    }
  }
  if (current !== null) return current;
  if (firstVersion === null) throw new Error('A certificate always has version 1');
  return firstVersion;
}

export function certificateState(versions: readonly CertificateVersionRow[]): CertificateState {
  const current = currentVersion(versions);
  if (current.state === 'revoked') return 'revoked';
  return current.state === 'sealed' ? 'sealed' : 'sealing';
}

/** A reissue is pending from the moment it is accepted until its new version is sealed. */
export function reissuePending(versions: readonly CertificateVersionRow[]): boolean {
  return versions.some((version) => version.version > 1 && version.state === 'sealing');
}

/** `issued_on` is the sealed date of version 1 and never changes. */
export function issuedOn(versions: readonly CertificateVersionRow[]): string | null {
  return versions.find((version) => version.version === 1)?.sealedOn ?? null;
}

export function formatSerial(issueYear: number, sequence: number): string {
  return `SPL-${issueYear}-${String(sequence).padStart(6, '0')}`;
}

export function certificateObjectKey(providerSlug: string, serial: string, version: number): string {
  return `certificates/${providerSlug}/${serial}/v${version}.pdf`;
}

export function exportObjectKey(hospitalSlug: string, exportId: string): string {
  return `exports/${hospitalSlug}/${exportId}.csv`;
}
