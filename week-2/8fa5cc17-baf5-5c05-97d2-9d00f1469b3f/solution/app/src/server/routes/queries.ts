// The link graph, note search and saved queries.
import { randomUUID } from 'node:crypto';
import { db, one } from '../db.ts';
import { FieldErrors, notFound, validation, type Json } from '../errors.ts';
import { isUuid, noContent, objectBody, ok, route, type Request, type Route } from '../http.ts';
import { iso, loadTypes, OBJECT_SELECT, type ObjectRow, type TypeRow } from '../model.ts';
import { linkStatus, scopeOf, SHARE_LINK_SELECT, type ShareLinkRow } from '../share.ts';
import { homeDateOf, homeToday } from '../workspace.ts';
import {
  checkQuery, compareIds, compareText, groupField, groupObjects, isSortKey, matches, QUERY_TEXT_CAP, sortObjects,
  type QueryContext, type QueryObject, type QueryType, type SortKey,
} from '../../shared/query.ts';
import { rankNotes, SEARCH_CAP, type NoteDocument } from '../../shared/search.ts';

const RESULT_CAP = 200;
const MAX_SORT_KEYS = 3;

async function graph(req: Request) {
  const linkId = req.query.get('share_link_id');
  let scope: Set<string> | null = null;
  if (linkId !== null) {
    const link = isUuid(linkId) ? await one<ShareLinkRow>(db, `${SHARE_LINK_SELECT} WHERE id = $1`, [linkId]) : undefined;
    if (!link || linkStatus(link) !== 'active') throw validation({ share_link_id: 'Choose an active share link.' });
    scope = await scopeOf(db, link);
  }
  const nodes = await db.query<ObjectRow>(OBJECT_SELECT);
  const edges = await db.query<{ id: string; from_object_id: string; to_object_id: string; kind: string }>(
    'SELECT id, from_object_id, to_object_id, kind FROM link_edges ORDER BY id');
  return ok({
    nodes: nodes.map((n) => ({
      id: n.id, title: n.title, type_id: n.type_id, type_name: n.type_name, collection_ids: n.collection_ids, backlinks: n.backlinks,
      ...(scope ? { in_scope: scope.has(n.id) } : {}),
    })),
    edges: edges.map((e) => ({ id: e.id, from: e.from_object_id, to: e.to_object_id, kind: e.kind })),
  });
}

async function search(req: Request) {
  const q = req.query.get('q') ?? '';
  if ([...q.trim()].length > SEARCH_CAP) throw validation({ q: 'Search with at most 200 characters.' });
  if (q.trim() === '') return ok({ results: [] });
  const { date, zone } = await homeToday(db);
  const objects = await db.query<{ id: string; title: string; type_name: string; updated_at: Date }>(
    'SELECT o.id, o.title, t.name AS type_name, o.updated_at FROM objects o JOIN object_types t ON t.id = o.type_id');
  const blocks = await db.query<{ object_id: string; plain: string }>(`SELECT object_id, plain FROM blocks WHERE kind = 'text' ORDER BY object_id, position`);
  const texts = new Map<string, string[]>();
  for (const b of blocks) texts.set(b.object_id, [...(texts.get(b.object_id) ?? []), b.plain]);
  const docs: NoteDocument[] = objects.map((o) => ({
    objectId: o.id, title: o.title, typeName: o.type_name, blockTexts: texts.get(o.id) ?? [], updatedDate: homeDateOf(o.updated_at, zone),
  }));
  return ok({ results: rankNotes(q, docs, date) as unknown as Json });
}

// --- Saved queries -----------------------------------------------------------

const queryType = (t: TypeRow): QueryType => ({
  id: t.id, name: t.name,
  fields: t.fields.map((f) => ({ name: f.name, kind: f.kind as QueryType['fields'][number]['kind'], options: f.options, targetTypeId: f.target_type_id })),
});

/** Every object as the query evaluator sees it, with today on the home clock. */
async function queryContext(): Promise<{ ctx: QueryContext; types: TypeRow[]; objects: QueryObject[]; typeNames: Map<string, string>; updated: Map<string, string> }> {
  const types = await loadTypes(db);
  const { date, zone } = await homeToday(db);
  const rows = await db.query<ObjectRow>(OBJECT_SELECT);
  const objects: QueryObject[] = rows.map((o) => ({
    id: o.id, title: o.title, typeId: o.type_id, backlinks: o.backlinks, updatedDate: homeDateOf(o.updated_at, zone),
    properties: o.properties as Record<string, string | number | null>,
  }));
  const byId = new Map(objects.map((o) => [o.id, o]));
  const typeById = new Map(types.map((t) => [t.id, queryType(t)]));
  return {
    ctx: { today: date, typeById: (id) => typeById.get(id), objectById: (id) => byId.get(id) },
    types, objects,
    typeNames: new Map(rows.map((o) => [o.id, o.type_name])),
    updated: new Map(rows.map((o) => [o.id, iso(o.updated_at)])),
  };
}

interface QueryRow { id: string; name: string; type_id: string; text: string; group_by: string | null; sort: SortKey[] }
const queryJson = (q: QueryRow): Json => ({ id: q.id, name: q.name, type_id: q.type_id, text: q.text, group_by: q.group_by, sort: q.sort });
const QUERY_SELECT = 'SELECT id, name, type_id, text, group_by, sort FROM saved_queries';

function checkText(text: unknown, type: QueryType | undefined, ctx: QueryContext, errors: FieldErrors): void {
  if (typeof text !== 'string') {
    errors.add('text', 'Unexpected end of query at column 1.');
    return;
  }
  if ([...text].length > QUERY_TEXT_CAP) {
    errors.add('text', 'Use at most 500 characters.');
    return;
  }
  if (!type) return;
  const checked = checkQuery(text, type, ctx);
  if (!checked.ok) errors.add('text', checked.message);
}

async function check(req: Request) {
  const body = objectBody(req);
  const { ctx } = await queryContext();
  const errors = new FieldErrors();
  const type = isUuid(body.type_id) ? ctx.typeById(body.type_id) : undefined;
  if (!type) errors.add('type_id', 'Choose a type.');
  checkText(body.text, type, ctx, errors);
  errors.throwIfAny();
  return ok({ ok: true });
}

async function listQueries() {
  const rows = await db.query<QueryRow>(QUERY_SELECT);
  return ok({ queries: rows.sort((a, b) => compareText(a.name, b.name) || compareIds(a.id, b.id)).map(queryJson) });
}

async function getQuery(req: Request) {
  const row = await one<QueryRow>(db, `${QUERY_SELECT} WHERE id = $1`, [req.params.id]);
  if (!row) throw notFound();
  return ok(queryJson(row));
}

async function createQuery(req: Request) {
  const body = objectBody(req);
  const { ctx } = await queryContext();
  const errors = new FieldErrors();
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) errors.add('name', 'Give the query a name.');
  const type = isUuid(body.type_id) ? ctx.typeById(body.type_id) : undefined;
  if (!type) errors.add('type_id', 'Choose a type.');
  checkText(body.text, type, ctx, errors);
  const groupBy = body.group_by ?? null;
  if (groupBy !== null && (typeof groupBy !== 'string' || !type || !groupField(type, groupBy))) {
    errors.add('group_by', 'Group by a select, relation, date or text field of this type.');
  }
  const sort = Array.isArray(body.sort) ? body.sort : [];
  if (sort.length < 1 || sort.length > MAX_SORT_KEYS) errors.add('sort', 'Use one to three sort keys.');
  else {
    sort.forEach((s: unknown, i: number) => {
      const entry = s !== null && typeof s === 'object' ? (s as Record<string, unknown>) : {};
      if (typeof entry.key !== 'string' || !type || !isSortKey(type, entry.key)) errors.add(`sort.${i}.key`, 'That sort key is not on this type.');
      if (entry.dir !== 'asc' && entry.dir !== 'desc') errors.add(`sort.${i}.dir`, 'Use asc or desc.');
    });
  }
  errors.throwIfAny();
  const row: QueryRow = {
    id: randomUUID(), name, type_id: body.type_id as string, text: body.text as string, group_by: groupBy as string | null,
    sort: (sort as Array<{ key: string; dir: 'asc' | 'desc' }>).map((s) => ({ key: s.key, dir: s.dir })),
  };
  await db.query('INSERT INTO saved_queries (id, name, type_id, text, group_by, sort, created_at) VALUES ($1, $2, $3, $4, $5, $6, now())',
    [row.id, row.name, row.type_id, row.text, row.group_by, JSON.stringify(row.sort)]);
  return ok(queryJson(row), 201);
}

async function results(req: Request) {
  const saved = await one<QueryRow>(db, `${QUERY_SELECT} WHERE id = $1`, [req.params.id]);
  if (!saved) throw notFound();
  const { ctx, objects, typeNames, updated } = await queryContext();
  const type = ctx.typeById(saved.type_id);
  const checked = type ? checkQuery(saved.text, type, ctx) : null;
  if (!type || !checked?.ok) return ok({ results: [], groups: null });
  const matching = objects.filter((o) => o.typeId === type.id && matches(checked.query, o, ctx));
  const sorted = sortObjects(matching, type, saved.sort, ctx).slice(0, RESULT_CAP);
  const row = (o: QueryObject): Json => ({ id: o.id, title: o.title, type_name: typeNames.get(o.id) ?? '', backlinks: o.backlinks, updated_at: updated.get(o.id) ?? '' });
  const field = saved.group_by ? groupField(type, saved.group_by) : undefined;
  return ok({
    results: sorted.map(row),
    groups: field ? groupObjects(sorted, field, ctx).map((g) => ({ key: g.key, label: g.label, count: g.rows.length, results: g.rows.map(row) })) : null,
  });
}

async function deleteQuery(req: Request) {
  const rows = await db.query('DELETE FROM saved_queries WHERE id = $1 RETURNING id', [req.params.id]);
  if (!rows.length) throw notFound();
  return noContent();
}

export const queryRoutes: Route[] = [
  route('GET', '/api/graph', 'none', graph),
  route('GET', '/api/search', 'none', search),
  route('GET', '/api/queries', 'none', listQueries),
  route('POST', '/api/queries/check', 'json', check),
  route('POST', '/api/queries', 'json', createQuery),
  route('GET', '/api/queries/:id', 'none', getQuery),
  route('GET', '/api/queries/:id/results', 'none', results),
  route('DELETE', '/api/queries/:id', 'none', deleteQuery),
];
