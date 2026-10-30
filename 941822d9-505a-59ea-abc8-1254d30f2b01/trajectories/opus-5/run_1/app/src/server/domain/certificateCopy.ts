import type { CertificateState } from './certificate.js';

/**
 * The private-field allow-list. Certificate emails, PDFs, the verification API and the
 * verification page carry exactly these fields and nothing else: never a licence number,
 * date of birth, nurse email, price, share or coverage percent.
 */
export interface CertificateCopy {
  readonly serial: string;
  readonly nurse_name: string;
  readonly course_title: string;
  readonly contact_hours: string;
  readonly issued_on: string | null;
  readonly state: Extract<CertificateState, 'sealed' | 'revoked'>;
  readonly provider: string;
  readonly accreditation_statement: string;
}

export interface CertificateCopySource {
  readonly serial: string;
  readonly nurseName: string;
  readonly courseTitle: string;
  readonly contactHours: string;
  readonly issuedOn: string | null;
  readonly state: 'sealed' | 'revoked';
  readonly provider: string;
  readonly accreditationStatement: string;
  readonly version: number;
}

export function certificateCopy(source: CertificateCopySource): CertificateCopy {
  return {
    serial: source.serial,
    nurse_name: source.nurseName,
    course_title: source.courseTitle,
    contact_hours: source.contactHours,
    issued_on: source.issuedOn,
    state: source.state,
    provider: source.provider,
    accreditation_statement: source.accreditationStatement,
  };
}
