/** The Meilisearch index: settings, documents and task confirmation. */

import { MeiliSearch, type Index, type SearchResponse as MeiliSearchResponse } from 'meilisearch';
import { config } from '../config';
import type { FacetName } from '../../shared/types';

export class SearchUnavailable extends Error {}

export interface UnitDocument {
  code: string;
  floor: number;
  stack: string;
  band: string;
  bedrooms: number;
  areaM2: number;
  areaSqft: number;
  bearing: number;
  facing: string;
  viewTag: string;
  price: number;
  pricePerM2: number;
  pricePerSqft: number;
  priceVersion: number;
  status: string;
  viewPhotographed: boolean;
}

const client = new MeiliSearch({ host: config.meilisearch.url, apiKey: config.meilisearch.apiKey });

export function unitsIndex(): Index<UnitDocument> {
  return client.index<UnitDocument>(config.meilisearch.index);
}

export const FACET_ATTRIBUTES: Record<FacetName, string> = {
  bedrooms: 'bedrooms',
  band: 'band',
  facing: 'facing',
  view: 'viewTag',
  status: 'status',
};

const SETTINGS = {
  searchableAttributes: ['code', 'facing', 'viewTag', 'band'],
  filterableAttributes: ['bedrooms', 'band', 'facing', 'viewTag', 'status', 'price', 'floor', 'stack'],
  sortableAttributes: ['price', 'floor', 'stack'],
  typoTolerance: { enabled: false },
};

export async function applySearchSettings(): Promise<void> {
  try {
    await client.createIndex(config.meilisearch.index, { primaryKey: 'code' });
  } catch (error) {
    if (!isAlreadyExists(error)) throw wrap(error);
  }
  try {
    await unitsIndex().updateSettings(SETTINGS);
  } catch (error) {
    throw wrap(error);
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'index_already_exists';
}

function wrap(error: unknown): Error {
  if (error instanceof SearchUnavailable) return error;
  return new SearchUnavailable(error instanceof Error ? error.message : 'search unavailable');
}

export async function pushDocuments(documents: UnitDocument[]): Promise<number> {
  try {
    const task = await unitsIndex().addDocuments(documents, { primaryKey: 'code' });
    return task.taskUid;
  } catch (error) {
    throw wrap(error);
  }
}

export async function deleteDocuments(codes: string[]): Promise<number> {
  try {
    const task = await unitsIndex().deleteDocuments(codes);
    return task.taskUid;
  } catch (error) {
    throw wrap(error);
  }
}

export type TaskState = 'succeeded' | 'failed' | 'pending';

export async function taskState(taskUid: number): Promise<TaskState> {
  try {
    const task = await client.tasks.getTask(taskUid);
    if (task.status === 'succeeded') return 'succeeded';
    if (task.status === 'failed' || task.status === 'canceled') return 'failed';
    return 'pending';
  } catch (error) {
    throw wrap(error);
  }
}

export interface IndexQuery {
  q: string;
  filters: string[];
  facets: string[];
}

export async function searchIndex(input: IndexQuery): Promise<MeiliSearchResponse<UnitDocument>> {
  try {
    return await unitsIndex().search(input.q === '' ? null : input.q, {
      filter: input.filters.length > 0 ? input.filters : undefined,
      facets: input.facets,
      limit: 1000,
      sort: ['price:asc', 'floor:asc', 'stack:asc'],
      matchingStrategy: 'all',
    });
  } catch (error) {
    throw wrap(error);
  }
}

export async function searchIsReachable(): Promise<boolean> {
  try {
    await client.health();
    return true;
  } catch {
    return false;
  }
}
