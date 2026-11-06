import { query, type Queryable } from '../db/pool.js';
import { certificateState, currentVersion, issuedOn } from '../domain/certificate.js';
import { formatHours } from '../domain/contactHours.js';
import { LEDGER_ACCOUNTS, nurseAccount } from '../domain/seatLedger.js';
import { toVersionRows, type VersionRow } from './certificates.js';

/** Every sponsor figure is computed from the ledger and certificate rows of one hospital. */
export interface SponsorTotals {
  readonly seats_purchased: number;
  readonly seats_assigned: number;
  readonly seats_available: number;
  readonly seats_expired: number;
  readonly completions: number;
  readonly hours_awarded: string;
}

interface AccountSum {
  readonly account: string;
  readonly seats: string;
}

async function accountSums(client: Queryable, organisationId: string): Promise<AccountSum[]> {
  return query<AccountSum>(
    client,
    `SELECT le.account, sum(le.seats)::text AS seats
     FROM ledger_entries le JOIN packs p ON p.id = le.pack_id
     WHERE p.organisation_id = $1 GROUP BY le.account`,
    [organisationId],
  );
}

export interface HospitalCertificate {
  readonly id: string;
  readonly serial: string;
  readonly nurse_id: string;
  readonly nurse_email: string;
  readonly nurse_name: string;
  readonly course_title: string;
  readonly funding: string;
  readonly contact_hours_hundredths: number;
  readonly issued_on: string;
}

/** Only certificates in state sealed whose enrolment this hospital funded. */
export async function sealedCertificatesForHospital(
  client: Queryable,
  organisationId: string,
  nurseId: string | null = null,
): Promise<HospitalCertificate[]> {
  const rows = await query<{
    id: string;
    serial: string;
    user_id: string;
    nurse_email: string;
    course_title: string;
    funding: string;
    contact_hours_hundredths: number;
  }>(
    client,
    `SELECT ce.id, ce.serial, ce.user_id, u.email AS nurse_email, c.title AS course_title,
            e.funding, ce.contact_hours_hundredths
     FROM certificates ce
     JOIN enrolments e ON e.id = ce.enrolment_id
     JOIN courses c ON c.id = e.course_id
     JOIN users u ON u.id = ce.user_id
     WHERE e.sponsor_organisation_id = $1 AND e.funding IN ('seat', 'co_pay')
       AND ($2::uuid IS NULL OR ce.user_id = $2)
     ORDER BY ce.created_at`,
    [organisationId, nurseId],
  );
  if (rows.length === 0) return [];
  const versions = await query<VersionRow>(
    client,
    `SELECT id, certificate_id, version, state, nurse_name, sealed_on, origin
     FROM certificate_versions WHERE certificate_id = ANY($1) ORDER BY version`,
    [rows.map((row) => row.id)],
  );
  const byCertificate = new Map<string, VersionRow[]>();
  for (const version of versions) {
    const list = byCertificate.get(version.certificate_id) ?? [];
    list.push(version);
    byCertificate.set(version.certificate_id, list);
  }

  const out: HospitalCertificate[] = [];
  for (const row of rows) {
    const versionRows = byCertificate.get(row.id) ?? [];
    const domainVersions = toVersionRows(versionRows);
    if (domainVersions.length === 0 || certificateState(domainVersions) !== 'sealed') continue;
    const current = currentVersion(domainVersions);
    const issued = issuedOn(domainVersions);
    if (issued === null) continue;
    out.push({
      id: row.id,
      serial: row.serial,
      nurse_id: row.user_id,
      nurse_email: row.nurse_email,
      nurse_name: current.nurseName,
      course_title: row.course_title,
      funding: row.funding,
      contact_hours_hundredths: row.contact_hours_hundredths,
      issued_on: issued,
    });
  }
  return out;
}

export async function sponsorTotals(client: Queryable, organisationId: string): Promise<SponsorTotals> {
  const sums = await accountSums(client, organisationId);
  let purchases = 0;
  let assigned = 0;
  let available = 0;
  let expired = 0;
  for (const sum of sums) {
    const seats = Number.parseInt(sum.seats, 10);
    if (sum.account === LEDGER_ACCOUNTS.purchases) purchases += seats;
    else if (sum.account === LEDGER_ACCOUNTS.pack) available += seats;
    else if (sum.account === LEDGER_ACCOUNTS.expired) expired += seats;
    else assigned += seats;
  }
  const certificates = await sealedCertificatesForHospital(client, organisationId);
  const hours = certificates.reduce((total, certificate) => total + certificate.contact_hours_hundredths, 0);
  return {
    seats_purchased: -purchases,
    seats_assigned: assigned,
    seats_available: available,
    seats_expired: expired,
    completions: certificates.length,
    hours_awarded: formatHours(hours),
  };
}

export interface LearnerSummary {
  readonly id: string;
  readonly display_name: string;
  readonly email: string;
  readonly seats_held: number;
  readonly hours_completed: string;
}

/** Search covers only nurses employed by that hospital, matched literally. */
export async function searchLearners(
  client: Queryable,
  organisationId: string,
  text: string,
): Promise<LearnerSummary[]> {
  const nurses = await query<{ id: string; display_name: string; email: string }>(
    client,
    `SELECT id, display_name, email FROM users
     WHERE organisation_id = $1 AND role = 'learner'
       AND ($2 = '' OR position(lower($2) in lower(display_name)) > 0 OR position(lower($2) in lower(email)) > 0)
     ORDER BY display_name`,
    [organisationId, text],
  );
  if (nurses.length === 0) return [];

  const seatRows = await query<{ account: string; seats: string }>(
    client,
    `SELECT le.account, sum(le.seats)::text AS seats
     FROM ledger_entries le JOIN packs p ON p.id = le.pack_id
     WHERE p.organisation_id = $1 AND le.account = ANY($2) GROUP BY le.account`,
    [organisationId, nurses.map((nurse) => nurseAccount(nurse.id))],
  );
  const seatsByAccount = new Map(seatRows.map((row) => [row.account, Number.parseInt(row.seats, 10)]));

  const certificates = await sealedCertificatesForHospital(client, organisationId);
  const hoursByNurse = new Map<string, number>();
  for (const certificate of certificates) {
    hoursByNurse.set(
      certificate.nurse_id,
      (hoursByNurse.get(certificate.nurse_id) ?? 0) + certificate.contact_hours_hundredths,
    );
  }

  return nurses.map((nurse) => ({
    id: nurse.id,
    display_name: nurse.display_name,
    email: nurse.email,
    seats_held: seatsByAccount.get(nurseAccount(nurse.id)) ?? 0,
    hours_completed: formatHours(hoursByNurse.get(nurse.id) ?? 0),
  }));
}

export interface MonthlyRow {
  readonly month: string;
  readonly completions: number;
  readonly hours: string;
}

/** Grouped by the month of each certificate's provider-time issue date. */
export async function monthlyReport(
  client: Queryable,
  organisationId: string,
  year: number,
): Promise<MonthlyRow[]> {
  const certificates = await sealedCertificatesForHospital(client, organisationId);
  const months: { completions: number; hours: number }[] = Array.from({ length: 12 }, () => ({
    completions: 0,
    hours: 0,
  }));
  for (const certificate of certificates) {
    if (!certificate.issued_on.startsWith(`${year}-`)) continue;
    const monthIndex = Number.parseInt(certificate.issued_on.slice(5, 7), 10) - 1;
    const bucket = months[monthIndex];
    if (bucket === undefined) continue;
    bucket.completions += 1;
    bucket.hours += certificate.contact_hours_hundredths;
  }
  return months.map((bucket, index) => ({
    month: `${year}-${String(index + 1).padStart(2, '0')}`,
    completions: bucket.completions,
    hours: formatHours(bucket.hours),
  }));
}
