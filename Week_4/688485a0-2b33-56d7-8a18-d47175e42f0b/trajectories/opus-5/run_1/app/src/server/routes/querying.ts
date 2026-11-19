import { Router } from 'express';
import { CompiledStage, compileStage, runPipeline } from '../../shared/aggregate';
import { documentDepth } from '../../shared/documentRules';
import { invalidField, invalidQuery, nameTaken, notFound, queryTooDeep, scanLimit, tooManyStages } from '../../shared/errors';
import { IndexDefinition, planQuery } from '../../shared/indexPlan';
import { QUERY_DEPTH_LIMIT, parseQuerySpec, runQuery } from '../../shared/queryRun';
import { computeSchema } from '../../shared/schema';
import { DocObject, fromJson, toJson } from '../../shared/values';
import { collectionAccess, isUuid, requireUser, requireWriter } from '../access';
import { listIndexes, loadDocuments, newId } from '../collectionStore';
import { config } from '../config';
import { query, queryOne } from '../db';
import { body, handler } from '../httpUtil';
import { formatTime } from '../time';

export const queryRoutes = Router();

const PATH = '/projects/:pid/collections/:cid';

function readStages(value: unknown): DocObject[] {
  if (!Array.isArray(value)) throw invalidField('pipeline');
  if (value.length > config.limits.maxStages) throw tooManyStages(config.limits.maxStages);
  return value.map((item) => fromJson(item) as DocObject);
}

function readDisabled(value: unknown): Set<number> {
  if (value === undefined || value === null) return new Set();
  if (!Array.isArray(value)) throw invalidField('disabled');
  const out = new Set<number>();
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0) throw invalidField('disabled');
    out.add(item);
  }
  return out;
}

function compilePipeline(stages: DocObject[]): CompiledStage[] {
  return stages.map((stage, index) => {
    if (documentDepth(stage) > QUERY_DEPTH_LIMIT) throw queryTooDeep(QUERY_DEPTH_LIMIT);
    return compileStage(stage, index);
  });
}

/** A pipeline examines its first enabled `$match`, or the whole collection. */
function pipelineExamined(
  compiled: CompiledStage[],
  disabled: Set<number>,
  docs: DocObject[],
  indexes: IndexDefinition[],
): number {
  const firstEnabled = compiled.findIndex((_stage, index) => !disabled.has(index));
  if (firstEnabled >= 0) {
    const stage = compiled[firstEnabled].stage;
    if (stage.kind === 'match') return planQuery(stage.filter, indexes, docs).docs_examined;
  }
  return docs.length;
}

queryRoutes.post(
  `${PATH}/query`,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    const spec = parseQuerySpec(body(req));
    const docs = await loadDocuments(access.collection.id);
    const indexes = await listIndexes(access.collection.id);
    const result = runQuery(docs, spec, indexes, {
      scanLimit: config.limits.scanLimit,
      pageSize: config.limits.pageSize,
    });
    res.json({
      matched: result.matched,
      page: result.page,
      page_size: result.page_size,
      documents: result.documents.map((doc) => toJson(doc)),
      ids: result.ids,
      plan: result.plan,
    });
  }),
);

queryRoutes.post(
  `${PATH}/aggregate`,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    const fields = body(req);
    const stages = readStages(fields['pipeline']);
    const disabled = readDisabled(fields['disabled']);
    const compiled = compilePipeline(stages);
    const docs = await loadDocuments(access.collection.id);
    const indexes = await listIndexes(access.collection.id);
    const examined = pipelineExamined(compiled, disabled, docs, indexes);
    if (examined > config.limits.scanLimit) throw scanLimit(config.limits.scanLimit);

    if (fields['preview'] === true) {
      const pinValue = fields['pin'];
      const pin = typeof pinValue === 'string' && pinValue.length > 0 ? pinValue : null;
      if (pin && !docs.some((doc) => doc['_id'] === pin)) throw notFound();
      const run = runPipeline(docs, compiled, disabled, config.limits.previewDocs, pin);
      res.json({
        input: run.input,
        stages: run.stages.map((stage) => ({
          index: stage.index,
          count: stage.count,
          disabled: stage.disabled,
          documents: stage.documents.map((doc) => toJson(doc)),
        })),
        pin: pin ? { _id: pin, stopped_at: run.pinStoppedAt } : null,
      });
    } else {
      const rawPage = fields['page'] === undefined || fields['page'] === null ? 1 : fields['page'];
      if (typeof rawPage !== 'number' || !Number.isInteger(rawPage) || rawPage < 1) throw invalidQuery('page');
      const run = runPipeline(docs, compiled, disabled, 0, null);
      const start = (rawPage - 1) * config.limits.pageSize;
      res.json({
        count: run.output.length,
        page: rawPage,
        page_size: config.limits.pageSize,
        documents: run.output.slice(start, start + config.limits.pageSize).map((doc) => toJson(doc)),
      });
    }
  }),
);

queryRoutes.get(
  `${PATH}/pipeline`,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    const draft = await queryOne<{ stages: string; disabled: string }>(
      'select stages, disabled from pipeline_drafts where collection_id = $1 and user_id = $2',
      [access.collection.id, user.id],
    );
    res.json({
      stages: draft ? (JSON.parse(draft.stages) as string[]) : [],
      disabled: draft ? (JSON.parse(draft.disabled) as number[]) : [],
    });
  }),
);

queryRoutes.put(
  `${PATH}/pipeline`,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    const fields = body(req);
    const stages = fields['stages'];
    if (!Array.isArray(stages) || stages.some((stage) => typeof stage !== 'string')) throw invalidField('stages');
    if (stages.length > config.limits.maxStages) throw tooManyStages(config.limits.maxStages);
    for (const stage of stages as string[]) {
      if (Buffer.byteLength(stage, 'utf8') > config.limits.maxDocBytes) throw invalidField('stages');
    }
    const disabled = Array.from(readDisabled(fields['disabled'])).sort((left, right) => left - right);
    await query(
      `insert into pipeline_drafts (collection_id, user_id, stages, disabled, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (collection_id, user_id) do update set stages = $3, disabled = $4, updated_at = now()`,
      [access.collection.id, user.id, JSON.stringify(stages), JSON.stringify(disabled)],
    );
    res.json({ stages, disabled });
  }),
);

queryRoutes.get(
  `${PATH}/schema`,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    const docs = await loadDocuments(access.collection.id);
    const summary = computeSchema(docs.slice(0, config.limits.schemaSample));
    res.json(summary);
  }),
);

interface SavedQueryRow {
  id: string;
  name: string;
  filter: string;
  projection: string | null;
  sort: string | null;
  limit_value: number;
  last_run_at: Date | null;
  last_count: number | null;
}

function savedQueryBody(row: SavedQueryRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    filter: JSON.parse(row.filter) as unknown,
    projection: row.projection ? (JSON.parse(row.projection) as unknown) : null,
    sort: row.sort ? (JSON.parse(row.sort) as unknown) : null,
    limit: row.limit_value,
    last_run_at: row.last_run_at ? formatTime(row.last_run_at) : null,
    last_count: row.last_count,
  };
}

function readSavedQueryFields(fields: Record<string, unknown>): {
  name: string;
  filter: unknown;
  projection: unknown;
  sort: unknown;
  limit: number;
} {
  const name = fields['name'];
  if (typeof name !== 'string' || name.length < 1 || name.length > 80) throw invalidField('name');
  const spec = parseQuerySpec({ ...fields, page: 1 });
  return {
    name,
    filter: fields['filter'] ?? {},
    projection: fields['projection'] ?? null,
    sort: fields['sort'] ?? null,
    limit: spec.limit,
  };
}

const SAVED = `${PATH}/saved-queries`;

queryRoutes.get(
  SAVED,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    const rows = await query<SavedQueryRow>(
      `select id, name, filter, projection, sort, limit_value, last_run_at, last_count
       from saved_queries where collection_id = $1 order by name collate "C" asc`,
      [access.collection.id],
    );
    res.json({ saved_queries: rows.map(savedQueryBody) });
  }),
);

queryRoutes.post(
  SAVED,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    requireWriter(access.role);
    const fields = readSavedQueryFields(body(req));
    const taken = await queryOne('select 1 from saved_queries where collection_id = $1 and name = $2', [
      access.collection.id,
      fields.name,
    ]);
    if (taken) throw nameTaken();
    const id = newId();
    const rows = await query<SavedQueryRow>(
      `insert into saved_queries (id, collection_id, name, filter, projection, sort, limit_value)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, name, filter, projection, sort, limit_value, last_run_at, last_count`,
      [
        id,
        access.collection.id,
        fields.name,
        JSON.stringify(fields.filter),
        fields.projection === null ? null : JSON.stringify(fields.projection),
        fields.sort === null ? null : JSON.stringify(fields.sort),
        fields.limit,
      ],
    );
    res.status(201).json({ saved_query: savedQueryBody(rows[0]) });
  }),
);

queryRoutes.put(
  `${SAVED}/:qid`,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    if (!isUuid(req.params.qid)) throw notFound();
    const existing = await queryOne<{ id: string }>('select id from saved_queries where id = $1 and collection_id = $2', [
      req.params.qid,
      access.collection.id,
    ]);
    if (!existing) throw notFound();
    requireWriter(access.role);
    const fields = readSavedQueryFields(body(req));
    const clash = await queryOne('select 1 from saved_queries where collection_id = $1 and name = $2 and id <> $3', [
      access.collection.id,
      fields.name,
      existing.id,
    ]);
    if (clash) throw nameTaken();
    const rows = await query<SavedQueryRow>(
      `update saved_queries set name = $2, filter = $3, projection = $4, sort = $5, limit_value = $6
       where id = $1
       returning id, name, filter, projection, sort, limit_value, last_run_at, last_count`,
      [
        existing.id,
        fields.name,
        JSON.stringify(fields.filter),
        fields.projection === null ? null : JSON.stringify(fields.projection),
        fields.sort === null ? null : JSON.stringify(fields.sort),
        fields.limit,
      ],
    );
    res.json({ saved_query: savedQueryBody(rows[0]) });
  }),
);

queryRoutes.delete(
  `${SAVED}/:qid`,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    if (!isUuid(req.params.qid)) throw notFound();
    const existing = await queryOne<{ id: string }>('select id from saved_queries where id = $1 and collection_id = $2', [
      req.params.qid,
      access.collection.id,
    ]);
    if (!existing) throw notFound();
    requireWriter(access.role);
    await query('delete from saved_queries where id = $1', [existing.id]);
    res.status(204).end();
  }),
);

queryRoutes.post(
  `${SAVED}/:qid/run`,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    if (!isUuid(req.params.qid)) throw notFound();
    const row = await queryOne<SavedQueryRow>(
      `select id, name, filter, projection, sort, limit_value, last_run_at, last_count
       from saved_queries where id = $1 and collection_id = $2`,
      [req.params.qid, access.collection.id],
    );
    if (!row) throw notFound();
    const saved = savedQueryBody(row);
    const spec = parseQuerySpec({
      filter: saved['filter'],
      projection: saved['projection'],
      sort: saved['sort'],
      limit: saved['limit'],
      page: body(req)['page'],
    });
    const docs = await loadDocuments(access.collection.id);
    const indexes = await listIndexes(access.collection.id);
    const result = runQuery(docs, spec, indexes, {
      scanLimit: config.limits.scanLimit,
      pageSize: config.limits.pageSize,
    });
    const updated = await query<SavedQueryRow>(
      `update saved_queries set last_run_at = now(), last_count = $2 where id = $1
       returning id, name, filter, projection, sort, limit_value, last_run_at, last_count`,
      [row.id, result.matched],
    );
    res.json({
      matched: result.matched,
      page: result.page,
      page_size: result.page_size,
      documents: result.documents.map((doc) => toJson(doc)),
      ids: result.ids,
      plan: result.plan,
      saved_query: savedQueryBody(updated[0]),
    });
  }),
);
