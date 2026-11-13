import {
  cityName,
  payBandFor,
  roleFamilyName,
  type CityId,
  type PayBandId,
  type RoleFamilyId,
  type WorkPatternId,
} from '../../shared/reference';
import { config } from '../config';
import { db, type Db } from '../db/pool';
import { approvedPayReports, approvedReviews, buildRating, findCompanyById } from '../domain/projection';
import * as search from './search';

export type SyncTarget = 'company' | 'job';
export type SyncOperation = 'upsert' | 'delete';

async function companyDocument(companyId: string): Promise<search.CompanyDocument | null> {
  const company = await findCompanyById(companyId);
  if (!company) return null;
  const rating = buildRating(await approvedReviews(company.id));
  const reports = await approvedPayReports(company.id);
  return {
    id: company.id,
    slug: company.slug,
    name: company.name,
    city: company.city,
    city_name: cityName(company.city),
    size: company.size,
    verified: company.verified,
    rating: rating.overall,
    review_count: rating.review_count,
    pay_report_count: reports.length,
  };
}

interface JobDocRow {
  id: string;
  title: string;
  company_id: string;
  company_name: string;
  company_slug: string;
  city: CityId;
  role_family: RoleFamilyId;
  remote: WorkPatternId;
  pay_low: number;
  pay_high: number;
  listed_at: Date | null;
  status: string;
}

export function jobDocumentFrom(row: JobDocRow): search.JobDocument {
  return {
    id: row.id,
    title: row.title,
    company_id: row.company_id,
    company_name: row.company_name,
    company_slug: row.company_slug,
    city: row.city,
    city_name: cityName(row.city),
    role_family: row.role_family,
    role_family_name: roleFamilyName(row.role_family),
    remote: row.remote,
    pay_band: payBandFor(row.pay_low) as PayBandId,
    pay_low: row.pay_low,
    pay_high: row.pay_high,
    listed_at: Math.floor((row.listed_at ?? new Date(0)).getTime() / 1000),
  };
}

async function jobDocRow(jobId: string): Promise<JobDocRow | null> {
  return db.one<JobDocRow>(
    `SELECT j.id, j.title, j.company_id, c.name AS company_name, c.slug AS company_slug, j.city, j.role_family,
            j.remote, j.pay_low, j.pay_high, j.listed_at, j.status
       FROM jobs j JOIN companies c ON c.id = j.company_id
      WHERE j.id = $1`,
    [jobId],
  );
}

/** Records that a document is out of date; the entry is retried until it is applied. */
export async function queueSync(
  tx: Db,
  now: Date,
  target: SyncTarget,
  targetId: string,
  operation: SyncOperation,
): Promise<void> {
  await tx.query(
    `INSERT INTO search_sync (target, target_id, operation, created_at, next_attempt_at) VALUES ($1, $2, $3, $4, $4)`,
    [target, targetId, operation, now],
  );
}

async function applyEntry(target: SyncTarget, targetId: string, operation: SyncOperation): Promise<void> {
  if (target === 'company') {
    const document = await companyDocument(targetId);
    if (document) await search.upsertCompany(document);
    return;
  }
  if (operation === 'delete') {
    await search.deleteJob(targetId);
    return;
  }
  const row = await jobDocRow(targetId);
  if (!row || row.status !== 'listed') await search.deleteJob(targetId);
  else await search.upsertJob(jobDocumentFrom(row));
}

/**
 * Applies every entry queued for this target now, waiting for the index task.
 * A failure leaves the entries queued for the retry loop.
 */
async function flushSync(target: SyncTarget, targetId: string): Promise<void> {
  const entries = await db.query<{ id: string; operation: SyncOperation }>(
    `SELECT id, operation FROM search_sync WHERE target = $1 AND target_id = $2 AND done_at IS NULL ORDER BY id`,
    [target, targetId],
  );
  if (entries.length === 0) return;
  const last = entries[entries.length - 1] as { id: string; operation: SyncOperation };
  await applyEntry(target, targetId, last.operation);
  await db.query(
    `UPDATE search_sync SET done_at = now() WHERE target = $1 AND target_id = $2 AND done_at IS NULL AND id <= $3`,
    [target, targetId, last.id],
  );
}

export async function flushSyncQuietly(target: SyncTarget, targetId: string): Promise<void> {
  try {
    await flushSync(target, targetId);
  } catch {
    /** The entry stays queued and the retry loop picks it up. */
  }
}

export async function pendingSyncCount(): Promise<number> {
  const row = await db.one<{ count: string }>('SELECT count(*) AS count FROM search_sync WHERE done_at IS NULL');
  return Number(row?.count ?? 0);
}

export async function runDueSync(now: Date): Promise<void> {
  const due = await db.query<{ target: SyncTarget; target_id: string }>(
    `SELECT DISTINCT target, target_id FROM search_sync WHERE done_at IS NULL AND next_attempt_at <= $1`,
    [now],
  );
  for (const entry of due) {
    try {
      await flushSync(entry.target, entry.target_id);
    } catch {
      await db.query(
        `UPDATE search_sync SET next_attempt_at = $3 WHERE target = $1 AND target_id = $2 AND done_at IS NULL`,
        [entry.target, entry.target_id, new Date(now.getTime() + config.outboxRetrySeconds * 1000)],
      );
    }
  }
}

/** On every start, make both indexes match PostgreSQL. */
export async function reindexAll(): Promise<void> {
  const jobRows = await db.query<JobDocRow>(
    `SELECT j.id, j.title, j.company_id, c.name AS company_name, c.slug AS company_slug, j.city, j.role_family,
            j.remote, j.pay_low, j.pay_high, j.listed_at, j.status
       FROM jobs j JOIN companies c ON c.id = j.company_id
      WHERE j.status = 'listed'`,
  );
  const companyIds = await db.query<{ id: string }>('SELECT id FROM companies');
  const companyDocuments: search.CompanyDocument[] = [];
  for (const row of companyIds) {
    const document = await companyDocument(row.id);
    if (document) companyDocuments.push(document);
  }
  await search.replaceAll(jobRows.map(jobDocumentFrom), companyDocuments);
}
