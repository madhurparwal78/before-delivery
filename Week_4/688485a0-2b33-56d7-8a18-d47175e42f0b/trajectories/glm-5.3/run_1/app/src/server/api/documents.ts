import { Pool, PoolClient } from "pg";
import { JsonObj, JsonValue, compactJson } from "../../shared/values.js";
import { parseFilter, matches, parseSort, FilterPlan } from "../../shared/query/filter.js";
import { sortDocs } from "../../shared/query/sort.js";
import { parseProjection, applyProjection, ProjectionError } from "../../shared/query/projection.js";
import { choosePlan, IndexDef } from "../../shared/query/index-plan.js";
import { pathFanout } from "../../shared/query/paths.js";
import { fail, RequestError } from "../../shared/errors.js";
import { Limits } from "../../shared/config.js";
import { documentIndexEntries, keyText, KeyPath } from "../db/unique-index.js";
import { parseValidator, ValidatorSpec } from "../../shared/query/validator.js";

/**
 * The document store (DP-05, DP-11, DP-37, DP-49, DP-54, DP-55): documents in
 * PostgreSQL, in-memory query runs, plans with examined counts, versions and
 * the per-collection change sequence.
 */

export interface CollectionRow {
  id: string;
  name: string;
  count: number;
  sequence: number;
}

export interface StoredDoc {
  doc: JsonObj;
  version: number;
}

export async function collectionById(db: Pool, pid: string, cid: string): Promise<CollectionRow | null> {
  const r = await db.query(
    "SELECT id, name, (SELECT count(*)::int FROM documents WHERE collection_id = c.id) AS count, sequence FROM collections c WHERE c.id = $1 AND c.project_id = $2",
    [cid, pid],
  );
  return r.rows.length > 0 ? (r.rows[0] as CollectionRow) : null;
}

export async function loadDocs(db: Pool, cid: string): Promise<JsonObj[]> {
  const r = await db.query(
    "SELECT body FROM documents WHERE collection_id = $1 ORDER BY _id ASC",
    [cid],
  );
  return r.rows.map(row => row.body as JsonObj);
}

export async function loadDoc(db: Pool, cid: string, did: string): Promise<StoredDoc | null> {
  const r = await db.query(
    "SELECT body, version FROM documents WHERE collection_id = $1 AND _id = $2",
    [cid, did],
  );
  return r.rows.length > 0 ? { doc: r.rows[0].body as JsonObj, version: r.rows[0].version as number } : null;
}

export async function indexesOf(db: Pool, cid: string): Promise<IndexDef[]> {
  const r = await db.query(
    "SELECT name, keys, unique_flag FROM indexes WHERE collection_id = $1",
    [cid],
  );
  const all: IndexDef[] = r.rows.map(row => {
    const keys = row.keys as Record<string, number>;
    return {
      name: row.name as string,
      keys: Object.keys(keys).map(k => ({ path: k, dir: keys[k] === -1 ? -1 : 1 })),
      unique: row.unique_flag as boolean,
    };
  });
  all.unshift({ name: "_id_", keys: [{ path: "_id", dir: 1 }], unique: true });
  all.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return all;
}

/** The first-key values of every document for plan examination counts. */
function firstKeyValues(docs: JsonObj[], path: string): JsonValue[] {
  return docs.map(doc => {
    const vals = [...pathFanout(doc, [path])];
    if (vals.length === 0) return null;
    return vals[0];
  });
}

export interface QueryRequest {
  filter: unknown;
  projection: unknown;
  sort: unknown;
  limit: number;
  page: number;
}

export interface QueryAnswer {
  matched: number;
  page: number;
  page_size: number;
  documents: JsonObj[];
  ids: string[];
  plan: { kind: "index" | "full_scan"; index: string | null; docs_examined: number; returned: number };
}

/** The one query run (DP-11, DP-37, DP-78). */
export async function runQuery(
  db: Pool,
  cid: string,
  req: QueryRequest,
  limits: Limits,
): Promise<QueryAnswer> {
  let planFilter: FilterPlan;
  try {
    planFilter = parseFilter(req.filter);
  } catch (err) {
    if (err instanceof RequestError) throw err;
    throw err;
  }
  const projection = parseProjectionOrThrow(req.projection, false);
  const sortKeys = parseSort(req.sort);
  const docs = await loadDocs(db, cid);
  const idx = await indexesOf(db, cid);

  // plan and examined count
  const plan = planFor(planFilter, idx, docs);

  // scan guard
  if (plan.docsExamined > limits.scanLimit) {
    fail("scan_limit", 422, { limit: limits.scanLimit });
  }

  const matchedDocs = docs.filter(d => matches(planFilter, d));
  const limited = req.limit > 0 ? matchedDocs.slice(0, req.limit) : matchedDocs;
  const sorted = sortDocs(limited, sortKeys);
  const pageSize = limits.pageSize;
  const start = (req.page - 1) * pageSize;
  const pageDocs = sorted.slice(start, start + pageSize);
  return {
    matched: limited.length,
    page: req.page,
    page_size: pageSize,
    documents: pageDocs.map(d => applyProjection(d, projection)),
    ids: pageDocs.map(d => d["_id"] as string),
    plan: {
      kind: plan.kind,
      index: plan.index,
      docs_examined: plan.docsExamined,
      returned: limited.length,
    },
  };
}

export function parseProjectionOrThrow(raw: unknown, withCopies: boolean): ReturnType<typeof parseProjection> {
  try {
    return parseProjection(raw, withCopies);
  } catch (err) {
    if (err instanceof ProjectionError) fail("invalid_projection", 422);
    throw err;
  }
}

function planFor(filter: FilterPlan, idx: IndexDef[], docs: JsonObj[]): { kind: "index" | "full_scan"; index: string | null; docsExamined: number } {
  const values = new Map<string, JsonValue[]>();
  for (const i of idx) values.set(i.keys[0].path, firstKeyValues(docs, i.keys[0].path));
  const chosen = choosePlan(filter, idx, values);
  if (chosen.kind === "full_scan") {
    return { kind: "full_scan", index: null, docsExamined: docs.length };
  }
  return { kind: "index", index: chosen.index, docsExamined: chosen.docsExamined };
}

export interface WriteOutcome {
  document: JsonObj;
  version: number;
  seq: number;
}

/** Insert with validation and unique indexes (DP-05, DP-35, DP-41). */
export async function insertDocument(
  client: PoolClient,
  cid: string,
  doc: JsonObj,
  id: string,
): Promise<WriteOutcome> {
  const seq = await nextSeq(client, cid);
  await client.query(
    "INSERT INTO documents (collection_id, _id, body, version, seq) VALUES ($1, $2, $3, 1, $4)",
    [cid, id, JSON.stringify(doc), seq],
  );
  await insertUniqueEntries(client, cid, id, doc);
  return { document: doc, version: 1, seq };
}

export async function updateDocument(
  client: PoolClient,
  cid: string,
  id: string,
  doc: JsonObj,
): Promise<WriteOutcome> {
  // enforce unique indexes first; the constraint races make exactly one save win
  await deleteUniqueEntries(client, cid, id);
  const r = await client.query(
    "UPDATE documents SET body = $3, version = version + 1, seq = $4 WHERE collection_id = $1 AND _id = $2 RETURNING version",
    [cid, id, JSON.stringify(doc), await nextSeq(client, cid)],
  );
  if (r.rows.length === 0) fail("not_found", 404);
  const version = r.rows[0].version as number;
  await insertUniqueEntries(client, cid, id, doc);
  return { document: doc, version, seq: 0 };
}

export async function deleteDocument(client: PoolClient, cid: string, id: string): Promise<void> {
  await deleteUniqueEntries(client, cid, id);
  const r = await client.query(
    "DELETE FROM documents WHERE collection_id = $1 AND _id = $2",
    [cid, id],
  );
  if (r.rowCount === 0) fail("not_found", 404);
}

async function nextSeq(client: PoolClient, cid: string): Promise<number> {
  const r = await client.query(
    "UPDATE collections SET sequence = sequence + 1 WHERE id = $1 RETURNING sequence",
    [cid],
  );
  return Number(r.rows[0].sequence);
}

async function insertUniqueEntries(client: PoolClient, cid: string, docId: string, doc: JsonObj): Promise<void> {
  const idx = await client.query("SELECT name, keys FROM indexes WHERE collection_id = $1 AND unique_flag = TRUE", [cid]);
  for (const row of (idx.rows as { name: string; keys: Record<string, number> }[])) {
    const keys: KeyPath[] = Object.keys(row.keys).map(k => ({ path: k, dir: row.keys[k] === -1 ? -1 : 1 }));
    for (const entry of documentIndexEntries(doc, keys)) {
      const r = await client.query(
        "INSERT INTO unique_entries (collection_id, index_name, key_text, doc_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
        [cid, row.name, entry.compound, docId],
      );
      if (r.rowCount === 0) {
        // someone else holds this key
        const holder = await client.query(
          "SELECT doc_id FROM unique_entries WHERE collection_id = $1 AND index_name = $2 AND key_text = $3",
          [cid, row.name, entry.compound],
        );
        const holderId = holder.rows[0]?.doc_id as string | undefined;
        if (holderId !== docId) {
          fail("duplicate_key", 409, { index: row.name, value: firstConflictingValue(doc, keys, entry.compound, holderId) });
        }
      }
    }
  }
}

/** The value reported for duplicate_key: the document's first conflicting value in array order. */
function firstConflictingValue(doc: JsonObj, keys: { path: string; dir: 1 | -1 }[], compound: string, holderId: string | undefined): JsonValue {
  void compound;
  void holderId;
  const perKey = keys.map(k => {
    const vals = [...pathFanout(doc, [k.path])];
    return vals.length === 0 ? [null] : vals;
  });
  const texts = compound.split(" ");
  for (let i = 0; i < perKey.length; i++) {
    const want = texts[i];
    for (const v of perKey[i]) {
      if (keyText(v) === want) return v;
    }
  }
  return perKey.length > 0 ? perKey[0][0] : null;
}

async function deleteUniqueEntries(client: PoolClient, cid: string, docId: string): Promise<void> {
  await client.query("DELETE FROM unique_entries WHERE collection_id = $1 AND doc_id = $2", [cid, docId]);
}

/** Rebuild every unique entry for a collection (index creation over existing data, DP-36). */
export async function rebuildUniqueEntries(
  client: PoolClient,
  cid: string,
  indexName: string,
  keys: KeyPath[],
): Promise<{ duplicate: boolean; value: JsonValue; duplicateDocId: string } | null> {
  // documents in _id order; the reported value is the first document whose key
  // value already appeared in an earlier document
  const docs = await client.query(
    "SELECT _id, body FROM documents WHERE collection_id = $1 ORDER BY _id ASC",
    [cid],
  );
  const seen = new Map<string, string>();
  for (const row of docs.rows as { _id: string; body: JsonObj }[]) {
    for (const entry of documentIndexEntries(row.body, keys)) {
      const earlier = seen.get(entry.compound);
      if (earlier !== undefined) {
        return { duplicate: true, value: firstConflictingValue(row.body, keys, entry.compound, earlier), duplicateDocId: row._id };
      }
      seen.set(entry.compound, row._id);
    }
  }
  for (const row of docs.rows as { _id: string; body: JsonObj }[]) {
    for (const entry of documentIndexEntries(row.body, keys)) {
      await client.query(
        "INSERT INTO unique_entries (collection_id, index_name, key_text, doc_id) VALUES ($1, $2, $3, $4)",
        [cid, indexName, entry.compound, row._id],
      );
    }
  }
  return null;
}

/** The compact text of a document, used for feed payloads and downloads. */
export function docText(doc: JsonObj): string {
  return compactJson(doc);
}

/** Record a change on the collection's sequence, in the same transaction (DP-54). */
export async function recordChange(
  client: PoolClient,
  cid: string,
  op: "insert" | "update" | "delete",
  id: string,
  doc: JsonObj | null,
  version: number | null,
): Promise<void> {
  const seq = await nextSeq(client, cid);
  await client.query(
    "INSERT INTO changes (collection_id, seq, op, _id, document, version) VALUES ($1, $2, $3, $4, $5, $6)",
    [cid, seq, op, id, doc === null ? null : JSON.stringify(doc), version],
  );
}

/** The stored validator, parsed, or null (DP-41). */
export async function loadValidator(db: Pool, cid: string): Promise<ValidatorSpec | null> {
  const r = await db.query("SELECT validator FROM validators WHERE collection_id = $1", [cid]);
  if (r.rows.length === 0 || r.rows[0].validator === null) return null;
  return parseValidator(r.rows[0].validator);
}

/** The one path from a document message to its API error (DP-87). */
export function docRefusal(message: string): never {
  if (message === "not an object") fail("invalid_field", 422, { field: "document" });
  if (message === "invalid _id") fail("invalid_id", 422);
  if (message.startsWith("invalid field name at ")) {
    fail("invalid_field_name", 422, { path: message.slice("invalid field name at ".length) });
  }
  if (message.startsWith("document is larger than ")) {
    const n = Number(message.slice("document is larger than ".length).replace(" bytes", ""));
    fail("document_too_large", 422, { limit: n });
  }
  if (message.startsWith("document is nested deeper than ")) {
    const n = Number(message.slice("document is nested deeper than ".length).replace(" levels", ""));
    fail("document_too_deep", 422, { limit: n });
  }
  fail("invalid_field", 422, { field: "document" });
}

/** The validation text of the published document messages. */
export function validationText(path: string, rule: string, expected?: string): string {
  switch (rule) {
    case "required": return `Document failed validation at ${path}: required field is missing`;
    case "bsonType": return `Document failed validation at ${path}: expected ${expected}`;
    case "minimum": return `Document failed validation at ${path}: must be at least ${expected}`;
    case "maximum": return `Document failed validation at ${path}: must be at most ${expected}`;
    default: return `Document failed validation at ${path}: must be one of ${expected}`;
  }
}
