import { documentDepth } from './documentRules';
import { invalidQuery, queryTooDeep, scanLimit } from './errors';
import { matchFilter, validateFilter } from './filter';
import { IndexDefinition, QueryPlan, planQuery } from './indexPlan';
import { Projection, applyProjection, validateProjection } from './projection';
import { SortKey, sortDocuments, validateSort } from './sort';
import { DocObject, DocValue, fromJson, isPlainObject } from './values';

export const QUERY_DEPTH_LIMIT = 32;

export interface QuerySpec {
  filter: DocObject;
  projection: Projection;
  sort: SortKey[];
  limit: number;
  page: number;
}

function checkDepth(value: DocValue): void {
  if (documentDepth(value) > QUERY_DEPTH_LIMIT) throw queryTooDeep(QUERY_DEPTH_LIMIT);
}

/** Checks a query request body, throwing `invalid_query`, `unknown_operator` or `query_too_deep`. */
export function parseQuerySpec(body: Record<string, unknown>): QuerySpec {
  const rawFilter = body['filter'] === undefined || body['filter'] === null ? {} : fromJson(body['filter']);
  if (!isPlainObject(rawFilter)) throw invalidQuery('filter');
  checkDepth(rawFilter);
  const filter = validateFilter(rawFilter);

  const rawProjection = body['projection'] === undefined ? null : fromJson(body['projection']);
  if (rawProjection !== null && !isPlainObject(rawProjection)) throw invalidQuery('projection');
  checkDepth(rawProjection);
  const projection = validateProjection(rawProjection);

  const rawSort = body['sort'] === undefined ? null : fromJson(body['sort']);
  if (rawSort !== null && !isPlainObject(rawSort)) throw invalidQuery('sort');
  checkDepth(rawSort);
  const sort = validateSort(rawSort);

  const rawLimit = body['limit'] === undefined || body['limit'] === null ? 0 : body['limit'];
  if (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit) || rawLimit < 0) throw invalidQuery('limit');

  const rawPage = body['page'] === undefined || body['page'] === null ? 1 : body['page'];
  if (typeof rawPage !== 'number' || !Number.isInteger(rawPage) || rawPage < 1) throw invalidQuery('page');

  return { filter, projection, sort, limit: rawLimit, page: rawPage };
}

export interface QueryResult {
  matched: number;
  page: number;
  page_size: number;
  documents: DocObject[];
  ids: string[];
  plan: QueryPlan & { returned: number };
}

/** Runs a query over documents in `_id` order, with the scan guard and paging. */
export function runQuery(
  docs: DocObject[],
  spec: QuerySpec,
  indexes: IndexDefinition[],
  limits: { scanLimit: number; pageSize: number },
): QueryResult {
  const plan = planQuery(spec.filter, indexes, docs);
  if (plan.docs_examined > limits.scanLimit) throw scanLimit(limits.scanLimit);
  const matches = sortDocuments(
    docs.filter((doc) => matchFilter(spec.filter, doc)),
    spec.sort,
  );
  const limited = spec.limit > 0 ? matches.slice(0, spec.limit) : matches;
  const start = (spec.page - 1) * limits.pageSize;
  const pageDocs = limited.slice(start, start + limits.pageSize);
  return {
    matched: limited.length,
    page: spec.page,
    page_size: limits.pageSize,
    documents: pageDocs.map((doc) => applyProjection(doc, spec.projection)),
    ids: pageDocs.map((doc) => String(doc['_id'])),
    plan: { ...plan, returned: limited.length },
  };
}

/** Every matching document in sort order, for downloads. */
export function runQueryAll(
  docs: DocObject[],
  filter: DocObject,
  sort: SortKey[],
  indexes: IndexDefinition[],
  limits: { scanLimit: number },
): DocObject[] {
  const plan = planQuery(filter, indexes, docs);
  if (plan.docs_examined > limits.scanLimit) throw scanLimit(limits.scanLimit);
  return sortDocuments(
    docs.filter((doc) => matchFilter(filter, doc)),
    sort,
  );
}
