/** Faceted search: the index supplies the matching set, Postgres supplies live status. */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { pool } from '../db';
import { config } from '../config';
import { ApiError } from '../errors';
import { FIELD_MESSAGES } from '../../shared/errors';
import { FACET_NAMES, FACET_VALUES, matchesSearchText, type SearchQuery } from '../../shared/searchInput';
import { compareUnitCodes } from '../../shared/units';
import type { FacetName, PublicUnit, SearchResponse } from '../../shared/types';
import { FACET_ATTRIBUTES, searchIndex, type UnitDocument } from '../search/client';
import { unconfirmedCodes, waitForIndexConfirmation } from '../search/pending';
import { applyLapseCheck } from './lapse';
import { isVisibleToBuyers, loadUnits, publicUnit } from './units';

const cursorKey = createHmac('sha256', config.s3.secretAccessKey).update('highwater-search-cursor').digest();

interface CursorPosition {
  price: number;
  code: string;
}

function filtersFingerprint(query: SearchQuery): string {
  return JSON.stringify([
    query.q,
    ...FACET_NAMES.map((name) => query[name]),
    query.priceMin,
    query.priceMax,
  ]);
}

function signCursor(query: SearchQuery, position: CursorPosition): string {
  const payload = Buffer.from(JSON.stringify(position), 'utf8').toString('base64url');
  const signature = createHmac('sha256', cursorKey)
    .update(`${filtersFingerprint(query)}|${payload}`)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function readCursor(query: SearchQuery, cursor: string): CursorPosition {
  const dot = cursor.lastIndexOf('.');
  if (dot <= 0) throw new ApiError('invalid', { fields: { after: FIELD_MESSAGES.cursor } });
  const payload = cursor.slice(0, dot);
  const expected = Buffer.from(
    createHmac('sha256', cursorKey).update(`${filtersFingerprint(query)}|${payload}`).digest('base64url'),
  );
  const given = Buffer.from(cursor.slice(dot + 1));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new ApiError('invalid', { fields: { after: FIELD_MESSAGES.cursor } });
  }
  try {
    const position = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as CursorPosition;
    if (typeof position.price !== 'number' || typeof position.code !== 'string') throw new Error('bad cursor');
    return position;
  } catch {
    throw new ApiError('invalid', { fields: { after: FIELD_MESSAGES.cursor } });
  }
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function indexFilters(query: SearchQuery): string[] {
  const filters: string[] = [];
  for (const name of FACET_NAMES) {
    const values = query[name];
    if (values.length === 0) continue;
    const attribute = FACET_ATTRIBUTES[name];
    filters.push(`(${values.map((value) => `${attribute} = ${quote(value)}`).join(' OR ')})`);
  }
  if (query.priceMin !== null) filters.push(`price >= ${query.priceMin}`);
  if (query.priceMax !== null) filters.push(`price <= ${query.priceMax}`);
  return filters;
}

function emptyFacets(): Record<FacetName, Record<string, number>> {
  const facets = {} as Record<FacetName, Record<string, number>>;
  for (const name of FACET_NAMES) {
    facets[name] = Object.fromEntries(FACET_VALUES[name].map((value) => [value, 0]));
  }
  return facets;
}

function facetsFromDocuments(documents: readonly UnitDocument[]): Record<FacetName, Record<string, number>> {
  const facets = emptyFacets();
  for (const document of documents) {
    const values: Record<FacetName, string> = {
      bedrooms: String(document.bedrooms),
      band: document.band,
      facing: document.facing,
      view: document.viewTag,
      status: document.status,
    };
    for (const name of FACET_NAMES) {
      const value = values[name];
      if (value in facets[name]) facets[name][value] += 1;
    }
  }
  return facets;
}

function facetsFromIndex(
  distribution: Record<string, Record<string, number>> | undefined,
): Record<FacetName, Record<string, number>> {
  const facets = emptyFacets();
  for (const name of FACET_NAMES) {
    const counts = distribution?.[FACET_ATTRIBUTES[name]] ?? {};
    for (const [value, count] of Object.entries(counts)) {
      if (value in facets[name]) facets[name][value] = count;
    }
  }
  return facets;
}

export async function runSearch(query: SearchQuery): Promise<SearchResponse> {
  const freed = await applyLapseCheck(pool);
  if (freed.length > 0) await waitForIndexConfirmation(freed, 500);

  const response = await searchIndex({
    q: query.q,
    filters: indexFilters(query),
    facets: [...Object.values(FACET_ATTRIBUTES), 'price'],
  });

  const indexHits = response.hits as UnitDocument[];
  const textMatched =
    query.q === ''
      ? indexHits
      : indexHits.filter((hit) => matchesSearchText(query.q, hit));

  const rows = await loadUnits(pool, textMatched.map((hit) => hit.code));
  const live = new Map(rows.map((row) => [row.code, row]));
  const documents = textMatched.filter((hit) => {
    const row = live.get(hit.code);
    return row !== undefined && isVisibleToBuyers(row.status);
  });
  documents.sort((a, b) => (a.price !== b.price ? a.price - b.price : compareUnitCodes(a.code, b.code)));

  const matchingCodes = documents.map((document) => document.code);
  const total = documents.length;
  const useIndexFacets = documents.length === indexHits.length;
  const facets = useIndexFacets ? facetsFromIndex(response.facetDistribution) : facetsFromDocuments(documents);
  const indexStats = response.facetStats?.price;
  const priceStats =
    total === 0
      ? null
      : useIndexFacets && indexStats
        ? { min: indexStats.min, max: indexStats.max }
        : {
            min: Math.min(...documents.map((document) => document.price)),
            max: Math.max(...documents.map((document) => document.price)),
          };

  let start = 0;
  if (query.after !== null) {
    const position = readCursor(query, query.after);
    start = documents.findIndex(
      (document) =>
        document.price > position.price ||
        (document.price === position.price && compareUnitCodes(document.code, position.code) > 0),
    );
    if (start < 0) start = documents.length;
  }
  const page = documents.slice(start, start + query.limit);
  const last = page[page.length - 1];
  const nextCursor =
    last && start + page.length < documents.length ? signCursor(query, { price: last.price, code: last.code }) : null;

  const syncing = await unconfirmedCodes(pool, page.map((document) => document.code));
  const hits: PublicUnit[] = [];
  for (const document of page) {
    const row = live.get(document.code);
    if (row && isVisibleToBuyers(row.status)) hits.push(publicUnit(row, syncing.has(row.code)));
  }

  return { total, hits, facets, priceStats, matchingCodes, nextCursor };
}
