// Search index management: the only place that writes search documents.
import crypto from 'node:crypto';
import type { App } from '../lib/app.js';
import { meili } from '../lib/meili.js';
import { companyHitBySlug } from './projection.js';
import { payBandFor, cityName, ROLE_FAMILIES } from '../lib/reference.js';

export interface JobDoc {
  id: string;
  title: string;
  company_id: string;
  company_name: string;
  company_slug: string;
  city: string;
  city_name: string;
  role_family: string;
  role_family_name: string;
  remote: string;
  pay_band: string;
  pay_low: number;
  pay_high: number;
  listed_at: number;
}

export async function jobDoc(app: App, jobId: string): Promise<JobDoc | null> {
  const row = await app.db.one<{
    id: string;
    title: string;
    company_id: string;
    company_name: string;
    company_slug: string;
    city: string;
    role_family: string;
    remote: string;
    pay_low: number;
    pay_high: number;
    listed_at: Date;
  }>(
    `select j.id, j.title, j.company_id, j.city, j.role_family, j.remote, j.pay_low, j.pay_high, j.listed_at,
       c.name as company_name, c.slug as company_slug
     from jobs j join companies c on c.id = j.company_id
     where j.id = $1 and j.status = 'listed'`,
    [jobId],
  );
  if (!row || !row.listed_at) return null;
  return {
    id: row.id,
    title: row.title,
    company_id: row.company_id,
    company_name: row.company_name,
    company_slug: row.company_slug,
    city: row.city,
    city_name: cityName(row.city),
    role_family: row.role_family,
    role_family_name: roleNameOf(row.role_family),
    remote: row.remote,
    pay_band: payBandFor(row.pay_low),
    pay_low: row.pay_low,
    pay_high: row.pay_high,
    listed_at: Math.floor(row.listed_at.getTime() / 1000),
  };
}

function roleNameOf(id: string): string {
  return ROLE_FAMILIES.find((r) => r.id === id)?.name ?? id;
}

export async function indexJob(app: App, jobId: string): Promise<boolean> {
  const doc = await jobDoc(app, jobId);
  if (!doc) {
    await meili.deleteDocument('jobs', jobId).catch(() => undefined);
    return true;
  }
  const task = await meili.updateDocuments('jobs', [doc as unknown as Record<string, unknown>]);
  await meili.waitForTask(task);
  return true;
}

export async function deleteJobDoc(jobId: string): Promise<void> {
  const task = await meili.deleteDocument('jobs', jobId);
  await meili.waitForTask(task);
}

export async function companyDoc(app: App, slug: string): Promise<Record<string, unknown> | null> {
  const hit = await companyHitBySlug(app, slug);
  if (!hit) return null;
  const company = await app.db.one<{ id: string }>('select id from companies where slug = $1', [slug]);
  if (!company) return null;
  return {
    id: company.id,
    slug: hit.slug,
    name: hit.name,
    city: hit.city,
    city_name: hit.city_name,
    size: hit.size,
    verified: hit.verified,
    rating: hit.rating,
    review_count: hit.review_count,
    pay_report_count: hit.pay_report_count,
  };
}

export async function indexCompany(app: App, slug: string): Promise<void> {
  const doc = await companyDoc(app, slug);
  if (!doc) return;
  const task = await meili.updateDocuments('companies', [doc]);
  await meili.waitForTask(task);
}

export async function ensureIndexes(): Promise<void> {
  await meili.createIndex('jobs', 'id');
  const jobsTask = await meili.setSettings('jobs', {
    searchableAttributes: ['title', 'company_name', 'city_name', 'role_family_name'],
    filterableAttributes: ['city', 'role_family', 'remote', 'pay_band', 'company_id'],
    sortableAttributes: ['listed_at'],
  });
  await meili.waitForTask(jobsTask);
  await meili.createIndex('companies', 'id');
  const companiesTask = await meili.setSettings('companies', {
    searchableAttributes: ['name', 'city_name'],
    filterableAttributes: ['city', 'verified'],
  });
  await meili.waitForTask(companiesTask);
}

export async function syncAllFromPostgres(app: App): Promise<void> {
  const jobs = await app.db.many<{ id: string }>("select id from jobs where status = 'listed'");
  if (jobs.length > 0) {
    const docs: Record<string, unknown>[] = [];
    for (const job of jobs) {
      const doc = await jobDoc(app, job.id);
      if (doc) docs.push(doc as unknown as Record<string, unknown>);
    }
    if (docs.length > 0) {
      const task = await meili.updateDocuments('jobs', docs);
      await meili.waitForTask(task);
    }
  }
  const companies = await app.db.many<{ slug: string }>('select slug from companies');
  const companyDocs: Record<string, unknown>[] = [];
  for (const company of companies) {
    const doc = await companyDoc(app, company.slug);
    if (doc) companyDocs.push(doc);
  }
  if (companyDocs.length > 0) {
    const task = await meili.updateDocuments('companies', companyDocs);
    await meili.waitForTask(task);
  }
}

// Queue a sync entry for retry when search is down.
export async function queueSync(
  app: App,
  kind: 'job' | 'company',
  recordId: string,
  action: 'upsert' | 'delete',
): Promise<void> {
  await app.db.query(
    'delete from search_sync where kind = $1 and record_id = $2',
    [kind, recordId],
  );
  await app.db.query(
    `insert into search_sync (id, kind, record_id, action, next_attempt_at)
     values ($1, $2, $3, $4, now())`,
    [crypto.randomUUID(), kind, recordId, action],
  );
}
