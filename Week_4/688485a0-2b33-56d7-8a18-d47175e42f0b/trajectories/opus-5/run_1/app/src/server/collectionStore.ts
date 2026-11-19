import { randomBytes, randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { canonicalKeyText } from '../shared/compare';
import { checkDocumentShape } from '../shared/documentRules';
import { AppError, duplicateKey, notFound, versionConflict } from '../shared/errors';
import { IndexDefinition, indexKeyTuples } from '../shared/indexPlan';
import { compactJson, orderDocument } from '../shared/json';
import { DocObject, DocValue, fromJson } from '../shared/values';
import { Validator, checkValidator, parseValidator } from '../shared/validator';
import { config } from './config';
import { query, queryOne, withTransaction } from './db';
import { publishChange } from './events';

export interface CollectionRow {
  id: string;
  project_id: string;
  name: string;
  sequence: string;
  validator: string | null;
}

export interface StoredDocument {
  doc: DocObject;
  version: number;
}

export const ID_INDEX: IndexDefinition = { name: '_id_', keys: [{ path: '_id', direction: 1 }], unique: true };

export function newDocumentId(): string {
  return randomBytes(12).toString('hex');
}

export function parseStoredDocument(body: string): DocObject {
  const value = fromJson(JSON.parse(body) as unknown);
  return value as DocObject;
}

export function collectionValidator(collection: CollectionRow): Validator | null {
  if (!collection.validator) return null;
  return parseValidator(fromJson(JSON.parse(collection.validator) as unknown));
}

export async function loadDocuments(collectionId: string): Promise<DocObject[]> {
  const rows = await query<{ body: string }>(
    'select body from documents where collection_id = $1 order by doc_id collate "C" asc',
    [collectionId],
  );
  return rows.map((row) => parseStoredDocument(row.body));
}

export async function documentCount(collectionId: string): Promise<number> {
  const row = await queryOne<{ count: string }>('select count(*)::text as count from documents where collection_id = $1', [
    collectionId,
  ]);
  return row ? Number(row.count) : 0;
}

export async function getStoredDocument(collectionId: string, docId: string): Promise<StoredDocument | null> {
  const row = await queryOne<{ body: string; version: number }>(
    'select body, version from documents where collection_id = $1 and doc_id = $2',
    [collectionId, docId],
  );
  return row ? { doc: parseStoredDocument(row.body), version: row.version } : null;
}

export async function listIndexes(collectionId: string): Promise<IndexDefinition[]> {
  const rows = await query<{ name: string; keys: string; unique_index: boolean }>(
    'select name, keys, unique_index from collection_indexes where collection_id = $1 order by name collate "C" asc',
    [collectionId],
  );
  return [
    ID_INDEX,
    ...rows.map((row) => ({
      name: row.name,
      keys: JSON.parse(row.keys) as IndexDefinition['keys'],
      unique: row.unique_index,
    })),
  ];
}

async function uniqueIndexRows(
  client: PoolClient,
  collectionId: string,
): Promise<Array<{ id: string; name: string; keys: IndexDefinition['keys'] }>> {
  const result = await client.query<{ id: string; name: string; keys: string }>(
    'select id, name, keys from collection_indexes where collection_id = $1 and unique_index order by name collate "C" asc',
    [collectionId],
  );
  return result.rows.map((row) => ({ id: row.id, name: row.name, keys: JSON.parse(row.keys) as IndexDefinition['keys'] }));
}

function keyValueForReport(keys: IndexDefinition['keys'], tuple: DocValue[]): DocValue {
  if (keys.length === 1) return tuple[0];
  const out: DocObject = {};
  keys.forEach((key, position) => {
    out[key.path] = tuple[position];
  });
  return out;
}

/** The one place a write is checked against the collection's unique indexes. */
async function checkUniqueIndexes(
  client: PoolClient,
  collectionId: string,
  docId: string,
  doc: DocObject,
): Promise<void> {
  const indexes = await uniqueIndexRows(client, collectionId);
  for (const index of indexes) {
    for (const tuple of indexKeyTuples(doc, index.keys)) {
      const keyText = canonicalKeyText(tuple);
      const clash = await client.query<{ doc_id: string }>(
        'select doc_id from index_entries where index_id = $1 and key_text = $2 and doc_id <> $3 limit 1',
        [index.id, keyText, docId],
      );
      if (clash.rows.length > 0) throw duplicateKey(index.name, JSON.parse(compactJson(keyValueForReport(index.keys, tuple))));
    }
  }
}

async function writeIndexEntries(client: PoolClient, collectionId: string, docId: string, doc: DocObject): Promise<void> {
  const indexes = await uniqueIndexRows(client, collectionId);
  await client.query(
    'delete from index_entries where doc_id = $1 and index_id in (select id from collection_indexes where collection_id = $2)',
    [docId, collectionId],
  );
  for (const index of indexes) {
    for (const tuple of indexKeyTuples(doc, index.keys)) {
      await client.query('insert into index_entries (index_id, doc_id, key_text) values ($1, $2, $3)', [
        index.id,
        docId,
        canonicalKeyText(tuple),
      ]);
    }
  }
}

async function lockCollection(client: PoolClient, collectionId: string): Promise<number> {
  const result = await client.query<{ sequence: string }>('select sequence from collections where id = $1 for update', [
    collectionId,
  ]);
  if (result.rows.length === 0) throw notFound();
  return Number(result.rows[0].sequence);
}

async function recordChange(
  client: PoolClient,
  collectionId: string,
  seq: number,
  op: 'insert' | 'update' | 'delete',
  docId: string,
  doc: DocObject | null,
  version: number | null,
): Promise<void> {
  await client.query(
    'insert into changes (collection_id, seq, op, doc_id, body, version) values ($1, $2, $3, $4, $5, $6)',
    [collectionId, seq, op, docId, doc ? compactJson(doc) : null, version],
  );
  await client.query('update collections set sequence = $2 where id = $1', [collectionId, seq]);
}

/** The document check order up to the validator; unique indexes are checked in the write. */
export function prepareDocument(raw: DocObject, validator: Validator | null, assignId: boolean): DocObject {
  const doc = orderDocument(raw);
  checkDocumentShape(doc, { maxBytes: config.limits.maxDocBytes, maxDepth: config.limits.maxDepth });
  checkValidator(doc, validator);
  if (!Object.prototype.hasOwnProperty.call(doc, '_id') && assignId) {
    return orderDocument({ ...doc, _id: newDocumentId() });
  }
  return doc;
}

export async function insertDocument(collection: CollectionRow, doc: DocObject): Promise<StoredDocument> {
  const result = await withTransaction(async (client) => {
    const sequence = await lockCollection(client, collection.id);
    const docId = String(doc['_id']);
    const existing = await client.query('select 1 from documents where collection_id = $1 and doc_id = $2', [
      collection.id,
      docId,
    ]);
    if (existing.rows.length > 0) throw duplicateKey('_id_', docId);
    await checkUniqueIndexes(client, collection.id, docId, doc);
    await client.query('insert into documents (collection_id, doc_id, body, version) values ($1, $2, $3, 1)', [
      collection.id,
      docId,
      compactJson(doc),
    ]);
    await writeIndexEntries(client, collection.id, docId, doc);
    await recordChange(client, collection.id, sequence + 1, 'insert', docId, doc, 1);
    return { doc, version: 1 };
  });
  publishChange(collection.id);
  return result;
}

export async function updateDocument(
  collection: CollectionRow,
  docId: string,
  doc: DocObject,
  expectedVersion: number,
): Promise<StoredDocument> {
  const result = await withTransaction(async (client) => {
    const sequence = await lockCollection(client, collection.id);
    const current = await client.query<{ body: string; version: number }>(
      'select body, version from documents where collection_id = $1 and doc_id = $2',
      [collection.id, docId],
    );
    if (current.rows.length === 0) throw notFound();
    const stored = current.rows[0];
    if (stored.version !== expectedVersion) {
      throw versionConflict(stored.version, JSON.parse(stored.body) as unknown);
    }
    await checkUniqueIndexes(client, collection.id, docId, doc);
    const version = stored.version + 1;
    await client.query('update documents set body = $3, version = $4 where collection_id = $1 and doc_id = $2', [
      collection.id,
      docId,
      compactJson(doc),
      version,
    ]);
    await writeIndexEntries(client, collection.id, docId, doc);
    await recordChange(client, collection.id, sequence + 1, 'update', docId, doc, version);
    return { doc, version };
  });
  publishChange(collection.id);
  return result;
}

export async function deleteDocument(collection: CollectionRow, docId: string): Promise<void> {
  await withTransaction(async (client) => {
    const sequence = await lockCollection(client, collection.id);
    const current = await client.query('select 1 from documents where collection_id = $1 and doc_id = $2', [
      collection.id,
      docId,
    ]);
    if (current.rows.length === 0) throw notFound();
    await client.query(
      'delete from index_entries where doc_id = $1 and index_id in (select id from collection_indexes where collection_id = $2)',
      [docId, collection.id],
    );
    await client.query('delete from documents where collection_id = $1 and doc_id = $2', [collection.id, docId]);
    await recordChange(client, collection.id, sequence + 1, 'delete', docId, null, null);
  });
  publishChange(collection.id);
}

export type LineDocument = { line: number; doc: DocObject } | { line: number; message: string };

export interface LineError {
  line: number;
  message: string;
}

/** Loads a whole file in one transaction: every line is checked first, so any failure adds nothing. */
export async function insertDocumentBatch(
  collection: CollectionRow,
  entries: LineDocument[],
  describe: (error: AppError) => string,
): Promise<{ inserted: number; errors: LineError[] }> {
  const outcome = await withTransaction(async (client) => {
    const sequence = await lockCollection(client, collection.id);
    const indexes = await uniqueIndexRows(client, collection.id);
    const errors: LineError[] = [];
    const plannedIds = new Set<string>();
    const plannedKeys = new Map<string, Set<string>>();
    for (const entry of entries) {
      if (errors.length >= 20) break;
      if ('message' in entry) {
        errors.push({ line: entry.line, message: entry.message });
        continue;
      }
      const docId = String(entry.doc['_id']);
      try {
        if (plannedIds.has(docId)) throw duplicateKey('_id_', docId);
        const existing = await client.query('select 1 from documents where collection_id = $1 and doc_id = $2', [
          collection.id,
          docId,
        ]);
        if (existing.rows.length > 0) throw duplicateKey('_id_', docId);
        const additions: Array<{ indexId: string; keyText: string }> = [];
        for (const index of indexes) {
          for (const tuple of indexKeyTuples(entry.doc, index.keys)) {
            const keyText = canonicalKeyText(tuple);
            const planned = plannedKeys.get(index.id);
            if (planned?.has(keyText)) {
              throw duplicateKey(index.name, JSON.parse(compactJson(keyValueForReport(index.keys, tuple))));
            }
            const clash = await client.query('select 1 from index_entries where index_id = $1 and key_text = $2', [
              index.id,
              keyText,
            ]);
            if (clash.rows.length > 0) {
              throw duplicateKey(index.name, JSON.parse(compactJson(keyValueForReport(index.keys, tuple))));
            }
            additions.push({ indexId: index.id, keyText });
          }
        }
        plannedIds.add(docId);
        for (const addition of additions) {
          const planned = plannedKeys.get(addition.indexId) ?? new Set<string>();
          planned.add(addition.keyText);
          plannedKeys.set(addition.indexId, planned);
        }
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        errors.push({ line: entry.line, message: describe(error) });
      }
    }
    if (errors.length > 0) return { inserted: 0, errors };
    let seq = sequence;
    for (const entry of entries) {
      if ('message' in entry) continue;
      const docId = String(entry.doc['_id']);
      await client.query('insert into documents (collection_id, doc_id, body, version) values ($1, $2, $3, 1)', [
        collection.id,
        docId,
        compactJson(entry.doc),
      ]);
      await writeIndexEntries(client, collection.id, docId, entry.doc);
      seq += 1;
      await recordChange(client, collection.id, seq, 'insert', docId, entry.doc, 1);
    }
    return { inserted: entries.length, errors: [] };
  });
  if (outcome.inserted > 0) publishChange(collection.id);
  return outcome;
}

/** Builds a unique index over existing documents, refusing the first repeated value. */
export async function createUniqueIndexEntries(
  client: PoolClient,
  collectionId: string,
  indexId: string,
  indexName: string,
  keys: IndexDefinition['keys'],
): Promise<void> {
  const result = await client.query<{ doc_id: string; body: string }>(
    'select doc_id, body from documents where collection_id = $1 order by doc_id collate "C" asc',
    [collectionId],
  );
  const seen = new Set<string>();
  for (const row of result.rows) {
    const doc = parseStoredDocument(row.body);
    for (const tuple of indexKeyTuples(doc, keys)) {
      const keyText = canonicalKeyText(tuple);
      if (seen.has(keyText)) {
        throw duplicateKey(indexName, JSON.parse(compactJson(keyValueForReport(keys, tuple))));
      }
      seen.add(keyText);
      await client.query('insert into index_entries (index_id, doc_id, key_text) values ($1, $2, $3)', [
        indexId,
        row.doc_id,
        keyText,
      ]);
    }
  }
}

export function newId(): string {
  return randomUUID();
}
