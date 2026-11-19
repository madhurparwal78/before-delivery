import type { JsonObject, JsonValue } from "../../shared/json.js";
import { isUuid, openCollection, requireWriter } from "../access.js";
import { config } from "../config.js";
import { db, isUniqueViolation } from "../db.js";
import { MAX_QUERY_DEPTH, compilePipeline, pipelinePlan, previewBody, runPipeline } from "../engine/aggregate.js";
import { type Predicate, compileFilter } from "../engine/filter.js";
import { choosePlan } from "../engine/indexes.js";
import { type Projection, compileProjection } from "../engine/projection.js";
import { parseSort, sortDocuments } from "../engine/sort.js";
import { compact, depthOf, isPlainObject, isWholeNumber } from "../engine/value.js";
import { fail } from "../errors.js";
import { route } from "../http.js";
import { utcText } from "../time.js";
import { countDocuments, loadDocuments, loadIndexes } from "../store.js";
import type { QueryPlan } from "../engine/indexes.js";

/** Queries, aggregation previews, saved queries and each person's pipeline draft. */

const base = "/api/projects/:pid/collections/:cid";

interface QuerySpec {
  filter: JsonObject;
  projection: JsonObject | null;
  sort: JsonObject | null;
  limit: number;
}

interface Compiled {
  spec: QuerySpec;
  page: number;
  test: Predicate;
  project: Projection;
}

const invalidQuery = (field: string): never => fail("invalid_query", { field });

function optionalObject(value: JsonValue | undefined, field: string): JsonObject | null {
  if (value === undefined || value === null) return null;
  return isPlainObject(value) ? value : invalidQuery(field);
}

/** Validate a query body in the published order: shapes, nesting depth, then the filter, projection and sort. */
type QueryBody = Record<string, JsonValue | undefined>;

export function compileQuery(body: QueryBody): Compiled {
  const filter = body["filter"] === undefined ? {} : body["filter"];
  if (!isPlainObject(filter)) invalidQuery("filter");
  const projection = optionalObject(body["projection"], "projection");
  const sort = optionalObject(body["sort"], "sort");
  const limit = body["limit"] === undefined ? 0 : body["limit"];
  if (!isWholeNumber(limit, 0)) invalidQuery("limit");
  const page = body["page"] === undefined ? 1 : body["page"];
  if (!isWholeNumber(page, 1)) invalidQuery("page");
  for (const part of [filter, projection, sort]) if (part && depthOf(part) > MAX_QUERY_DEPTH) fail("query_too_deep", { limit: MAX_QUERY_DEPTH });
  const test = compileFilter(filter as JsonObject);
  const project = projection ? compileProjection(projection, false) : (doc: JsonObject) => doc;
  parseSort(sort);
  return { spec: { filter: filter as JsonObject, projection, sort, limit: limit as number }, page: page as number, test, project };
}

function refuseOverLimit(examined: number): void {
  if (examined > config.limits.scanLimit) fail("scan_limit", { limit: config.limits.scanLimit });
}

/** The documents a plan examines. Refuses with `scan_limit` before loading anything when a full scan is too big. */
export async function loadForPlan(collectionId: string, plan: QueryPlan): Promise<{ docs: JsonObject[]; examined: number }> {
  const total = await countDocuments(db, collectionId);
  if (plan.firstKey === null) refuseOverLimit(total);
  const docs = await loadDocuments(db, collectionId);
  const examined = plan.firstKey ? docs.filter(plan.firstKey).length : docs.length;
  refuseOverLimit(examined);
  return { docs, examined };
}

export function matchingDocuments(docs: JsonObject[], { spec, test }: Compiled): JsonObject[] {
  const matched = sortDocuments(docs.filter(test), spec.sort);
  return spec.limit > 0 ? matched.slice(0, spec.limit) : matched;
}

async function runQuery(collectionId: string, compiled: Compiled) {
  const plan = choosePlan(compiled.spec.filter, await loadIndexes(db, collectionId));
  const { docs, examined } = await loadForPlan(collectionId, plan);
  const matched = matchingDocuments(docs, compiled);
  const size = config.limits.pageSize;
  const shown = matched.slice((compiled.page - 1) * size, compiled.page * size);
  return {
    matched: matched.length,
    page: compiled.page,
    page_size: size,
    documents: shown.map(compiled.project),
    ids: shown.map((doc) => doc["_id"] as string),
    plan: { kind: plan.index === null ? "full_scan" : "index", index: plan.index, docs_examined: examined, returned: matched.length },
  } satisfies JsonObject;
}

route("POST", `${base}/query`, async (ctx) => {
  const { collection } = await openCollection(ctx);
  return { status: 200, body: await runQuery(collection.id, compileQuery(ctx.object())) };
});

function parseDisabled(value: JsonValue | undefined): Set<number> {
  if (value === undefined) return new Set();
  if (!Array.isArray(value) || !value.every((index) => isWholeNumber(index, 0))) return fail("invalid_field", { field: "disabled" });
  return new Set(value as number[]);
}

route("POST", `${base}/aggregate`, async (ctx) => {
  const { collection } = await openCollection(ctx);
  const body = ctx.object();
  const raw = body["pipeline"];
  if (!Array.isArray(raw)) fail("invalid_field", { field: "pipeline" });
  const disabled = parseDisabled(body["disabled"]);
  const pin = body["pin"] === undefined || body["pin"] === null ? null : body["pin"];
  if (pin !== null && typeof pin !== "string") fail("invalid_field", { field: "pin" });
  const page = body["page"] === undefined ? 1 : body["page"];
  if (!isWholeNumber(page, 1)) invalidQuery("page");
  const pipeline = compilePipeline(raw as JsonValue[], config.limits.maxStages);
  const plan = pipelinePlan(pipeline, disabled, await loadIndexes(db, collection.id));
  const { docs } = await loadForPlan(collection.id, plan);
  if (pin !== null && !docs.some((doc) => doc["_id"] === pin)) fail("not_found");
  const run = runPipeline(pipeline, disabled, docs, config.limits.previewDocs, pin as string | null);
  if (body["preview"] === true) {
    return { status: 200, body: previewBody(run, docs.length, pin as string | null) };
  }
  const size = config.limits.pageSize;
  return { status: 200, body: { count: run.output.length, page: page as number, page_size: size, documents: run.output.slice(((page as number) - 1) * size, (page as number) * size) } };
});

route("GET", `${base}/pipeline`, async (ctx) => {
  const { user, collection } = await openCollection(ctx);
  const row = (await db.query<{ stages: string; disabled: string }>("SELECT stages, disabled FROM drafts WHERE collection_id = $1 AND user_id = $2", [collection.id, user.id])).rows[0];
  return { status: 200, body: { stages: row ? (JSON.parse(row.stages) as JsonValue) : [], disabled: row ? (JSON.parse(row.disabled) as JsonValue) : [] } };
});

route("PUT", `${base}/pipeline`, async (ctx) => {
  const { user, collection } = await openCollection(ctx);
  const body = ctx.object();
  const stages = body["stages"];
  const disabled = body["disabled"];
  if (!Array.isArray(stages) || !stages.every((text) => typeof text === "string" && Buffer.byteLength(text, "utf8") <= config.limits.maxDocBytes)) fail("invalid_field", { field: "stages" });
  if (!Array.isArray(disabled) || !disabled.every((index) => isWholeNumber(index, 0))) fail("invalid_field", { field: "disabled" });
  if (stages.length > config.limits.maxStages) fail("too_many_stages", { limit: config.limits.maxStages });
  await db.query(
    "INSERT INTO drafts (collection_id, user_id, stages, disabled) VALUES ($1, $2, $3, $4) ON CONFLICT (collection_id, user_id) DO UPDATE SET stages = $3, disabled = $4",
    [collection.id, user.id, compact(stages), compact(disabled)],
  );
  return { status: 200, body: { stages, disabled } };
});

interface SavedRow {
  id: string;
  name: string;
  filter: string;
  projection: string | null;
  sort: string | null;
  query_limit: number;
  last_run_at: Date | null;
  last_count: number | null;
}

function savedJson(row: SavedRow): JsonObject {
  return {
    id: row.id,
    name: row.name,
    filter: JSON.parse(row.filter) as JsonValue,
    projection: row.projection === null ? null : (JSON.parse(row.projection) as JsonValue),
    sort: row.sort === null ? null : (JSON.parse(row.sort) as JsonValue),
    limit: row.query_limit,
    last_run_at: row.last_run_at ? utcText(row.last_run_at) : null,
    last_count: row.last_count,
  };
}

const SAVED_COLUMNS = "id, name, filter, projection, sort, query_limit, last_run_at, last_count";

function savedFields(body: JsonObject): { name: string; spec: QuerySpec } {
  const name = typeof body["name"] === "string" ? body["name"].trim() : "";
  const { spec } = compileQuery({ ...body, page: undefined });
  if (name.length < 1 || name.length > 80) fail("invalid_field", { field: "name" });
  return { name, spec };
}

async function findSaved(collectionId: string, id: string): Promise<SavedRow> {
  const found = isUuid(id) ? (await db.query<SavedRow>(`SELECT ${SAVED_COLUMNS} FROM saved_queries WHERE id = $1 AND collection_id = $2`, [id, collectionId])).rows[0] : undefined;
  return found ?? fail("not_found");
}

route("GET", `${base}/saved-queries`, async (ctx) => {
  const { collection } = await openCollection(ctx);
  const result = await db.query<SavedRow>(`SELECT ${SAVED_COLUMNS} FROM saved_queries WHERE collection_id = $1 ORDER BY name COLLATE "C", id`, [collection.id]);
  return { status: 200, body: { saved_queries: result.rows.map(savedJson) } };
});

async function saveQuery(collectionId: string, id: string | null, body: JsonObject): Promise<SavedRow> {
  const { name, spec } = savedFields(body);
  const values = [name, compact(spec.filter), spec.projection && compact(spec.projection), spec.sort && compact(spec.sort), spec.limit];
  try {
    const result =
      id === null
        ? await db.query<SavedRow>(`INSERT INTO saved_queries (collection_id, name, filter, projection, sort, query_limit) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${SAVED_COLUMNS}`, [collectionId, ...values])
        : await db.query<SavedRow>(`UPDATE saved_queries SET name = $2, filter = $3, projection = $4, sort = $5, query_limit = $6 WHERE id = $1 RETURNING ${SAVED_COLUMNS}`, [id, ...values]);
    return result.rows[0] as SavedRow;
  } catch (error) {
    return isUniqueViolation(error) ? fail("name_taken") : Promise.reject(error);
  }
}

route("POST", `${base}/saved-queries`, async (ctx) => {
  const { role, collection } = await openCollection(ctx);
  requireWriter(role);
  return { status: 201, body: { saved_query: savedJson(await saveQuery(collection.id, null, ctx.object())) } };
});

route("PUT", `${base}/saved-queries/:qid`, async (ctx) => {
  const { role, collection } = await openCollection(ctx);
  const found = await findSaved(collection.id, ctx.params["qid"] as string);
  requireWriter(role);
  return { status: 200, body: { saved_query: savedJson(await saveQuery(collection.id, found.id, ctx.object())) } };
});

route("DELETE", `${base}/saved-queries/:qid`, async (ctx) => {
  const { role, collection } = await openCollection(ctx);
  const found = await findSaved(collection.id, ctx.params["qid"] as string);
  requireWriter(role);
  await db.query("DELETE FROM saved_queries WHERE id = $1", [found.id]);
  return { status: 204 };
});

route("POST", `${base}/saved-queries/:qid/run`, async (ctx) => {
  const { collection } = await openCollection(ctx);
  const found = await findSaved(collection.id, ctx.params["qid"] as string);
  const asked = ctx.bytes.length > 0 ? ctx.object() : {};
  const saved = savedJson(found);
  const answer = await runQuery(collection.id, compileQuery({ filter: saved["filter"] as JsonValue, projection: saved["projection"] as JsonValue, sort: saved["sort"] as JsonValue, limit: saved["limit"] as JsonValue, page: asked["page"] }));
  const updated = (
    await db.query<SavedRow>(`UPDATE saved_queries SET last_run_at = now(), last_count = $2 WHERE id = $1 RETURNING ${SAVED_COLUMNS}`, [found.id, answer.matched])
  ).rows[0] as SavedRow;
  return { status: 200, body: { ...answer, saved_query: savedJson(updated) } };
});

