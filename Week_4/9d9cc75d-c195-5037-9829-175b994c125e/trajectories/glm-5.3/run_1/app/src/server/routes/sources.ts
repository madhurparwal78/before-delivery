import type { FastifyInstance } from "fastify";
import { Buffer } from "node:buffer";
import { parseCsv } from "../csv.js";
import { uploadCsv } from "../upload.js";
import { ApiError, errorBody, projectRoleOr404, requireRole, requireUser } from "../auth.js";
import { newId } from "../ids.js";
import { joinRows, loadSource, sha256Of, type JoinedRow } from "../sample.js";
import { StorageUnavailable } from "../storage.js";
import type { ColumnMeta } from "../csv.js";

interface SourceTableMeta {
  name: string;
  rows: number;
  sha256: string;
  columns: { id: string; name: string; type: string; kind: string; continuous: boolean }[];
}

export function tableMeta(columns: ColumnMeta[]): SourceTableMeta["columns"] {
  return columns.map((c) => ({
    id: newId(),
    name: c.name,
    type: c.type,
    kind: c.type === "number" ? "measure" : "dimension",
    continuous: c.type === "date",
  }));
}

function csvBody(req: { body: unknown }): Buffer {
  const b = req.body;
  if (Buffer.isBuffer(b)) return b;
  if (typeof b === "string") return Buffer.from(b, "utf8");
  if (b === undefined || b === null) return Buffer.alloc(0);
  throw new ApiError(415, "unsupported_media_type");
}

export async function sourcePayload(app: FastifyInstance, sourceId: string): Promise<Record<string, unknown>> {
  const db = app.state.db;
  const s = await db.query("SELECT * FROM sources WHERE id = $1", [sourceId]);
  if (s.rows.length === 0) throw new ApiError(404, "not_found");
  const src = s.rows[0];
  const tables = await db.query("SELECT * FROM tables WHERE source_id = $1 ORDER BY name", [sourceId]);
  const fields = await db.query("SELECT * FROM fields WHERE source_id = $1 ORDER BY name", [sourceId]);
  const schedule = await db.query("SELECT * FROM schedules WHERE source_id = $1", [sourceId]);
  const tableList: SourceTableMeta[] = [];
  for (const t of tables.rows) {
    tableList.push({
      name: t.name,
      rows: t.rows_count,
      sha256: t.sha256,
      columns: (t.columns as ColumnMeta[]).map((c) => {
        const f = fields.rows.find((x) => x.name === c.name && x.table_name === t.name);
        return {
          id: f?.id ?? "",
          name: c.name,
          type: c.type,
          kind: f?.kind ?? (c.type === "number" ? "measure" : "dimension"),
          continuous: c.type === "date",
        };
      }),
    });
  }
  const entitlements: Record<string, string[]> = {};
  if (src.entitlement_users) {
    for (const [u, vals] of Object.entries(src.entitlement_users as Record<string, string[]>)) {
      entitlements[u] = vals;
    }
  }
  const scheduleRow = schedule.rows[0];
  return {
    id: src.id,
    name: src.name,
    version: src.version,
    tables: tableList,
    relation: src.relation,
    fields: fields.rows.map((f) => ({
      id: f.id,
      name: f.name,
      table: f.table_name,
      type: f.type,
      kind: f.kind,
      continuous: f.continuous,
      hidden: f.hidden,
    })),
    hierarchy: src.hierarchy,
    entitlements: { field: src.entitlement_field, users: entitlements },
    schedule: scheduleRow
      ? {
          every_minutes: scheduleRow.every_minutes,
          kind: scheduleRow.kind,
          key: scheduleRow.key,
          next_run_at: scheduleRow.next_run_at instanceof Date ? scheduleRow.next_run_at.toISOString() : scheduleRow.next_run_at,
        }
      : null,
    notices: src.notices ?? [],
  };
}

/** Store an uploaded table: object storage first, then the database. */
async function storeTable(
  app: FastifyInstance,
  sourceId: string,
  tableName: string,
  bytes: Buffer,
): Promise<{ ok: boolean; sha: string; parsed: ReturnType<typeof uploadCsv> }> {
  const state = app.state;
  const parsed = uploadCsv(bytes, state.config.csvMaxBytes, state.config.rowMax);
  if (!parsed.ok) return { ok: false, sha: "", parsed };
  const sha = sha256Of(bytes);
  try {
    await state.storage.put(`uploads/${sourceId}/${tableName}/${sha}.csv`, bytes);
  } catch {
    return { ok: false, sha: "", parsed };
  }
  return { ok: true, sha, parsed };
}

async function bumpVersion(app: FastifyInstance, sourceId: string): Promise<void> {
  const db = app.state.db;
  await db.query("UPDATE sources SET version = version + 1 WHERE id = $1", [sourceId]);
}

/** Rebuild the joined snapshot whenever a table changes. */
async function rebuildSnapshot(app: FastifyInstance, sourceId: string): Promise<void> {
  const db = app.state.db;
  const source = await loadSource(db, sourceId);
  if (!source) return;
  const tables = await db.query("SELECT * FROM tables WHERE source_id = $1 ORDER BY name", [sourceId]);
  const relation = source.relation;
  if (tables.rows.length === 0) return;
  const first = tables.rows[0];
  const parsedFirst = parseCsv(Buffer.from(await currentFileBytes(app, sourceId, first.name, first.sha256)), {
    rowMax: app.state.config.rowMax,
  });
  if (tables.rows.length === 1 || !relation) {
    const rows: JoinedRow[] = parsedFirst.records.map((r) => {
      const values: Record<string, string | null> = {};
      parsedFirst.columns.forEach((c, i) => {
        values[c.name] = r[i] ?? null;
      });
      return { values };
    });
    await writeSnapshot(app, sourceId, rows);
    return;
  }
  const second = tables.rows[1];
  const parsedSecond = parseCsv(Buffer.from(await currentFileBytes(app, sourceId, second.name, second.sha256)), {
    rowMax: app.state.config.rowMax,
  });
  const joined = joinRows(parsedFirst, parsedSecond, relation.left_key, relation.right_key);
  await writeSnapshot(app, sourceId, joined.rows);
}

async function currentFileBytes(app: FastifyInstance, sourceId: string, table: string, sha: string): Promise<Buffer> {
  return app.state.storage.get(`uploads/${sourceId}/${table}/${sha}.csv`);
}

async function writeSnapshot(app: FastifyInstance, sourceId: string, rows: JoinedRow[]): Promise<void> {
  const db = app.state.db;
  const versionRes = await db.query("SELECT version FROM sources WHERE id = $1", [sourceId]);
  const version = versionRes.rows[0]?.version ?? 1;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM snapshots WHERE source_id = $1", [sourceId]);
    await client.query("INSERT INTO snapshots (source_id, version, rows) VALUES ($1, $2, $3)", [sourceId, version, JSON.stringify(rows)]);
    await client.query(
      "INSERT INTO extracts (source_id, state, stale, rows_count) VALUES ($1, 'live', false, $2) ON CONFLICT (source_id) DO UPDATE SET state = 'live', stale = false, rows_count = $2, last_success_at = now()",
      [sourceId, rows.length],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export function registerSourceRoutes(app: FastifyInstance): void {
  app.post("/api/projects/:id/sources/preview", async (req, reply) => {
    const user = await requireUser(req);
    const projectId = (req.params as { id: string }).id;
    await projectRoleOr404(app.state.db, user.id, projectId);
    const state = app.state;
    const bytes = csvBody(req);
    if (bytes.length > state.config.csvMaxBytes) {
      return reply.code(413).send({
        error: "too_large",
        columns: [],
        rows: [],
        row_count: 0,
        errors: [{ line: null, message: `File is ${bytes.length} bytes. The limit is ${state.config.csvMaxBytes}.` }],
      });
    }
    const parsed = parseCsv(bytes, { rowMax: state.config.rowMax });
    const errors = [...parsed.errors];
    if (parsed.rowCount === 0 && errors.length === 0) {
      errors.push({ line: null, message: "File is empty." });
    }
    const preview = parsed.records.slice(0, 20).map((r) => r.map((c) => c));
    return reply.send({
      columns: parsed.columns.map((c) => ({ name: c.name, type: c.type })),
      rows: preview,
      row_count: parsed.rowCount,
      errors,
    });
  });

  app.post("/api/projects/:id/sources", async (req, reply) => {
    const user = await requireUser(req);
    const projectId = (req.params as { id: string }).id;
    const role = await projectRoleOr404(app.state.db, user.id, projectId);
    requireRole(role, "creator");
    const state = app.state;
    const query = req.query as Record<string, string>;
    const name = query.name ?? "";
    const table = query.table ?? "";
    if (!name) throw new ApiError(422, "invalid_input", { name: "Name is required." });
    if (!table) throw new ApiError(422, "invalid_input", { table: "Name is required." });
    const bytes = csvBody(req);
    const parsed = uploadCsv(bytes, state.config.csvMaxBytes, state.config.rowMax);
    if (bytes.length > state.config.csvMaxBytes) {
      return reply.code(413).send({ error: "too_large", errors: [{ line: null, message: `File is ${bytes.length} bytes. The limit is ${state.config.csvMaxBytes}.` }] });
    }
    if (!parsed.ok) {
      throw new ApiError(422, "invalid_csv", undefined, undefined);
    }
    // Validation errors are stored with nothing: the errors list is the body.
    const sourceId = newId();
    const stored = await storeTable(app, sourceId, table, bytes);
    if (!stored.ok) throw new ApiError(503, "storage_unavailable");
    await app.state.db.query(
      "INSERT INTO sources (id, project_id, name, version, notices) VALUES ($1, $2, $3, 1, '[]'::jsonb)",
      [sourceId, projectId, name],
    );
    await app.state.db.query(
      "INSERT INTO tables (source_id, name, rows_count, sha256, columns) VALUES ($1, $2, $3, $4, $5)",
      [sourceId, table, parsed.rowCount, stored.sha, JSON.stringify(parsed.columns)],
    );
    for (const c of parsed.columns) {
      await app.state.db.query(
        "INSERT INTO fields (id, source_id, name, table_name, type, kind, continuous, hidden, origin) VALUES ($1, $2, $3, $4, $5, $6, $7, false, 'null'::jsonb)",
        [newId(), sourceId, c.name, table, c.type, c.type === "number" ? "measure" : "dimension", c.type === "date"],
      );
    }
    await rebuildSnapshot(app, sourceId);
    return reply.code(201).send(await sourcePayload(app, sourceId));
  });

  app.post("/api/sources/:id/tables", async (req, reply) => {
    const user = await requireUser(req);
    const sourceId = (req.params as { id: string }).id;
    const source = await loadSource(app.state.db, sourceId);
    if (!source) throw new ApiError(404, "not_found");
    const role = await projectRoleOr404(app.state.db, user.id, await sourceProject(app, sourceId));
    requireRole(role, "creator");
    const query = req.query as Record<string, string>;
    const table = query.table ?? "";
    if (!table) throw new ApiError(422, "invalid_input", { table: "Name is required." });
    if (source.fields.some((f) => f.table === table)) {
      throw new ApiError(422, "invalid_input", { table: "A source holds at most 2 tables." });
    }
    const countRes = await app.state.db.query("SELECT COUNT(*)::int AS n FROM tables WHERE source_id = $1", [sourceId]);
    if (countRes.rows[0].n >= 2) {
      throw new ApiError(422, "invalid_input", { table: "A source holds at most 2 tables." });
    }
    const state = app.state;
    const bytes = csvBody(req);
    if (bytes.length > state.config.csvMaxBytes) {
      return reply.code(413).send({ error: "too_large", errors: [{ line: null, message: `File is ${bytes.length} bytes. The limit is ${state.config.csvMaxBytes}.` }] });
    }
    const parsed = uploadCsv(bytes, state.config.csvMaxBytes, state.config.rowMax);
    if (!parsed.ok) throw new ApiError(422, "invalid_csv");
    const stored = await storeTable(app, sourceId, table, bytes);
    if (!stored.ok) throw new ApiError(503, "storage_unavailable");
    await app.state.db.query(
      "INSERT INTO tables (source_id, name, rows_count, sha256, columns) VALUES ($1, $2, $3, $4, $5)",
      [sourceId, table, parsed.rowCount, stored.sha, JSON.stringify(parsed.columns)],
    );
    for (const c of parsed.columns) {
      await app.state.db.query(
        "INSERT INTO fields (id, source_id, name, table_name, type, kind, continuous, hidden, origin) VALUES ($1, $2, $3, $4, $5, $6, $7, false, 'null'::jsonb)",
        [newId(), sourceId, c.name, table, c.type, c.type === "number" ? "measure" : "dimension", c.type === "date"],
      );
    }
    await bumpVersion(app, sourceId);
    await rebuildSnapshot(app, sourceId);
    return reply.code(201).send(await sourcePayload(app, sourceId));
  });

  app.put("/api/sources/:id/tables/:table", async (req, reply) => {
    const user = await requireUser(req);
    const sourceId = (req.params as { id: string }).id;
    const table = (req.params as { table: string }).table;
    const source = await loadSource(app.state.db, sourceId);
    if (!source) throw new ApiError(404, "not_found");
    const role = await projectRoleOr404(app.state.db, user.id, await sourceProject(app, sourceId));
    requireRole(role, "creator");
    const exists = await app.state.db.query("SELECT name FROM tables WHERE source_id = $1 AND name = $2", [sourceId, table]);
    if (exists.rows.length === 0) throw new ApiError(404, "not_found");
    const state = app.state;
    const bytes = csvBody(req);
    if (bytes.length > state.config.csvMaxBytes) {
      return reply.code(413).send({ error: "too_large", errors: [{ line: null, message: `File is ${bytes.length} bytes. The limit is ${state.config.csvMaxBytes}.` }] });
    }
    const parsed = uploadCsv(bytes, state.config.csvMaxBytes, state.config.rowMax);
    if (!parsed.ok) throw new ApiError(422, "invalid_csv");
    const stored = await storeTable(app, sourceId, table, bytes);
    if (!stored.ok) throw new ApiError(503, "storage_unavailable");
    await app.state.db.query(
      "UPDATE tables SET rows_count = $3, sha256 = $4, columns = $5 WHERE source_id = $1 AND name = $2",
      [sourceId, table, parsed.rowCount, stored.sha, JSON.stringify(parsed.columns)],
    );
    await bumpVersion(app, sourceId);
    return reply.code(200).send(await sourcePayload(app, sourceId));
  });

  app.get("/api/sources/:id", async (req) => {
    const user = await requireUser(req);
    const sourceId = (req.params as { id: string }).id;
    const source = await loadSource(app.state.db, sourceId);
    if (!source) throw new ApiError(404, "not_found");
    const role = await projectRoleOr404(app.state.db, user.id, await sourceProject(app, sourceId));
    if (role === "viewer") throw new ApiError(404, "not_found");
    return sourcePayload(app, sourceId);
  });

  app.get("/api/sources/:id/tables/:table/file", async (req, reply) => {
    const user = await requireUser(req);
    const sourceId = (req.params as { id: string }).id;
    const table = (req.params as { table: string }).table;
    const source = await loadSource(app.state.db, sourceId);
    if (!source) throw new ApiError(404, "not_found");
    const role = await projectRoleOr404(app.state.db, user.id, await sourceProject(app, sourceId));
    requireRole(role, "creator");
    const t = await app.state.db.query("SELECT sha256 FROM tables WHERE source_id = $1 AND name = $2", [sourceId, table]);
    if (t.rows.length === 0) throw new ApiError(404, "not_found");
    try {
      const bytes = await currentFileBytes(app, sourceId, table, t.rows[0].sha256);
      reply.header("content-type", "text/csv");
      return reply.send(bytes);
    } catch (e) {
      if (e instanceof StorageUnavailable) throw new ApiError(503, "storage_unavailable");
      throw e;
    }
  });

  app.put("/api/sources/:id/relation", async (req) => {
    const user = await requireUser(req);
    const sourceId = (req.params as { id: string }).id;
    const source = await loadSource(app.state.db, sourceId);
    if (!source) throw new ApiError(404, "not_found");
    const role = await projectRoleOr404(app.state.db, user.id, await sourceProject(app, sourceId));
    requireRole(role, "creator");
    const body = req.body as { left_table?: string; left_key?: string; right_table?: string; right_key?: string };
    if (!body.left_table || !body.left_key || !body.right_table || !body.right_key) {
      throw new ApiError(422, "invalid_input", { left_key: "Keys must have the same type." });
    }
    const lf = source.fields.find((f) => f.name === body.left_key && f.table === body.left_table);
    const rf = source.fields.find((f) => f.name === body.right_key && f.table === body.right_table);
    if (!lf || !rf || lf.type !== rf.type) {
      throw new ApiError(422, "invalid_input", { right_key: "Keys must have the same type." });
    }
    const relation = {
      left_table: body.left_table,
      left_key: body.left_key,
      right_table: body.right_table,
      right_key: body.right_key,
    };
    await app.state.db.query("UPDATE sources SET relation = $2 WHERE id = $1", [sourceId, JSON.stringify(relation)]);
    await rebuildSnapshot(app, sourceId);
    // The join notice: duplicates in the right table.
    const db = app.state.db;
    const tables = await db.query("SELECT * FROM tables WHERE source_id = $1 ORDER BY name", [sourceId]);
    const right = tables.rows.find((t) => t.name === body.right_table);
    let notices: string[] = [];
    if (right) {
      try {
        const bytes = await currentFileBytes(app, sourceId, right.name, right.sha256);
        const parsed = parseCsv(bytes, { rowMax: app.state.config.rowMax });
        const leftTable = tables.rows.find((t) => t.name === body.left_table);
        if (leftTable) {
          const parsedLeft = parseCsv(Buffer.from(await currentFileBytes(app, sourceId, leftTable.name, leftTable.sha256)), {
            rowMax: app.state.config.rowMax,
          });
          const joined = joinRows(parsedLeft, parsed, body.left_key, body.right_key);
          if (joined.duplicates > 0) {
            notices = [`${body.right_table} has ${joined.duplicates} duplicate keys. First line kept: ${joined.firstDup}.`];
          }
        }
      } catch {
        // storage unavailable: skip the notice computation
      }
    }
    await db.query("UPDATE sources SET notices = $2 WHERE id = $1", [sourceId, JSON.stringify(notices)]);
    return { relation, notices };
  });

  app.patch("/api/sources/:id/fields/:fieldId", async (req) => {
    const user = await requireUser(req);
    const sourceId = (req.params as { id: string }).id;
    const fieldId = (req.params as { fieldId: string }).fieldId;
    const source = await loadSource(app.state.db, sourceId);
    if (!source) throw new ApiError(404, "not_found");
    const role = await projectRoleOr404(app.state.db, user.id, await sourceProject(app, sourceId));
    requireRole(role, "creator");
    const body = req.body as { name?: string; hidden?: boolean; kind?: string };
    const f = source.fields.find((x) => x.id === fieldId);
    if (!f) throw new ApiError(404, "not_found");
    if (body.name !== undefined) {
      if (!body.name) throw new ApiError(422, "invalid_input", { name: "Name is required." });
      if (body.name !== f.name) {
        const clash = source.fields.some((x) => x.name === body.name && x.id !== fieldId);
        if (clash) throw new ApiError(422, "invalid_input", { name: `A field named ${body.name} already exists.` });
        await app.state.db.query("UPDATE fields SET name = $3 WHERE id = $1 AND source_id = $2", [fieldId, sourceId, body.name]);
      }
    }
    if (body.hidden !== undefined) {
      await app.state.db.query("UPDATE fields SET hidden = $3 WHERE id = $1 AND source_id = $2", [fieldId, sourceId, body.hidden]);
    }
    if (body.kind !== undefined && (body.kind === "dimension" || body.kind === "measure")) {
      await app.state.db.query("UPDATE fields SET kind = $3 WHERE id = $1 AND source_id = $2", [fieldId, sourceId, body.kind]);
    }
    const after = await app.state.db.query("SELECT * FROM fields WHERE id = $1", [fieldId]);
    return after.rows[0];
  });

  app.post("/api/sources/:id/bins", async (req, reply) => {
    const user = await requireUser(req);
    const sourceId = (req.params as { id: string }).id;
    const source = await loadSource(app.state.db, sourceId);
    if (!source) throw new ApiError(404, "not_found");
    const role = await projectRoleOr404(app.state.db, user.id, await sourceProject(app, sourceId));
    requireRole(role, "creator");
    const body = req.body as { field?: string; size?: number };
    const field = source.fields.find((f) => f.name === body.field);
    if (!field) throw new ApiError(404, "not_found");
    const size = body.size;
    if (typeof size !== "number" || !Number.isInteger(size) || size < 1) {
      throw new ApiError(422, "invalid_input", { size: "Bin size must be a whole number of at least 1." });
    }
    const name = `${field.name} (bin)`;
    const clash = source.fields.some((f) => f.name === name);
    if (clash) throw new ApiError(422, "invalid_input", { name: `A field named ${name} already exists.` });
    const id = newId();
    await app.state.db.query(
      "INSERT INTO fields (id, source_id, name, table_name, type, kind, continuous, hidden, origin) VALUES ($1, $2, $3, $4, 'number', 'dimension', false, false, $5)",
      [id, sourceId, name, field.table, JSON.stringify({ kind: "bin", field: field.name, size })],
    );
    const created = await app.state.db.query("SELECT * FROM fields WHERE id = $1", [id]);
    return reply.code(201).send(created.rows[0]);
  });

  app.post("/api/sources/:id/groups", async (req, reply) => {
    const user = await requireUser(req);
    const sourceId = (req.params as { id: string }).id;
    const source = await loadSource(app.state.db, sourceId);
    if (!source) throw new ApiError(404, "not_found");
    const role = await projectRoleOr404(app.state.db, user.id, await sourceProject(app, sourceId));
    requireRole(role, "creator");
    const body = req.body as { field?: string; groups?: { name: string; members: string[] }[] };
    const field = source.fields.find((f) => f.name === body.field);
    if (!field) throw new ApiError(404, "not_found");
    const name = `${field.name} (group)`;
    const clash = source.fields.some((f) => f.name === name);
    if (clash) throw new ApiError(422, "invalid_input", { name: `A field named ${name} already exists.` });
    const id = newId();
    await app.state.db.query(
      "INSERT INTO fields (id, source_id, name, table_name, type, kind, continuous, hidden, origin) VALUES ($1, $2, $3, $4, $5, 'dimension', false, false, $6)",
      [id, sourceId, name, field.table, field.type, JSON.stringify({ kind: "group", field: field.name, groups: body.groups ?? [] })],
    );
    const created = await app.state.db.query("SELECT * FROM fields WHERE id = $1", [id]);
    return reply.code(201).send(created.rows[0]);
  });

  app.put("/api/sources/:id/hierarchy", async (req) => {
    const user = await requireUser(req);
    const sourceId = (req.params as { id: string }).id;
    const source = await loadSource(app.state.db, sourceId);
    if (!source) throw new ApiError(404, "not_found");
    const role = await projectRoleOr404(app.state.db, user.id, await sourceProject(app, sourceId));
    requireRole(role, "creator");
    const body = req.body as { name?: string; fields?: string[] };
    await app.state.db.query("UPDATE sources SET hierarchy = $2 WHERE id = $1", [
      sourceId,
      JSON.stringify({ name: body.name ?? "", fields: body.fields ?? [] }),
    ]);
    return { ok: true };
  });

  app.put("/api/sources/:id/entitlements", async (req) => {
    const user = await requireUser(req);
    const sourceId = (req.params as { id: string }).id;
    const source = await loadSource(app.state.db, sourceId);
    if (!source) throw new ApiError(404, "not_found");
    const role = await projectRoleOr404(app.state.db, user.id, await sourceProject(app, sourceId));
    requireRole(role, "creator");
    const body = req.body as { field?: string | null; users?: Record<string, string[]> };
    await app.state.db.query("UPDATE sources SET entitlement_field = $2, entitlement_users = $3 WHERE id = $1", [
      sourceId,
      body.field ?? null,
      JSON.stringify(body.users ?? {}),
    ]);
    const after = await app.state.db.query("SELECT entitlement_field, entitlement_users FROM sources WHERE id = $1", [sourceId]);
    return { field: after.rows[0].entitlement_field, users: after.rows[0].entitlement_users };
  });

  app.put("/api/sources/:id/schedule", async (req) => {
    const user = await requireUser(req);
    const sourceId = (req.params as { id: string }).id;
    const source = await loadSource(app.state.db, sourceId);
    if (!source) throw new ApiError(404, "not_found");
    const role = await projectRoleOr404(app.state.db, user.id, await sourceProject(app, sourceId));
    const body = req.body as { every_minutes?: number; kind?: string; key?: string | null };
    if (role === "explorer") {
      const proj = await sourceProject(app, sourceId);
      const projRow = await app.state.db.query("SELECT explorers_schedule FROM projects WHERE id = $1", [proj]);
      if (!projRow.rows[0]?.explorers_schedule) throw new ApiError(403, "forbidden");
    } else {
      requireRole(role, "creator");
    }
    const minutes = body.every_minutes;
    if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
      throw new ApiError(422, "invalid_input", { every_minutes: "Every minutes must be a whole number from 1 to 10080." });
    }
    const kind = body.kind === "incremental" ? "incremental" : "full";
    if (kind === "incremental") {
      const keyField = body.key ? source.fields.find((f) => f.name === body.key) : null;
      if (!keyField || (keyField.type !== "number" && keyField.type !== "date")) {
        throw new ApiError(422, "invalid_input", { key: "Incremental refresh needs a number or date key." });
      }
    }
    const now = app.state.clockFixed !== null ? app.state.clockFixed + app.state.clockOffset : Date.now() + app.state.clockOffset;
    const next = new Date(now + minutes * 60000);
    await app.state.db.query(
      `INSERT INTO schedules (source_id, every_minutes, kind, key, last_run_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_id) DO UPDATE SET every_minutes = $2, kind = $3, key = $4, last_run_at = $5`,
      [sourceId, minutes, kind, kind === "incremental" ? (body.key ?? null) : null, next],
    );
    await app.state.db.query("UPDATE extracts SET next_run_at = $2 WHERE source_id = $1", [sourceId, next]);
    return { every_minutes: minutes, kind, key: kind === "incremental" ? (body.key ?? null) : null, next_run_at: next.toISOString() };
  });

  app.delete("/api/sources/:id/schedule", async (req, reply) => {
    const user = await requireUser(req);
    const sourceId = (req.params as { id: string }).id;
    const source = await loadSource(app.state.db, sourceId);
    if (!source) throw new ApiError(404, "not_found");
    const role = await projectRoleOr404(app.state.db, user.id, await sourceProject(app, sourceId));
    if (role === "explorer") {
      const proj = await sourceProject(app, sourceId);
      const projRow = await app.state.db.query("SELECT explorers_schedule FROM projects WHERE id = $1", [proj]);
      if (!projRow.rows[0]?.explorers_schedule) throw new ApiError(403, "forbidden");
    } else {
      requireRole(role, "creator");
    }
    await app.state.db.query("DELETE FROM schedules WHERE source_id = $1", [sourceId]);
    await app.state.db.query("UPDATE extracts SET next_run_at = NULL WHERE source_id = $1", [sourceId]);
    return reply.code(204).send();
  });

  app.post("/api/sources/:id/refresh", async (req) => {
    const user = await requireUser(req);
    const sourceId = (req.params as { id: string }).id;
    const source = await loadSource(app.state.db, sourceId);
    if (!source) throw new ApiError(404, "not_found");
    const role = await projectRoleOr404(app.state.db, user.id, await sourceProject(app, sourceId));
    if (role === "explorer") {
      const proj = await sourceProject(app, sourceId);
      const projRow = await app.state.db.query("SELECT explorers_schedule FROM projects WHERE id = $1", [proj]);
      if (!projRow.rows[0]?.explorers_schedule) throw new ApiError(403, "forbidden");
    } else {
      requireRole(role, "creator");
    }
    const { refreshSource } = await import("../scheduler.js");
    await refreshSource(app.state, sourceId);
    const { extractPayload } = await import("../main.js");
    return extractPayload(app.state.db, sourceId);
  });

  app.get("/api/sources/:id/extract", async (req) => {
    const user = await requireUser(req);
    const sourceId = (req.params as { id: string }).id;
    const source = await loadSource(app.state.db, sourceId);
    if (!source) throw new ApiError(404, "not_found");
    await projectRoleOr404(app.state.db, user.id, await sourceProject(app, sourceId));
    const { extractPayload } = await import("../main.js");
    return extractPayload(app.state.db, sourceId);
  });
}

async function sourceProject(app: FastifyInstance, sourceId: string): Promise<string> {
  const res = await app.state.db.query("SELECT project_id FROM sources WHERE id = $1", [sourceId]);
  const pid = res.rows[0]?.project_id;
  if (typeof pid !== "string" || pid === null) throw new ApiError(404, "not_found");
  return pid;
}
