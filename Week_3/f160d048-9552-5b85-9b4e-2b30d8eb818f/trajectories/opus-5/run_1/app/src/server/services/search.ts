import { config } from '../config';
import type { CityId, PayBandId, RoleFamilyId, WorkPatternId } from '../../shared/reference';

export interface JobDocument {
  id: string;
  title: string;
  company_id: string;
  company_name: string;
  company_slug: string;
  city: CityId;
  city_name: string;
  role_family: RoleFamilyId;
  role_family_name: string;
  remote: WorkPatternId;
  pay_band: PayBandId;
  pay_low: number;
  pay_high: number;
  listed_at: number;
}

export interface CompanyDocument {
  id: string;
  slug: string;
  name: string;
  city: CityId;
  city_name: string;
  size: string;
  verified: boolean;
  rating: number | null;
  review_count: number;
  pay_report_count: number;
}

class SearchUnavailable extends Error {}

const headers: Record<string, string> = { 'content-type': 'application/json' };
if (config.meilisearchApiKey) headers['authorization'] = `Bearer ${config.meilisearchApiKey}`;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.meilisearchUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new SearchUnavailable('search is unreachable');
  }
  if (!response.ok) throw new SearchUnavailable(`search answered ${response.status}`);
  return (await response.json()) as T;
}

async function awaitTask(taskUid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = await call<{ status: string }>('GET', `/tasks/${taskUid}`);
    if (task.status === 'succeeded') return;
    if (task.status === 'failed' || task.status === 'canceled') throw new SearchUnavailable('indexing failed');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new SearchUnavailable('indexing did not finish');
}

async function writeAndWait(method: string, path: string, body?: unknown): Promise<void> {
  const task = await call<{ taskUid: number }>(method, path, body);
  await awaitTask(task.taskUid);
}

export async function isAvailable(): Promise<boolean> {
  try {
    const health = await call<{ status: string }>('GET', '/health');
    return health.status === 'available';
  } catch {
    return false;
  }
}

export async function ensureIndexes(): Promise<void> {
  for (const uid of ['jobs', 'companies']) {
    try {
      await call('GET', `/indexes/${uid}`);
    } catch {
      await writeAndWait('POST', '/indexes', { uid, primaryKey: 'id' });
    }
  }
  await writeAndWait('PATCH', '/indexes/jobs/settings', {
    searchableAttributes: ['title', 'company_name', 'city_name', 'role_family_name'],
    filterableAttributes: ['city', 'role_family', 'remote', 'pay_band', 'company_id'],
    sortableAttributes: ['listed_at'],
  });
  await writeAndWait('PATCH', '/indexes/companies/settings', {
    searchableAttributes: ['name', 'city_name'],
    filterableAttributes: ['city', 'verified'],
  });
}

export async function upsertJob(document: JobDocument): Promise<void> {
  await writeAndWait('POST', '/indexes/jobs/documents', [document]);
}

export async function deleteJob(id: string): Promise<void> {
  await writeAndWait('POST', '/indexes/jobs/documents/delete-batch', [id]);
}

export async function upsertCompany(document: CompanyDocument): Promise<void> {
  await writeAndWait('POST', '/indexes/companies/documents', [document]);
}

export async function replaceAll(jobs: JobDocument[], companies: CompanyDocument[]): Promise<void> {
  await writeAndWait('DELETE', '/indexes/jobs/documents');
  await writeAndWait('DELETE', '/indexes/companies/documents');
  if (jobs.length > 0) await writeAndWait('POST', '/indexes/jobs/documents', jobs);
  if (companies.length > 0) await writeAndWait('POST', '/indexes/companies/documents', companies);
}

export interface SearchQuery {
  q: string;
  filters: ReadonlyArray<ReadonlyArray<string>>;
  facets: ReadonlyArray<string>;
  page: number;
  pageSize: number;
  sortNewestWhenEmpty?: string;
}

export interface SearchOutcome<T> {
  total: number;
  hits: T[];
  facets: Record<string, Record<string, number>>;
}

export async function runSearch<T>(index: string, query: SearchQuery): Promise<SearchOutcome<T>> {
  const filter = query.filters.filter((group) => group.length > 0).map((group) => group.slice());
  const body: Record<string, unknown> = {
    q: query.q,
    filter,
    facets: query.facets.slice(),
    page: query.page,
    hitsPerPage: query.pageSize,
  };
  if (query.q === '' && query.sortNewestWhenEmpty) body['sort'] = [`${query.sortNewestWhenEmpty}:desc`];
  const result = await call<{
    hits: T[];
    totalHits: number;
    facetDistribution?: Record<string, Record<string, number>>;
  }>('POST', `/indexes/${index}/search`, body);
  return { total: result.totalHits, hits: result.hits, facets: result.facetDistribution ?? {} };
}
