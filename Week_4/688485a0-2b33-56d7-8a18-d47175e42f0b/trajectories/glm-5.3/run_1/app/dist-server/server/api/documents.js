import { compactJson } from "../../shared/values.js";
import { parseFilter, matches, parseSort } from "../../shared/query/filter.js";
import { sortDocs } from "../../shared/query/sort.js";
import { parseProjection, applyProjection, ProjectionError } from "../../shared/query/projection.js";
import { choosePlan } from "../../shared/query/index-plan.js";
import { pathFanout } from "../../shared/query/paths.js";
import { fail, RequestError } from "../../shared/errors.js";
import { documentIndexEntries, keyText } from "../db/unique-index.js";
import { parseValidator } from "../../shared/query/validator.js";
export async function collectionById(db, pid, cid) {
    const r = await db.query("SELECT id, name, (SELECT count(*)::int FROM documents WHERE collection_id = c.id) AS count, sequence FROM collections c WHERE c.id = $1 AND c.project_id = $2", [cid, pid]);
    return r.rows.length > 0 ? r.rows[0] : null;
}
export async function loadDocs(db, cid) {
    const r = await db.query("SELECT body FROM documents WHERE collection_id = $1 ORDER BY _id ASC", [cid]);
    return r.rows.map(row => row.body);
}
export async function loadDoc(db, cid, did) {
    const r = await db.query("SELECT body, version FROM documents WHERE collection_id = $1 AND _id = $2", [cid, did]);
    return r.rows.length > 0 ? { doc: r.rows[0].body, version: r.rows[0].version } : null;
}
export async function indexesOf(db, cid) {
    const r = await db.query("SELECT name, keys, unique_flag FROM indexes WHERE collection_id = $1", [cid]);
    const all = r.rows.map(row => {
        const keys = row.keys;
        return {
            name: row.name,
            keys: Object.keys(keys).map(k => ({ path: k, dir: keys[k] === -1 ? -1 : 1 })),
            unique: row.unique_flag,
        };
    });
    all.unshift({ name: "_id_", keys: [{ path: "_id", dir: 1 }], unique: true });
    all.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return all;
}
/** The first-key values of every document for plan examination counts. */
function firstKeyValues(docs, path) {
    return docs.map(doc => {
        const vals = [...pathFanout(doc, [path])];
        if (vals.length === 0)
            return null;
        return vals[0];
    });
}
/** The one query run (DP-11, DP-37, DP-78). */
export async function runQuery(db, cid, req, limits) {
    let planFilter;
    try {
        planFilter = parseFilter(req.filter);
    }
    catch (err) {
        if (err instanceof RequestError)
            throw err;
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
        ids: pageDocs.map(d => d["_id"]),
        plan: {
            kind: plan.kind,
            index: plan.index,
            docs_examined: plan.docsExamined,
            returned: limited.length,
        },
    };
}
export function parseProjectionOrThrow(raw, withCopies) {
    try {
        return parseProjection(raw, withCopies);
    }
    catch (err) {
        if (err instanceof ProjectionError)
            fail("invalid_projection", 422);
        throw err;
    }
}
function planFor(filter, idx, docs) {
    const values = new Map();
    for (const i of idx)
        values.set(i.keys[0].path, firstKeyValues(docs, i.keys[0].path));
    const chosen = choosePlan(filter, idx, values);
    if (chosen.kind === "full_scan") {
        return { kind: "full_scan", index: null, docsExamined: docs.length };
    }
    return { kind: "index", index: chosen.index, docsExamined: chosen.docsExamined };
}
/** Insert with validation and unique indexes (DP-05, DP-35, DP-41). */
export async function insertDocument(client, cid, doc, id) {
    const seq = await nextSeq(client, cid);
    await client.query("INSERT INTO documents (collection_id, _id, body, version, seq) VALUES ($1, $2, $3, 1, $4)", [cid, id, JSON.stringify(doc), seq]);
    await insertUniqueEntries(client, cid, id, doc);
    return { document: doc, version: 1, seq };
}
export async function updateDocument(client, cid, id, doc) {
    // enforce unique indexes first; the constraint races make exactly one save win
    await deleteUniqueEntries(client, cid, id);
    const r = await client.query("UPDATE documents SET body = $3, version = version + 1, seq = $4 WHERE collection_id = $1 AND _id = $2 RETURNING version", [cid, id, JSON.stringify(doc), await nextSeq(client, cid)]);
    if (r.rows.length === 0)
        fail("not_found", 404);
    const version = r.rows[0].version;
    await insertUniqueEntries(client, cid, id, doc);
    return { document: doc, version, seq: 0 };
}
export async function deleteDocument(client, cid, id) {
    await deleteUniqueEntries(client, cid, id);
    const r = await client.query("DELETE FROM documents WHERE collection_id = $1 AND _id = $2", [cid, id]);
    if (r.rowCount === 0)
        fail("not_found", 404);
}
async function nextSeq(client, cid) {
    const r = await client.query("UPDATE collections SET sequence = sequence + 1 WHERE id = $1 RETURNING sequence", [cid]);
    return Number(r.rows[0].sequence);
}
async function insertUniqueEntries(client, cid, docId, doc) {
    const idx = await client.query("SELECT name, keys FROM indexes WHERE collection_id = $1 AND unique_flag = TRUE", [cid]);
    for (const row of idx.rows) {
        const keys = Object.keys(row.keys).map(k => ({ path: k, dir: row.keys[k] === -1 ? -1 : 1 }));
        for (const entry of documentIndexEntries(doc, keys)) {
            const r = await client.query("INSERT INTO unique_entries (collection_id, index_name, key_text, doc_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING", [cid, row.name, entry.compound, docId]);
            if (r.rowCount === 0) {
                // someone else holds this key
                const holder = await client.query("SELECT doc_id FROM unique_entries WHERE collection_id = $1 AND index_name = $2 AND key_text = $3", [cid, row.name, entry.compound]);
                const holderId = holder.rows[0]?.doc_id;
                if (holderId !== docId) {
                    fail("duplicate_key", 409, { index: row.name, value: firstConflictingValue(doc, keys, entry.compound, holderId) });
                }
            }
        }
    }
}
/** The value reported for duplicate_key: the document's first conflicting value in array order. */
function firstConflictingValue(doc, keys, compound, holderId) {
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
            if (keyText(v) === want)
                return v;
        }
    }
    return perKey.length > 0 ? perKey[0][0] : null;
}
async function deleteUniqueEntries(client, cid, docId) {
    await client.query("DELETE FROM unique_entries WHERE collection_id = $1 AND doc_id = $2", [cid, docId]);
}
/** Rebuild every unique entry for a collection (index creation over existing data, DP-36). */
export async function rebuildUniqueEntries(client, cid, indexName, keys) {
    // documents in _id order; the reported value is the first document whose key
    // value already appeared in an earlier document
    const docs = await client.query("SELECT _id, body FROM documents WHERE collection_id = $1 ORDER BY _id ASC", [cid]);
    const seen = new Map();
    for (const row of docs.rows) {
        for (const entry of documentIndexEntries(row.body, keys)) {
            const earlier = seen.get(entry.compound);
            if (earlier !== undefined) {
                return { duplicate: true, value: firstConflictingValue(row.body, keys, entry.compound, earlier), duplicateDocId: row._id };
            }
            seen.set(entry.compound, row._id);
        }
    }
    for (const row of docs.rows) {
        for (const entry of documentIndexEntries(row.body, keys)) {
            await client.query("INSERT INTO unique_entries (collection_id, index_name, key_text, doc_id) VALUES ($1, $2, $3, $4)", [cid, indexName, entry.compound, row._id]);
        }
    }
    return null;
}
/** The compact text of a document, used for feed payloads and downloads. */
export function docText(doc) {
    return compactJson(doc);
}
/** Record a change on the collection's sequence, in the same transaction (DP-54). */
export async function recordChange(client, cid, op, id, doc, version) {
    const seq = await nextSeq(client, cid);
    await client.query("INSERT INTO changes (collection_id, seq, op, _id, document, version) VALUES ($1, $2, $3, $4, $5, $6)", [cid, seq, op, id, doc === null ? null : JSON.stringify(doc), version]);
}
/** The stored validator, parsed, or null (DP-41). */
export async function loadValidator(db, cid) {
    const r = await db.query("SELECT validator FROM validators WHERE collection_id = $1", [cid]);
    if (r.rows.length === 0 || r.rows[0].validator === null)
        return null;
    return parseValidator(r.rows[0].validator);
}
/** The one path from a document message to its API error (DP-87). */
export function docRefusal(message) {
    if (message === "not an object")
        fail("invalid_field", 422, { field: "document" });
    if (message === "invalid _id")
        fail("invalid_id", 422);
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
export function validationText(path, rule, expected) {
    switch (rule) {
        case "required": return `Document failed validation at ${path}: required field is missing`;
        case "bsonType": return `Document failed validation at ${path}: expected ${expected}`;
        case "minimum": return `Document failed validation at ${path}: must be at least ${expected}`;
        case "maximum": return `Document failed validation at ${path}: must be at most ${expected}`;
        default: return `Document failed validation at ${path}: must be one of ${expected}`;
    }
}
