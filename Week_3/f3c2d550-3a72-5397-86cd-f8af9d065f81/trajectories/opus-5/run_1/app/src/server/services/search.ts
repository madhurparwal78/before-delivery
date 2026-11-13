/** The search index, reached with the URL, key and index name from the environment. */

export class SearchUnreachable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchUnreachable';
  }
}

export interface SearchDocument {
  id: string;
  title: string;
  maker: string | null;
  year: number | null;
  materials: string[];
  finish: string | null;
  colour_family: string;
  notes: string | null;
}

export const SEARCHABLE_ATTRIBUTES = [
  'title',
  'maker',
  'year',
  'materials',
  'finish',
  'colour_family',
  'notes',
];

export const FILTERABLE_ATTRIBUTES = ['colour_family', 'materials', 'finish', 'maker', 'year'];

function baseUrl(): string {
  const url = process.env.MEILISEARCH_URL;
  if (!url) throw new Error('MEILISEARCH_URL is not set');
  return url.replace(/\/+$/, '');
}

export function indexName(): string {
  return process.env.MEILISEARCH_INDEX ?? 'references';
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 10_000,
): Promise<{ status: number; json: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = {};
  const key = process.env.MEILISEARCH_API_KEY;
  if (key) headers.authorization = `Bearer ${key}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : null };
  } catch (error) {
    throw new SearchUnreachable(`search request failed: ${String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

interface TaskResponse {
  taskUid: number;
}

function taskUidOf(json: unknown): number {
  const uid = (json as TaskResponse | null)?.taskUid;
  if (typeof uid !== 'number') throw new SearchUnreachable('search did not return a task');
  return uid;
}

/** Waits for the index to report the task as succeeded. */
export async function waitForTask(taskUid: number, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { status, json } = await call('GET', `/tasks/${taskUid}`);
    if (status !== 200) throw new SearchUnreachable(`search refused a task read: ${status}`);
    const state = (json as { status?: string } | null)?.status;
    if (state === 'succeeded') return true;
    if (state === 'failed' || state === 'canceled') return false;
    if (Date.now() > deadline) throw new SearchUnreachable('search task did not settle in time');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

export async function reachable(): Promise<boolean> {
  try {
    const { status } = await call('GET', '/health', undefined, 3_000);
    return status === 200;
  } catch {
    return false;
  }
}

export interface IndexCheck {
  existed: boolean;
}

/** Creates the index and its published settings when they are missing. */
export async function ensureIndex(): Promise<IndexCheck> {
  const name = indexName();
  const existing = await call('GET', `/indexes/${name}`, undefined, 5_000);
  if (existing.status === 404) {
    const created = await call('POST', '/indexes', { uid: name, primaryKey: 'id' });
    if (created.status >= 400) throw new SearchUnreachable(`search refused to create the index: ${created.status}`);
    await waitForTask(taskUidOf(created.json));
    await applySettings(name);
    return { existed: false };
  }
  if (existing.status !== 200) {
    throw new SearchUnreachable(`search refused an index read: ${existing.status}`);
  }
  const settings = await call('GET', `/indexes/${name}/settings`, undefined, 5_000);
  if (settings.status !== 200) {
    throw new SearchUnreachable(`search refused a settings read: ${settings.status}`);
  }
  const current = settings.json as {
    searchableAttributes?: string[];
    filterableAttributes?: string[];
  };
  if (
    !sameSet(current.searchableAttributes, SEARCHABLE_ATTRIBUTES) ||
    !sameSet(current.filterableAttributes, FILTERABLE_ATTRIBUTES)
  ) {
    await applySettings(name);
  }
  return { existed: true };
}

function sameSet(actual: string[] | undefined, wanted: string[]): boolean {
  if (!actual || actual.length !== wanted.length) return false;
  return wanted.every((attribute) => actual.includes(attribute));
}

async function applySettings(name: string): Promise<void> {
  const patched = await call('PATCH', `/indexes/${name}/settings`, {
    searchableAttributes: SEARCHABLE_ATTRIBUTES,
    filterableAttributes: FILTERABLE_ATTRIBUTES,
  });
  if (patched.status >= 400) {
    throw new SearchUnreachable(`search refused the index settings: ${patched.status}`);
  }
  await waitForTask(taskUidOf(patched.json));
}

export async function upsertDocuments(documents: SearchDocument[]): Promise<boolean> {
  if (documents.length === 0) return true;
  const response = await call('PUT', `/indexes/${indexName()}/documents`, documents, 20_000);
  if (response.status >= 400) {
    throw new SearchUnreachable(`search refused documents: ${response.status}`);
  }
  return waitForTask(taskUidOf(response.json), 20_000);
}

export async function deleteDocument(id: string): Promise<boolean> {
  const response = await call('DELETE', `/indexes/${indexName()}/documents/${encodeURIComponent(id)}`);
  if (response.status >= 400) {
    throw new SearchUnreachable(`search refused a document deletion: ${response.status}`);
  }
  return waitForTask(taskUidOf(response.json));
}

export interface SearchFilters {
  colour_family?: string;
  material?: string;
  finish?: string;
}

function filterExpression(filters: SearchFilters): string[] {
  const clauses: string[] = [];
  if (filters.colour_family) clauses.push(`colour_family = ${quote(filters.colour_family)}`);
  if (filters.material) clauses.push(`materials = ${quote(filters.material)}`);
  if (filters.finish) clauses.push(`finish = ${quote(filters.finish)}`);
  return clauses;
}

function quote(value: string): string {
  return `"${value.replace(/["\\]/g, (character) => `\\${character}`)}"`;
}

/** Returns the matching reference ids in the index's own ranking order. */
export async function searchIds(query: string, filters: SearchFilters): Promise<string[]> {
  const body: Record<string, unknown> = {
    q: query,
    limit: 500,
    attributesToRetrieve: ['id'],
  };
  const clauses = filterExpression(filters);
  if (clauses.length > 0) body.filter = clauses;
  const response = await call('POST', `/indexes/${indexName()}/search`, body);
  if (response.status >= 400) {
    throw new SearchUnreachable(`search refused a query: ${response.status}`);
  }
  const hits = (response.json as { hits?: Array<{ id?: string }> } | null)?.hits ?? [];
  return hits.map((hit) => hit.id).filter((id): id is string => typeof id === 'string');
}
