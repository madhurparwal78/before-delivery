import { config } from '../config.js';
import { serviceStates, withTimeout } from './state.js';

const CONTACT_TIMEOUT_MS = 3_000;

export class SearchUnavailable extends Error {}

export interface PackDocument {
  skuCode: string;
  skuName: string;
  drinkName: string;
  aliases: string[];
  noticeTitles: string[];
}

export function indexName(copyId: string): string {
  return `interval_${copyId}_packs`;
}

async function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  let response: Response;
  try {
    response = await withTimeout(
      (signal) =>
        fetch(`${config.meilisearchUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${config.meilisearchApiKey}`,
            'content-type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal,
        }),
      CONTACT_TIMEOUT_MS,
    );
  } catch {
    serviceStates.search.record(false);
    throw new SearchUnavailable('meilisearch unreachable');
  }
  const text = await response.text();
  if (response.status >= 500) {
    serviceStates.search.record(false);
    throw new SearchUnavailable(`meilisearch answered ${response.status}`);
  }
  serviceStates.search.record(true);
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, json };
}

export async function ensureIndex(copyId: string): Promise<void> {
  const name = indexName(copyId);
  const existing = await call('GET', `/indexes/${name}`);
  if (existing.status === 404) {
    await call('POST', '/indexes', { uid: name, primaryKey: 'skuCode' });
  }
  await call('PATCH', `/indexes/${name}/settings`, {
    searchableAttributes: ['skuName', 'drinkName', 'aliases', 'noticeTitles'],
    displayedAttributes: ['skuCode'],
    rankingRules: ['words', 'typo', 'proximity', 'attribute', 'exactness'],
  });
}

export async function putDocuments(copyId: string, documents: PackDocument[]): Promise<number> {
  const result = await call('PUT', `/indexes/${indexName(copyId)}/documents`, documents);
  const task = (result.json as { taskUid?: number }).taskUid;
  if (task === undefined) throw new SearchUnavailable('meilisearch refused the documents');
  return task;
}

export async function taskState(taskUid: number): Promise<'succeeded' | 'failed' | 'pending'> {
  const result = await call('GET', `/tasks/${taskUid}`);
  const status = (result.json as { status?: string }).status;
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed' || status === 'canceled') return 'failed';
  return 'pending';
}

export async function searchSkuCodes(copyId: string, query: string): Promise<string[]> {
  const result = await call('POST', `/indexes/${indexName(copyId)}/search`, {
    q: query,
    limit: 20,
    matchingStrategy: 'all',
    attributesToRetrieve: ['skuCode'],
  });
  const hits = (result.json as { hits?: { skuCode: string }[] }).hits ?? [];
  return hits.map((hit) => hit.skuCode);
}

export async function indexDocumentCount(copyId: string): Promise<number> {
  const result = await call('GET', `/indexes/${indexName(copyId)}/stats`);
  if (result.status === 404) return 0;
  return (result.json as { numberOfDocuments?: number }).numberOfDocuments ?? 0;
}

export async function pingSearch(): Promise<void> {
  try {
    await call('GET', '/health');
  } catch {
    /* the contact result is already recorded */
  }
}

export function searchDown(): boolean {
  return serviceStates.search.down;
}
