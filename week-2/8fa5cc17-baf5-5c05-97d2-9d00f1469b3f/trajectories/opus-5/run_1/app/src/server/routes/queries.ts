import { randomUUID } from 'node:crypto';
import {
  Reply,
  RequestContext,
  Route,
  isUuid,
  json,
  noContent,
  notFound,
  route,
  validationError,
} from '../http/core';
import { withTransaction, Tx } from '../db/pool';
import { loadSettings } from '../domain/commit';
import { loadTypes, TypeRecord } from '../domain/types';
import {
  SortEntry,
  evaluateQuery,
  isSortKeyOnType,
  loadObjectsForQuery,
} from '../domain/queries';
import { parseQuery, TypeSpec } from '../../shared/query';
import { SEARCH_TEXT_MAX_CHARS, rankNotes, SearchDocument } from '../../shared/search';
import { plainTextOf } from '../../shared/richtext';
import { todayInZone, dateInZone } from '../../shared/homeclock';
import { loadLinkById, scopeObjectIds, statusOf } from '../domain/share';

const QUERY_MESSAGES = {
  name: 'Give the query a name.',
  typeId: 'Choose a type.',
  groupBy: 'Group by a select, relation, date or text field of this type.',
  sort: 'Use one to three sort keys.',
  sortKey: 'That sort key is not on this type.',
  sortDir: 'Use asc or desc.',
  searchQuery: 'Search with at most 200 characters.',
  shareLink: 'Choose an active share link.',
} as const;

type QueryRowRecord = {
  id: string;
  name: string;
  type_id: string;
  text: string;
  group_by: string | null;
  sort: SortEntry[];
};

function typeSpecs(types: TypeRecord[]): { specs: Map<string, TypeSpec>; list: TypeSpec[] } {
  const list = types.map((type) => ({
    id: type.id,
    name: type.name,
    fields: type.fields.map((field) => ({
      name: field.name,
      kind: field.kind,
      options: field.options,
      targetTypeId: field.targetTypeId,
    })),
  }));
  const specs = new Map<string, TypeSpec>();
  for (const spec of list) specs.set(spec.id, spec);
  return { specs, list };
}

function queryJson(row: QueryRowRecord): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    type_id: row.type_id,
    text: row.text,
    group_by: row.group_by,
    sort: row.sort,
  };
}

async function loadQuery(tx: Tx, id: string): Promise<QueryRowRecord | null> {
  if (!isUuid(id)) return null;
  return tx.one<QueryRowRecord>(
    'select id, name, type_id, text, group_by, sort from saved_query where id = $1',
    [id],
  );
}

function checkSort(raw: unknown, type: TypeRecord): SortEntry[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) throw validationError({ sort: QUERY_MESSAGES.sort });
  const errors: Record<string, string> = {};
  const entries: SortEntry[] = [];
  raw.forEach((item, index) => {
    const record = item === null || typeof item !== 'object' ? {} : (item as Record<string, unknown>);
    const key = typeof record['key'] === 'string' ? record['key'] : '';
    const dir = record['dir'];
    if (!isSortKeyOnType(key, type)) errors[`sort.${index}.key`] = QUERY_MESSAGES.sortKey;
    if (dir !== 'asc' && dir !== 'desc') errors[`sort.${index}.dir`] = QUERY_MESSAGES.sortDir;
    entries.push({ key, dir: dir === 'desc' ? 'desc' : 'asc' });
  });
  if (Object.keys(errors).length > 0) throw validationError(errors);
  return entries;
}

function checkGroupBy(raw: unknown, type: TypeRecord): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw validationError({ group_by: QUERY_MESSAGES.groupBy });
  const field = type.fields.find((candidate) => candidate.name.toLowerCase() === raw.toLowerCase());
  if (field === undefined || !['select', 'relation', 'date', 'text'].includes(field.kind)) {
    throw validationError({ group_by: QUERY_MESSAGES.groupBy });
  }
  return field.name;
}

export const queryRoutes: Route[] = [
  route('GET', '/api/graph', async (context: RequestContext): Promise<Reply> => {
    const shareLinkId = context.url.searchParams.get('share_link_id');
    const result = await withTransaction(async (tx) => {
      const types = await loadTypes(tx);
      const objects = await tx.query<{
        id: string;
        title: string;
        type_id: string;
        backlinks: number;
      }>('select id, title, type_id, backlinks from object_note');
      const memberships = await tx.query<{ object_id: string; collection_id: string }>(
        'select object_id, collection_id from collection_member',
      );
      const edges = await tx.query<{ id: string; from_object_id: string; to_object_id: string; kind: string }>(
        'select id, from_object_id, to_object_id, kind from link_edge order by id asc',
      );
      let scope: string[] | null = null;
      if (shareLinkId !== null) {
        const link = isUuid(shareLinkId) ? await loadLinkById(tx, shareLinkId) : null;
        if (link === null || statusOf(link) !== 'active') {
          throw validationError({ share_link_id: QUERY_MESSAGES.shareLink });
        }
        scope = await scopeObjectIds(tx, link.collection_id);
      }
      const nodes = objects.map((object) => {
        const node: Record<string, unknown> = {
          id: object.id,
          title: object.title,
          type_id: object.type_id,
          type_name: types.find((type) => type.id === object.type_id)?.name ?? '',
          collection_ids: memberships
            .filter((entry) => entry.object_id === object.id)
            .map((entry) => entry.collection_id),
          backlinks: object.backlinks,
        };
        if (scope !== null) node['in_scope'] = scope.includes(object.id);
        return node;
      });
      return {
        nodes,
        edges: edges.map((edge) => ({
          id: edge.id,
          from: edge.from_object_id,
          to: edge.to_object_id,
          kind: edge.kind,
        })),
      };
    });
    return json(result);
  }),

  route('GET', '/api/search', async (context: RequestContext): Promise<Reply> => {
    const q = context.url.searchParams.get('q') ?? '';
    if (Array.from(q.trim()).length > SEARCH_TEXT_MAX_CHARS) {
      throw validationError({ q: QUERY_MESSAGES.searchQuery });
    }
    if (q.trim() === '') return json({ results: [] });
    const settings = await loadSettings();
    const results = await withTransaction(async (tx) => {
      const types = await loadTypes(tx);
      const objects = await tx.query<{ id: string; title: string; type_id: string; updated_at: Date }>(
        'select id, title, type_id, updated_at from object_note',
      );
      const blocks = await tx.query<{ object_id: string; body: string | null }>(
        `select object_id, body from block where kind = 'text' order by position asc`,
      );
      const documents: SearchDocument[] = objects.map((object) => ({
        objectId: object.id,
        title: object.title,
        typeName: types.find((type) => type.id === object.type_id)?.name ?? '',
        blockTexts: blocks
          .filter((block) => block.object_id === object.id)
          .map((block) => plainTextOf(block.body ?? '')),
        updatedDate: dateInZone(object.updated_at, settings.homeTimeZone),
      }));
      return rankNotes(q, documents, todayInZone(settings.homeTimeZone));
    });
    return json({ results });
  }),

  route('GET', '/api/queries', async (): Promise<Reply> => {
    const queries = await withTransaction((tx) =>
      tx.query<QueryRowRecord>(
        'select id, name, type_id, text, group_by, sort from saved_query order by lower(name) asc',
      ),
    );
    return json({ queries: queries.map(queryJson) });
  }),

  route('GET', '/api/queries/:id', async (context: RequestContext): Promise<Reply> => {
    const row = await withTransaction((tx) => loadQuery(tx, context.params['id']));
    if (row === null) throw notFound();
    return json(queryJson(row));
  }),

  route('POST', '/api/queries/check', async (context: RequestContext): Promise<Reply> => {
    const body =
      context.json === null || typeof context.json !== 'object' ? {} : (context.json as Record<string, unknown>);
    const typeId = typeof body['type_id'] === 'string' ? body['type_id'] : '';
    const text = typeof body['text'] === 'string' ? body['text'] : '';
    await withTransaction(async (tx) => {
      const types = await loadTypes(tx);
      const type = types.find((candidate) => candidate.id === typeId);
      if (type === undefined) throw validationError({ type_id: QUERY_MESSAGES.typeId });
      const { specs } = typeSpecs(types);
      const spec = specs.get(type.id) as TypeSpec;
      const parsed = parseQuery(text, spec, specs);
      if (!parsed.ok) throw validationError({ text: parsed.message });
    });
    return json({ ok: true });
  }),

  route('POST', '/api/queries', async (context: RequestContext): Promise<Reply> => {
    const body =
      context.json === null || typeof context.json !== 'object' ? {} : (context.json as Record<string, unknown>);
    const created = await withTransaction(async (tx) => {
      const types = await loadTypes(tx);
      const typeId = typeof body['type_id'] === 'string' ? body['type_id'] : '';
      const type = types.find((candidate) => candidate.id === typeId);
      const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
      if (type === undefined) throw validationError({ type_id: QUERY_MESSAGES.typeId });
      if (name === '') throw validationError({ name: QUERY_MESSAGES.name });
      const text = typeof body['text'] === 'string' ? body['text'] : '';
      const { specs } = typeSpecs(types);
      const parsed = parseQuery(text, specs.get(type.id) as TypeSpec, specs);
      if (!parsed.ok) throw validationError({ text: parsed.message });
      const groupBy = checkGroupBy(body['group_by'], type);
      const sort = checkSort(body['sort'], type);
      const id = randomUUID();
      await tx.query(
        'insert into saved_query (id, name, type_id, text, group_by, sort) values ($1, $2, $3, $4, $5, $6)',
        [id, name, type.id, text, groupBy, JSON.stringify(sort)],
      );
      return queryJson({ id, name, type_id: type.id, text, group_by: groupBy, sort });
    });
    return json(created, 201);
  }),

  route('GET', '/api/queries/:id/results', async (context: RequestContext): Promise<Reply> => {
    const settings = await loadSettings();
    const result = await withTransaction(async (tx) => {
      const row = await loadQuery(tx, context.params['id']);
      if (row === null) throw notFound();
      const types = await loadTypes(tx);
      const type = types.find((candidate) => candidate.id === row.type_id);
      if (type === undefined) throw notFound();
      const { specs } = typeSpecs(types);
      const parsed = parseQuery(row.text, specs.get(type.id) as TypeSpec, specs);
      if (!parsed.ok) throw validationError({ text: parsed.message });
      const data = await loadObjectsForQuery(tx, types, settings.homeTimeZone);
      const objectsOfType = await tx.query<{ id: string }>(
        'select id from object_note where type_id = $1',
        [type.id],
      );
      return evaluateQuery(
        parsed.ast,
        type,
        data,
        objectsOfType.map((entry) => entry.id),
        todayInZone(settings.homeTimeZone),
        row.sort,
        row.group_by,
      );
    });
    return json(result);
  }),

  route('DELETE', '/api/queries/:id', async (context: RequestContext): Promise<Reply> => {
    await withTransaction(async (tx) => {
      const row = await loadQuery(tx, context.params['id']);
      if (row === null) throw notFound();
      await tx.query('delete from saved_query where id = $1', [row.id]);
    });
    return noContent();
  }),
];
