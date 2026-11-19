import { config } from './config.js';

export interface RecipeDocument {
  id: string;
  name: string;
  note: string;
  tags: string[];
  operations: string[];
  argumentValues: string[];
  ownerUserId: string | null;
  teamId: string | null;
  latestVersion: number;
  updatedAt: number;
}

export class SearchDown extends Error {}

let forcedDown = false;
let settingsApplied = false;
const pendingDocuments = new Map<string, RecipeDocument>();
const pendingDeletes = new Set<string>();

export function setSearchOutage(down: boolean): void {
  forcedDown = down;
}

async function call(path: string, init: { method: string; body?: unknown }): Promise<unknown> {
  if (forcedDown) throw new SearchDown('search outage');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.search.apiKey !== '') headers['authorization'] = `Bearer ${config.search.apiKey}`;
  try {
    const response = await fetch(`${config.search.url}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404 && init.method === 'POST' && path.endsWith('/search')) {
      throw new SearchDown('index missing');
    }
    if (!response.ok) throw new SearchDown(`search said ${response.status}`);
    return await response.json();
  } catch (cause) {
    if (cause instanceof SearchDown) throw cause;
    throw new SearchDown('search unreachable');
  }
}

const indexPath = `/indexes/${encodeURIComponent(config.search.index)}`;

async function applySettings(): Promise<void> {
  // An index that already exists answers 400; only the settings call below decides success.
  await call('/indexes', { method: 'POST', body: { uid: config.search.index, primaryKey: 'id' } }).catch(
    () => undefined,
  );
  await call(`${indexPath}/settings`, {
    method: 'PATCH',
    body: {
      searchableAttributes: ['name', 'tags', 'operations', 'argumentValues', 'note'],
      filterableAttributes: ['ownerUserId', 'teamId'],
      rankingRules: ['words', 'typo', 'proximity', 'attribute', 'exactness', 'updatedAt:desc'],
    },
  });
  settingsApplied = true;
}

async function flushPending(): Promise<void> {
  if (!settingsApplied) await applySettings();
  if (pendingDocuments.size > 0) {
    const documents = [...pendingDocuments.values()];
    await call(`${indexPath}/documents`, { method: 'PUT', body: documents });
    for (const document of documents) pendingDocuments.delete(document.id);
  }
  if (pendingDeletes.size > 0) {
    const ids = [...pendingDeletes];
    await call(`${indexPath}/documents/delete-batch`, { method: 'POST', body: ids });
    for (const id of ids) pendingDeletes.delete(id);
  }
}

/** Applies index settings and retries every five seconds until they land. */
export function startSearchIndexing(): void {
  const tick = (): void => {
    void flushPending().catch(() => {
      settingsApplied = false;
    });
  };
  tick();
  setInterval(tick, 5000).unref();
}

/** Queues a document and tries to index it at once, so a save is searchable within two seconds. */
export async function indexRecipe(document: RecipeDocument): Promise<void> {
  pendingDocuments.set(document.id, document);
  pendingDeletes.delete(document.id);
  await flushPending().catch(() => {
    settingsApplied = false;
  });
}

export async function removeRecipeFromIndex(id: string): Promise<void> {
  pendingDeletes.add(id);
  pendingDocuments.delete(id);
  await flushPending().catch(() => {
    settingsApplied = false;
  });
}

export interface SearchOutcome {
  ids: string[];
  total: number;
}

/** Searches the index, filtered to what the caller may see. */
export async function searchRecipes(query: string, userId: string, teamIds: readonly string[]): Promise<SearchOutcome> {
  const filters = [`ownerUserId = "${userId}"`];
  if (teamIds.length > 0) {
    filters.push(`teamId IN [${teamIds.map((id) => `"${id}"`).join(', ')}]`);
  }
  const body = {
    q: query,
    filter: filters.join(' OR '),
    page: 1,
    hitsPerPage: 100,
    attributesToRetrieve: ['id'],
  };
  const result = (await call(`${indexPath}/search`, { method: 'POST', body })) as {
    hits?: { id?: string }[];
    totalHits?: number;
  };
  const ids = (result.hits ?? []).map((hit) => hit.id).filter((id): id is string => typeof id === 'string');
  return { ids, total: result.totalHits ?? ids.length };
}
