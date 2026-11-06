import { config } from '../config.js';
import type { Category, Format } from '../domain/model.js';
import type { CatalogueLicence } from '../domain/money.js';

/** Thrown when Meilisearch is unreachable or refuses the request. */
export class SearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchError';
  }
}

/** The document fields the index holds, and nothing else. */
export interface SearchDocument {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly category: Category;
  readonly licences: readonly CatalogueLicence[];
  readonly formats: readonly Format[];
  readonly price_from_cents: number;
  readonly published_at: number;
  readonly rebuilding: boolean;
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 10_000,
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (config.search.apiKey !== '') headers.authorization = `Bearer ${config.search.apiKey}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${config.search.url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new SearchError(`Search request failed: ${String(error)}`);
  }
  if (!response.ok) {
    throw new SearchError(`Search answered ${response.status} for ${method} ${path}`);
  }
  return (await response.json()) as T;
}

interface TaskReply {
  readonly taskUid: number;
}

interface TaskStatus {
  readonly status: 'enqueued' | 'processing' | 'succeeded' | 'failed' | 'canceled';
}

/** Waits for Meilisearch to confirm a task, so a stage confirms only after it does. */
async function awaitTask(taskUid: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const task = await call<TaskStatus>('GET', `/tasks/${taskUid}`);
    if (task.status === 'succeeded') return;
    if (task.status === 'failed' || task.status === 'canceled') {
      throw new SearchError(`Search task ${taskUid} ${task.status}`);
    }
    if (Date.now() > deadline) throw new SearchError(`Search task ${taskUid} timed out`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const index = (): string => encodeURIComponent(config.search.index);

export async function ensureIndex(): Promise<void> {
  // An index that already exists is the expected state on every later start.
  const existing = await call<unknown>('GET', `/indexes/${index()}`).catch(() => null);
  if (existing === null) {
    const created = await call<TaskReply>('POST', '/indexes', {
      uid: config.search.index,
      primaryKey: 'slug',
    });
    await awaitTask(created.taskUid);
  }

  const settings = await call<TaskReply>('PATCH', `/indexes/${index()}/settings`, {
    searchableAttributes: ['title', 'description', 'category'],
    filterableAttributes: ['category', 'licences', 'formats'],
    sortableAttributes: ['price_from_cents', 'published_at'],
  });
  await awaitTask(settings.taskUid);
}

export async function putDocuments(documents: readonly SearchDocument[]): Promise<void> {
  if (documents.length === 0) return;
  const task = await call<TaskReply>('PUT', `/indexes/${index()}/documents`, documents);
  await awaitTask(task.taskUid);
}

export async function deleteDocument(slug: string): Promise<void> {
  const task = await call<TaskReply>(
    'DELETE',
    `/indexes/${index()}/documents/${encodeURIComponent(slug)}`,
  );
  await awaitTask(task.taskUid);
}

export async function deleteDocuments(slugs: readonly string[]): Promise<void> {
  if (slugs.length === 0) return;
  const task = await call<TaskReply>('POST', `/indexes/${index()}/documents/delete-batch`, slugs);
  await awaitTask(task.taskUid);
}

export async function deleteAllDocuments(): Promise<void> {
  const task = await call<TaskReply>('DELETE', `/indexes/${index()}/documents`);
  await awaitTask(task.taskUid);
}

export type SortOrder = 'newest' | 'price_asc' | 'price_desc';

export interface SearchSelection {
  readonly q: string;
  readonly category: readonly Category[];
  readonly licence: readonly CatalogueLicence[];
  readonly format: readonly Format[];
  readonly sort: SortOrder;
  readonly page: number;
  readonly pageSize: number;
}

export interface FacetCounts {
  readonly category: Readonly<Record<Category, number>>;
  readonly licence: Readonly<Record<CatalogueLicence, number>>;
  readonly format: Readonly<Record<Format, number>>;
}

export interface SearchResult {
  readonly total: number;
  readonly hits: readonly SearchDocument[];
  readonly facets: FacetCounts;
}

function filterFor(values: readonly string[], attribute: string): string | null {
  if (values.length === 0) return null;
  return `(${values.map((v) => `${attribute} = "${v}"`).join(' OR ')})`;
}

const SORT_CLAUSE: Readonly<Record<SortOrder, readonly string[]>> = {
  newest: ['published_at:desc'],
  price_asc: ['price_from_cents:asc'],
  price_desc: ['price_from_cents:desc'],
};

type Group = 'category' | 'licence' | 'format';

/** The filterable attribute each facet group lives on. */
const GROUP_ATTRIBUTE: Readonly<Record<Group, string>> = {
  category: 'category',
  licence: 'licences',
  format: 'formats',
};

function filtersExcept(selection: SearchSelection, except: Group | null): string[] {
  const clauses: string[] = [];
  if (except !== 'category') {
    const f = filterFor(selection.category, 'category');
    if (f !== null) clauses.push(f);
  }
  if (except !== 'licence') {
    const f = filterFor(selection.licence, 'licences');
    if (f !== null) clauses.push(f);
  }
  if (except !== 'format') {
    const f = filterFor(selection.format, 'formats');
    if (f !== null) clauses.push(f);
  }
  return clauses;
}

interface MultiSearchReply {
  readonly results: readonly {
    readonly hits: readonly SearchDocument[];
    readonly estimatedTotalHits?: number;
    readonly totalHits?: number;
    readonly facetDistribution?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  }[];
}

function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = 0;
  return out;
}

const CATEGORY_KEYS: readonly Category[] = ['hard-surface', 'miniature', 'scan'];
const LICENCE_KEYS: readonly CatalogueLicence[] = ['personal', 'commercial', 'studio'];
const FORMAT_KEYS: readonly Format[] = ['glb', 'stl'];

/**
 * One multi-search gives the page of results and, per group, the distribution
 * computed with that group's own selection left out.
 */
export async function search(selection: SearchSelection): Promise<SearchResult> {
  const groups: readonly Group[] = ['category', 'licence', 'format'];
  const common = {
    indexUid: config.search.index,
    q: selection.q,
    sort: [...SORT_CLAUSE[selection.sort]],
  };
  const queries = [
    {
      ...common,
      filter: filtersExcept(selection, null),
      offset: (selection.page - 1) * selection.pageSize,
      limit: selection.pageSize,
    },
    ...groups.map((group) => ({
      ...common,
      filter: filtersExcept(selection, group),
      facets: [GROUP_ATTRIBUTE[group]],
      limit: 0,
    })),
  ];
  const reply = await call<MultiSearchReply>('POST', '/multi-search', { queries });
  const main = reply.results[0];
  if (main === undefined) throw new SearchError('Search returned no result set');

  const facets: Record<Group, Record<string, number>> = {
    category: zeroed(CATEGORY_KEYS),
    licence: zeroed(LICENCE_KEYS),
    format: zeroed(FORMAT_KEYS),
  };
  groups.forEach((group, i) => {
    const distribution = reply.results[i + 1]?.facetDistribution?.[GROUP_ATTRIBUTE[group]] ?? {};
    const target = facets[group];
    for (const [value, count] of Object.entries(distribution)) {
      if (value in target) target[value] = count;
    }
  });

  return {
    total: main.totalHits ?? main.estimatedTotalHits ?? 0,
    hits: main.hits,
    facets: facets as unknown as FacetCounts,
  };
}

/** Every document in the index, newest first, for the catalogue export. */
export async function allDocumentsNewestFirst(): Promise<readonly SearchDocument[]> {
  const out: SearchDocument[] = [];
  for (let offset = 0; ; offset += 200) {
    const reply = await call<{ hits: readonly SearchDocument[] }>(
      'POST',
      `/indexes/${index()}/search`,
      { q: '', sort: ['published_at:desc'], offset, limit: 200 },
    );
    out.push(...reply.hits);
    if (reply.hits.length < 200) break;
  }
  return out;
}

export async function searchUp(): Promise<boolean> {
  try {
    await call<{ status: string }>('GET', '/health', undefined, 3_000);
    return true;
  } catch {
    return false;
  }
}
