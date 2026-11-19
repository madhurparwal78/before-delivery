import type pg from "pg";
import type { JsonObject, JsonValue } from "../shared/json.js";
import { config } from "./config.js";
import { type Db, notify } from "./db.js";
import { checkDocument } from "./engine/document.js";
import { type IndexDefinition, indexEntries } from "./engine/indexes.js";
import { compact } from "./engine/value.js";
import { checkValidator } from "./engine/validator.js";
import { fail } from "./errors.js";

/** Document storage: reads, and the one write path that keeps versions, unique entries and the change feed in step. */

export const ID_INDEX: IndexDefinition = { name: "_id_", keys: { _id: 1 }, unique: true };

export async function countDocuments(db: Db, collectionId: string): Promise<number> {
  const result = await db.query<{ n: string }>("SELECT count(*) AS n FROM documents WHERE collection_id = $1", [collectionId]);
  return Number(result.rows[0]?.n ?? 0);
}

export async function loadDocuments(db: Db, collectionId: string): Promise<JsonObject[]> {
  const result = await db.query<{ body: string }>("SELECT body FROM documents WHERE collection_id = $1 ORDER BY id", [collectionId]);
  return result.rows.map((row) => JSON.parse(row.body) as JsonObject);
}

export async function loadIndexes(db: Db, collectionId: string): Promise<IndexDefinition[]> {
  const result = await db.query<{ name: string; keys: string; is_unique: boolean }>(
    "SELECT name, keys, is_unique FROM indexes WHERE collection_id = $1 ORDER BY name",
    [collectionId],
  );
  return [ID_INDEX, ...result.rows.map((row) => ({ name: row.name, keys: JSON.parse(row.keys) as IndexDefinition["keys"], unique: row.is_unique }))];
}

interface Conflict {
  index: string;
  value: JsonValue;
}

interface Candidate {
  id: string;
  doc: JsonObject;
}

/** For each candidate document, the first unique-index conflict with stored entries or earlier candidates (null when none). */
export async function findConflicts(db: Db, collectionId: string, candidates: Candidate[], uniques: IndexDefinition[], replacing = false): Promise<(Conflict | null)[]> {
  const entries = candidates.map(({ doc }) => uniques.map((index) => ({ index, entries: indexEntries(doc, index) })));
  const names: string[] = [];
  const hashes: string[] = [];
  for (const perDoc of entries) for (const { index, entries: list } of perDoc) for (const entry of list) (names.push(index.name), hashes.push(entry.hash));
  const stored = new Map<string, string>();
  if (names.length > 0) {
    const result = await db.query<{ index_name: string; key_hash: string; doc_id: string }>(
      `SELECT e.index_name, e.key_hash, e.doc_id FROM unique_entries e
       JOIN unnest($2::text[], $3::text[]) AS k(index_name, key_hash) USING (index_name, key_hash)
       WHERE e.collection_id = $1`,
      [collectionId, names, hashes],
    );
    for (const row of result.rows) stored.set(`${row.index_name}\u0000${row.key_hash}`, row.doc_id);
  }
  const ids = candidates.map((candidate) => candidate.id);
  const takenIds = new Set<string>();
  if (!replacing) {
    const result = await db.query<{ id: string }>("SELECT id FROM documents WHERE collection_id = $1 AND id = ANY($2::text[])", [collectionId, ids]);
    for (const row of result.rows) takenIds.add(row.id);
  }
  const seen = new Set<string>();
  return candidates.map((candidate, position) => {
    const idTaken = takenIds.has(candidate.id) || (!replacing && ids.indexOf(candidate.id) < position);
    if (idTaken) return { index: ID_INDEX.name, value: candidate.id };
    const keys: string[] = [];
    for (const { index, entries: list } of entries[position] ?? []) {
      for (const entry of list) {
        const key = `${index.name}\u0000${entry.hash}`;
        const owner = stored.get(key);
        if ((owner !== undefined && owner !== candidate.id) || seen.has(key)) return { index: index.name, value: entry.value };
        keys.push(key);
      }
    }
    for (const key of keys) seen.add(key);
    return null;
  });
}

function refuseConflict(conflict: Conflict | null): void {
  if (conflict) fail("duplicate_key", { index: conflict.index, value: conflict.value });
}

interface CollectionRules {
  id: string;
  validator: JsonObject | null;
}

/** Document rules in their published order: `_id`, names, size, depth, then the validator. */
export function prepareDocument(raw: JsonObject, rules: CollectionRules, validate = true): JsonObject {
  const document = checkDocument(raw, { maxBytes: config.limits.maxDocBytes, maxDepth: config.limits.maxDepth });
  if (validate && rules.validator) checkValidator(rules.validator, document);
  return document;
}

async function lock(client: pg.PoolClient, collectionId: string): Promise<number> {
  const result = await client.query<{ sequence: string }>("SELECT sequence FROM collections WHERE id = $1 FOR UPDATE", [collectionId]);
  const row = result.rows[0];
  return row ? Number(row.sequence) : fail("not_found");
}

async function writeEntries(client: pg.PoolClient, collectionId: string, rows: { id: string; doc: JsonObject }[], uniques: IndexDefinition[]): Promise<void> {
  const names: string[] = [];
  const hashes: string[] = [];
  const owners: string[] = [];
  for (const { id, doc } of rows) {
    for (const index of uniques) {
      for (const entry of indexEntries(doc, index)) (names.push(index.name), hashes.push(entry.hash), owners.push(id));
    }
  }
  if (names.length === 0) return;
  await client.query(
    "INSERT INTO unique_entries (collection_id, index_name, key_hash, doc_id) SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[])",
    [collectionId, names, hashes, owners],
  );
}

async function record(
  client: pg.PoolClient,
  collectionId: string,
  sequence: number,
  changes: { op: "insert" | "update" | "delete"; id: string; document: JsonObject | null; version: number | null }[],
): Promise<void> {
  await client.query(
    `INSERT INTO changes (collection_id, seq, op, doc_id, document, version)
     SELECT $1, $2::bigint + ordinality, op, doc_id, document, version
     FROM unnest($3::text[], $4::text[], $5::text[], $6::int[]) WITH ORDINALITY AS c(op, doc_id, document, version, ordinality)`,
    [collectionId, sequence, changes.map((c) => c.op), changes.map((c) => c.id), changes.map((c) => (c.document ? compact(c.document) : null)), changes.map((c) => c.version)],
  );
  await client.query("UPDATE collections SET sequence = $2 WHERE id = $1", [collectionId, sequence + changes.length]);
  await notify(client, `c:${collectionId}`);
}

/** Insert prepared documents as version 1. Throws duplicate_key on the first conflict. */
export async function insertDocuments(client: pg.PoolClient, collectionId: string, docs: JsonObject[]): Promise<void> {
  const sequence = await lock(client, collectionId);
  const uniques = (await loadIndexes(client, collectionId)).filter((index) => index.unique && index !== ID_INDEX);
  const candidates = docs.map((doc) => ({ id: doc["_id"] as string, doc }));
  const conflicts = await findConflicts(client, collectionId, candidates, [...uniques]);
  for (const conflict of conflicts) refuseConflict(conflict);
  await client.query(
    "INSERT INTO documents (collection_id, id, body, version) SELECT $1, * FROM unnest($2::text[], $3::text[], $4::int[])",
    [collectionId, candidates.map((c) => c.id), docs.map(compact), docs.map(() => 1)],
  );
  await writeEntries(client, collectionId, candidates, uniques);
  await record(client, collectionId, sequence, docs.map((doc) => ({ op: "insert", id: doc["_id"] as string, document: doc, version: 1 })));
}

interface StoredDocument {
  document: JsonObject;
  version: number;
}

export async function readDocument(db: Db, collectionId: string, id: string): Promise<StoredDocument | null> {
  const result = await db.query<{ body: string; version: number }>("SELECT body, version FROM documents WHERE collection_id = $1 AND id = $2", [collectionId, id]);
  const row = result.rows[0];
  return row ? { document: JSON.parse(row.body) as JsonObject, version: row.version } : null;
}

/**
 * Replace a stored document and raise its version by one. `prepare` runs once the saved version is known to be the
 * current one, so a stale save is always answered with `version_conflict` before any document rule is checked.
 */
export async function replaceDocument(
  client: pg.PoolClient,
  collectionId: string,
  id: string,
  expectedVersion: number,
  prepare: () => JsonObject,
): Promise<StoredDocument> {
  const sequence = await lock(client, collectionId);
  const current = await readDocument(client, collectionId, id);
  if (!current) return fail("not_found");
  if (current.version !== expectedVersion) return fail("version_conflict", { current_version: current.version, current: current.document });
  const document = prepare();
  const uniques = (await loadIndexes(client, collectionId)).filter((index) => index.unique && index !== ID_INDEX);
  const [conflict] = await findConflicts(client, collectionId, [{ id, doc: document }], uniques, true);
  refuseConflict(conflict ?? null);
  const version = current.version + 1;
  await client.query("DELETE FROM unique_entries WHERE collection_id = $1 AND doc_id = $2", [collectionId, id]);
  await client.query("UPDATE documents SET body = $3, version = $4 WHERE collection_id = $1 AND id = $2", [collectionId, id, compact(document), version]);
  await writeEntries(client, collectionId, [{ id, doc: document }], uniques);
  await record(client, collectionId, sequence, [{ op: "update", id, document, version }]);
  return { document, version };
}

export async function deleteDocument(client: pg.PoolClient, collectionId: string, id: string): Promise<void> {
  const sequence = await lock(client, collectionId);
  const removed = await client.query("DELETE FROM documents WHERE collection_id = $1 AND id = $2", [collectionId, id]);
  if (removed.rowCount === 0) fail("not_found");
  await client.query("DELETE FROM unique_entries WHERE collection_id = $1 AND doc_id = $2", [collectionId, id]);
  await record(client, collectionId, sequence, [{ op: "delete", id, document: null, version: null }]);
}

/** Create an index; a unique one is built over the stored documents in `_id` order and refused on the first repeat. */
export async function createIndex(client: pg.PoolClient, collectionId: string, definition: IndexDefinition): Promise<void> {
  await lock(client, collectionId);
  const existing = await loadIndexes(client, collectionId);
  if (existing.some((index) => index.name === definition.name)) fail("name_taken");
  await client.query("INSERT INTO indexes (collection_id, name, keys, is_unique) VALUES ($1, $2, $3, $4)", [collectionId, definition.name, compact(definition.keys), definition.unique]);
  if (!definition.unique) return;
  const seen = new Set<string>();
  const rows: { id: string; doc: JsonObject }[] = [];
  for (const doc of await loadDocuments(client, collectionId)) {
    const entries = indexEntries(doc, definition);
    const repeat = entries.find((entry) => seen.has(entry.hash));
    if (repeat) return fail("duplicate_key", { index: definition.name, value: repeat.value });
    for (const entry of entries) seen.add(entry.hash);
    rows.push({ id: doc["_id"] as string, doc });
  }
  await writeEntries(client, collectionId, rows, [definition]);
}

export async function dropIndex(client: pg.PoolClient, collectionId: string, name: string): Promise<void> {
  await lock(client, collectionId);
  const removed = await client.query("DELETE FROM indexes WHERE collection_id = $1 AND name = $2", [collectionId, name]);
  if (removed.rowCount === 0) fail("not_found");
  await client.query("DELETE FROM unique_entries WHERE collection_id = $1 AND index_name = $2", [collectionId, name]);
}
