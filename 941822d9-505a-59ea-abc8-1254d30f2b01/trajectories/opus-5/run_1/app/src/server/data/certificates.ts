import { one, query, type Queryable } from '../db/pool.js';
import {
  certificateState,
  currentVersion,
  issuedOn,
  reissuePending,
  type CertificateState,
  type CertificateVersionRow,
  type CertificateVersionState,
} from '../domain/certificate.js';
import { formatHours } from '../domain/contactHours.js';
import type { AuthUser } from '../http/context.js';

export interface CertificateRow {
  readonly id: string;
  readonly enrolment_id: string;
  readonly user_id: string;
  readonly serial: string;
  readonly contact_hours_hundredths: number;
  readonly verified_module_count: number;
  readonly course_title: string;
  readonly sponsor_organisation_id: string | null;
  readonly funding: string;
}

export interface VersionRow {
  readonly id: string;
  readonly certificate_id: string;
  readonly version: number;
  readonly state: CertificateVersionState;
  readonly nurse_name: string;
  readonly sealed_on: string | null;
  readonly origin: string;
}

const CERTIFICATE_SELECT = `
  SELECT ce.id, ce.enrolment_id, ce.user_id, ce.serial, ce.contact_hours_hundredths,
         ce.verified_module_count, c.title AS course_title,
         e.sponsor_organisation_id, e.funding
  FROM certificates ce
  JOIN enrolments e ON e.id = ce.enrolment_id
  JOIN courses c ON c.id = e.course_id
`;

export async function getCertificate(client: Queryable, id: string): Promise<CertificateRow | null> {
  return one<CertificateRow>(client, `${CERTIFICATE_SELECT} WHERE ce.id = $1`, [id]);
}

export async function getVersions(client: Queryable, certificateId: string): Promise<VersionRow[]> {
  return query<VersionRow>(
    client,
    `SELECT id, certificate_id, version, state, nurse_name, sealed_on, origin
     FROM certificate_versions WHERE certificate_id = $1 ORDER BY version`,
    [certificateId],
  );
}

export function toVersionRows(rows: readonly VersionRow[]): CertificateVersionRow[] {
  return rows.map((row) => ({
    version: row.version,
    state: row.state,
    nurseName: row.nurse_name,
    sealedOn: row.sealed_on,
  }));
}

export interface CertificateJson {
  readonly id: string;
  readonly serial: string;
  readonly state: CertificateState;
  readonly version: number;
  readonly reissue_pending: boolean;
  readonly nurse_name: string;
  readonly course_title: string;
  readonly contact_hours: string;
  readonly issued_on: string | null;
  readonly enrolment_id: string;
  readonly verified_module_count: number;
  readonly versions: readonly {
    version: number;
    state: CertificateVersionState;
    sealed_on: string | null;
    nurse_name: string;
  }[];
}

export function certificateJson(
  certificate: CertificateRow,
  versionRows: readonly VersionRow[],
): CertificateJson {
  const versions = toVersionRows(versionRows);
  const current = currentVersion(versions);
  return {
    id: certificate.id,
    serial: certificate.serial,
    state: certificateState(versions),
    version: current.version,
    reissue_pending: reissuePending(versions),
    nurse_name: current.nurseName,
    course_title: certificate.course_title,
    contact_hours: formatHours(certificate.contact_hours_hundredths),
    issued_on: issuedOn(versions),
    enrolment_id: certificate.enrolment_id,
    verified_module_count: certificate.verified_module_count,
    versions: versionRows.map((row) => ({
      version: row.version,
      state: row.state,
      sealed_on: row.sealed_on,
      nurse_name: row.nurse_name,
    })),
  };
}

export async function certificateJsonById(
  client: Queryable,
  certificate: CertificateRow,
): Promise<CertificateJson> {
  return certificateJson(certificate, await getVersions(client, certificate.id));
}

/** Readers are the certificate's learner, the planner, and the funding hospital's coordinator. */
export function canReadCertificate(certificate: CertificateRow, user: AuthUser): boolean {
  if (user.role === 'planner') return true;
  if (user.role === 'learner') return certificate.user_id === user.id;
  if (user.role === 'coordinator') {
    return (
      user.organisationId !== null &&
      certificate.sponsor_organisation_id === user.organisationId &&
      (certificate.funding === 'seat' || certificate.funding === 'co_pay')
    );
  }
  return false;
}

export async function certificatesOfLearner(client: Queryable, userId: string): Promise<CertificateRow[]> {
  return query<CertificateRow>(client, `${CERTIFICATE_SELECT} WHERE ce.user_id = $1 ORDER BY ce.created_at`, [userId]);
}

/**
 * `total_hours` is the sum of the hours of certificates in state sealed, counting each
 * certificate once whatever its number of versions.
 */
export async function transcriptTotalHundredths(
  client: Queryable,
  certificates: readonly CertificateRow[],
): Promise<number> {
  let total = 0;
  for (const certificate of certificates) {
    const versions = toVersionRows(await getVersions(client, certificate.id));
    if (certificateState(versions) === 'sealed') total += certificate.contact_hours_hundredths;
  }
  return total;
}

/**
 * Planner search matches the serial, the nurse name of any version, or the nurse's
 * current display name, literally and case-insensitively.
 */
export async function searchCertificates(client: Queryable, text: string): Promise<CertificateRow[]> {
  if (text === '') {
    return query<CertificateRow>(client, `${CERTIFICATE_SELECT} ORDER BY ce.created_at`);
  }
  return query<CertificateRow>(
    client,
    `${CERTIFICATE_SELECT}
     JOIN users u ON u.id = ce.user_id
     WHERE position(lower($1) in lower(ce.serial)) > 0
        OR position(lower($1) in lower(u.display_name)) > 0
        OR EXISTS (
             SELECT 1 FROM certificate_versions cv
             WHERE cv.certificate_id = ce.id AND position(lower($1) in lower(cv.nurse_name)) > 0
           )
     ORDER BY ce.created_at`,
    [text],
  );
}
