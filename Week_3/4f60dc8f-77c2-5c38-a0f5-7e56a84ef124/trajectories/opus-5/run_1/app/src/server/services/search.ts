import { config } from '../config.js';
import { AppError } from '../http/app-error.js';
import { formatMoney } from '../../shared/money.js';
import type { CaseStudy, Insight, Service } from '../../shared/domain.js';

export class SearchUnavailable extends AppError {
  constructor() {
    super('search_unavailable');
  }
}

const INDEX = 'studio_content';

export type SearchDocument = {
  id: string;
  kind: 'case_study' | 'service' | 'insight';
  title: string;
  summary: string;
  url: string;
};

const request = async (
  path: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> => {
  try {
    return await fetch(`${config.meilisearch.url}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${config.meilisearch.apiKey}`,
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new SearchUnavailable();
  }
};

export const searchUp = async (): Promise<boolean> => {
  try {
    const response = await request('/health', {}, 5_000);
    await response.arrayBuffer().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  }
};

export const ensureIndex = async (): Promise<void> => {
  const existing = await request(`/indexes/${INDEX}`);
  if (existing.status === 404) {
    await existing.arrayBuffer().catch(() => undefined);
    const created = await request('/indexes', {
      method: 'POST',
      body: JSON.stringify({ uid: INDEX, primaryKey: 'id' }),
    });
    await created.arrayBuffer().catch(() => undefined);
  } else {
    await existing.arrayBuffer().catch(() => undefined);
  }
  const settings = await request(`/indexes/${INDEX}/settings`, {
    method: 'PATCH',
    body: JSON.stringify({ searchableAttributes: ['title', 'summary'] }),
  });
  await settings.arrayBuffer().catch(() => undefined);
};

export const documentsFor = (input: {
  caseStudies: CaseStudy[];
  services: Service[];
  insights: Insight[];
}): SearchDocument[] => [
  ...input.caseStudies
    .filter((study) => study.published)
    .map(
      (study): SearchDocument => ({
        id: `case_study-${study.slug}`,
        kind: 'case_study',
        title: study.title,
        summary: study.summary,
        url: `/work/${study.slug}`,
      }),
    ),
  ...input.services.map(
    (service): SearchDocument => ({
      id: `service-${service.code}`,
      kind: 'service',
      title: service.title,
      summary: `${formatMoney(BigInt(service.list_price_pence), 'GBP')} per colourway`,
      url: '/#services',
    }),
  ),
  ...input.insights.map(
    (insight): SearchDocument => ({
      id: `insight-${insight.slug}`,
      kind: 'insight',
      title: insight.title,
      summary: insight.summary,
      url: `/#insight-${insight.slug}`,
    }),
  ),
];

export const replaceIndex = async (documents: SearchDocument[]): Promise<void> => {
  await ensureIndex();
  const wanted = new Set(documents.map((document) => document.id));
  const current = await request(`/indexes/${INDEX}/documents?limit=1000&fields=id`);
  if (current.ok) {
    const body = (await current.json()) as { results: { id: string }[] };
    const stale = body.results.map((entry) => entry.id).filter((id) => !wanted.has(id));
    if (stale.length > 0) {
      const removed = await request(`/indexes/${INDEX}/documents/delete-batch`, {
        method: 'POST',
        body: JSON.stringify(stale),
      });
      await removed.arrayBuffer().catch(() => undefined);
    }
  } else {
    await current.arrayBuffer().catch(() => undefined);
  }
  if (documents.length > 0) {
    const added = await request(`/indexes/${INDEX}/documents`, {
      method: 'PUT',
      body: JSON.stringify(documents),
    });
    await added.arrayBuffer().catch(() => undefined);
  }
};

export type SearchHit = { kind: SearchDocument['kind']; title: string; summary: string; url: string };

export const search = async (query: string): Promise<SearchHit[]> => {
  if (query === '') return [];
  const response = await request(`/indexes/${INDEX}/search`, {
    method: 'POST',
    body: JSON.stringify({ q: query, limit: 20 }),
  });
  if (response.status === 404) {
    await response.arrayBuffer().catch(() => undefined);
    await ensureIndex();
    return [];
  }
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined);
    throw new SearchUnavailable();
  }
  const body = (await response.json()) as { hits: SearchDocument[] };
  return body.hits.map((hit) => ({
    kind: hit.kind,
    title: hit.title,
    summary: hit.summary,
    url: hit.url,
  }));
};
