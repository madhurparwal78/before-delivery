import { config } from '../config.js';
import { guard, markService } from './availability.js';

export interface SearchHit {
  slug: string;
  title: string;
  description: string;
  category: string;
  licences: string[];
  formats: string[];
  price_from_cents: number;
  published_at: number;
  rebuilding: boolean;
}

export interface SearchDoc {
  slug: string;
  title: string;
  description: string;
  category: string;
  licences: string[];
  formats: string[];
  price_from_cents: number;
  published_at: number;
  rebuilding: boolean;
}

interface TaskEnvelope {
  taskUid: number;
}

const headers = (): Record<string, string> => ({
  Authorization: `Bearer ${config.meilisearch.apiKey}`,
  'Content-Type': 'application/json',
});

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  return guard('search', async () => {
    const response = await fetch(`${config.meilisearch.url}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`meilisearch status ${response.status}`);
    return (await response.json()) as T;
  });
}

async function awaitTask(taskUid: number): Promise<void> {
  const started = Date.now();
  for (;;) {
    const task = await call<{ status: string; error?: unknown }>(`/tasks/${taskUid}`, 'GET');
    if (task.status === 'succeeded') return;
    if (task.status === 'failed' || task.status === 'canceled') throw new Error(`meilisearch task failed: ${JSON.stringify(task.error)}`);
    if (Date.now() - started > 30_000) throw new Error('meilisearch task timeout');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

export async function ensureIndex(): Promise<void> {
  const existing = await call<{ results: { uid: string }[] }>('/indexes', 'GET');
  if (!existing.results.some(index => index.uid === config.meilisearch.index)) {
    const task = await call<TaskEnvelope>(`/indexes`, 'POST', { uid: config.meilisearch.index, primaryKey: 'slug' });
    await awaitTask(task.taskUid);
  }
  const task = await call<TaskEnvelope>(`/indexes/${config.meilisearch.index}/settings`, 'PATCH', {
    searchableAttributes: ['title', 'description', 'category'],
    filterableAttributes: ['category', 'licences', 'formats'],
    sortableAttributes: ['price_from_cents', 'published_at'],
  });
  await awaitTask(task.taskUid);
  markService('search', true);
}

export async function pingSearch(): Promise<void> {
  const response = await fetch(`${config.meilisearch.url}/health`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('search health failed');
  markService('search', true);
}

export async function putDoc(doc: SearchDoc): Promise<void> {
  const task = await call<TaskEnvelope>(`/indexes/${config.meilisearch.index}/documents`, 'POST', [doc]);
  await awaitTask(task.taskUid);
}

export async function deleteDoc(slug: string): Promise<void> {
  const task = await call<TaskEnvelope>(`/indexes/${config.meilisearch.index}/documents/${encodeURIComponent(slug)}`, 'DELETE');
  await awaitTask(task.taskUid);
}

export interface SearchFilters {
  q: string;
  category: string[];
  licence: string[];
  format: string[];
  sort: 'newest' | 'price_asc' | 'price_desc';
  page: number;
  perPage: number;
  withFacets: boolean;
}

export interface SearchResult {
  total: number;
  hits: SearchHit[];
  facets: { category: Record<string, number>; licence: Record<string, number>; format: Record<string, number> };
}

const term = (field: string, values: string[]): string =>
  values.length === 1 ? `${field} = ${JSON.stringify(values[0])}` : `(${values.map(v => `${field} = ${JSON.stringify(v)}`).join(' OR ')})`;

function filterOf(category: string[], licence: string[], format: string[]): string | undefined {
  const parts: string[] = [];
  if (category.length > 0) parts.push(term('category', category));
  if (licence.length > 0) parts.push(term('licences', licence));
  if (format.length > 0) parts.push(term('formats', format));
  return parts.length === 0 ? undefined : parts.join(' AND ');
}

const sortOf = (sort: SearchFilters['sort']): string[] | undefined =>
  sort === 'newest' ? ['published_at:desc'] : sort === 'price_asc' ? ['price_from_cents:asc'] : ['price_from_cents:desc'];



interface MeiliSearchResponse {
  hits: SearchHit[];
  estimatedTotalHits: number;
  facetDistribution?: Record<string, Record<string, number>>;
}

export async function search(filters: SearchFilters): Promise<SearchResult> {
  const base: Record<string, unknown> = {
    q: filters.q,
    limit: filters.perPage,
    offset: (filters.page - 1) * filters.perPage,
  };
  const filter = filterOf(filters.category, filters.licence, filters.format);
  if (filter !== undefined) base['filter'] = filter;
  const sort = sortOf(filters.sort);
  if (sort !== undefined) base['sort'] = sort;
  const main = await call<MeiliSearchResponse>(`/indexes/${config.meilisearch.index}/search`, 'POST', base);
  const facets: SearchResult['facets'] = { category: {}, licence: {}, format: {} };
  if (filters.withFacets) {
    const runs: { key: keyof SearchResult['facets']; category: string[]; licence: string[]; format: string[] }[] = [
      { key: 'category', category: [], licence: filters.licence, format: filters.format },
      { key: 'licence', category: filters.category, licence: [], format: filters.format },
      { key: 'format', category: filters.category, licence: filters.licence, format: [] },
    ];
    await Promise.all(
      runs.map(async run => {
        const groupFilter = filterOf(run.category, run.licence, run.format);
        const attribute = run.key === 'category' ? 'category' : run.key === 'licence' ? 'licences' : 'formats';
        const result = await call<MeiliSearchResponse>(`/indexes/${config.meilisearch.index}/search`, 'POST', {
          q: filters.q,
          filter: groupFilter,
          limit: 0,
          facets: [attribute],
        });
        facets[run.key] = result.facetDistribution?.[attribute] ?? {};
      }),
    );
  }
  return { total: main.estimatedTotalHits, hits: main.hits, facets };
}

export async function allIndexed(filters: { q?: string; sort?: 'newest' }): Promise<SearchHit[]> {
  const result = await call<MeiliSearchResponse>(`/indexes/${config.meilisearch.index}/search`, 'POST', {
    q: filters.q ?? '',
    sort: filters.sort === 'newest' ? ['published_at:desc'] : undefined,
    limit: 10_000,
  });
  return result.hits;
}
