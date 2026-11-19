import type { FastifyInstance, FastifyRequest } from "fastify";
import { ApiError, projectRoleOr404, requireRole, requireUser, type Role } from "../auth.js";
import { newId } from "../ids.js";
import { loadSource } from "../sample.js";
import { checkFormula } from "../formula/checker.js";
import { buildView, type SheetShape } from "../query/view.js";
import { dimValueFor } from "../query/evaluate.js";
import type { Filter, FieldDef } from "../query/core.js";
import type { Value } from "../formula/evaluator.js";
import { buildQueryContextForSheet } from "./workbook-query.js";

/** Access checks: a viewer or explorer asking for a draft gets not_found. */
async function workbookVisibleTo(req: FastifyRequest, workbookId: string): Promise<{ workbook: Record<string, unknown>; role: Role }> {
  const db = req.appState.db;
  const user = await requireUser(req);
  const res = await db.query("SELECT * FROM workbooks WHERE id = $1", [workbookId]);
  const wb = res.rows[0];
  if (!wb) throw new ApiError(404, "not_found");
  const role = await projectRoleOr404(db, user.id, wb.project_id);
  if ((role === "viewer" || role === "explorer") && wb.state === "draft") {
    throw new ApiError(404, "not_found");
  }
  return { workbook: wb, role };
}

async function workbookProject(req: FastifyRequest, workbookId: string): Promise<string> {
  const res = await req.appState.db.query("SELECT project_id FROM workbooks WHERE id = $1", [workbookId]);
  const pid = res.rows[0]?.project_id;
  if (typeof pid !== "string") throw new ApiError(404, "not_found");
  return pid;
}

export async function workbookPayload(req: FastifyRequest, workbookId: string): Promise<Record<string, unknown>> {
  const db = req.appState.db;
  const wb = (await db.query("SELECT * FROM workbooks WHERE id = $1", [workbookId])).rows[0];
  if (!wb) throw new ApiError(404, "not_found");
  const sheets = await db.query("SELECT id, name FROM sheets WHERE workbook_id = $1 AND owner_id IS NULL ORDER BY name", [workbookId]);
  const mySheets = await db.query(
    "SELECT id, name FROM sheets WHERE workbook_id = $1 AND owner_id = (SELECT id FROM users WHERE id = ANY($2)) ORDER BY name",
    [workbookId, []],
  );
  void mySheets;
  const dashboards = await db.query("SELECT id, name FROM dashboards WHERE workbook_id = $1 ORDER BY name", [workbookId]);
  const parameters = await db.query("SELECT id, name, type, value, values FROM parameters WHERE workbook_id = $1 ORDER BY name", [workbookId]);
  const sets = await db.query("SELECT id, name, field, members, top FROM sets WHERE workbook_id = $1 ORDER BY name", [workbookId]);
  return {
    id: wb.id,
    name: wb.name,
    project: wb.project_id,
    source: wb.source_id,
    state: wb.state,
    version: wb.version,
    certified_by: wb.certified_by,
    sheets: sheets.rows,
    dashboards: dashboards.rows,
    parameters: parameters.rows.map((p) => ({ id: p.id, name: p.name, type: p.type, value: p.value, values: p.values ?? [] })),
    sets: sets.rows.map((s) => ({ id: s.id, name: s.name, field: s.field, members: s.members, top: s.top })),
  };
}

function parseIfMatch(req: FastifyRequest): { version: number | null } {
  const header = req.headers["if-match"];
  if (typeof header !== "string") return { version: null };
  const parsed = Number(header.replace(/"/g, ""));
  return { version: Number.isFinite(parsed) ? parsed : null };
}

/** A sheet's saved shape plus its calculations. */
async function sheetContext(req: FastifyRequest, sheetId: string): Promise<{
  sheet: { id: string; workbook_id: string; name: string; owner_id: string | null; version: number; shape: SheetShape };
  workbook: Record<string, unknown>;
  role: Role;
}> {
  const db = req.appState.db;
  const res = await db.query("SELECT * FROM sheets WHERE id = $1", [sheetId]);
  const sheet = res.rows[0];
  if (!sheet) throw new ApiError(404, "not_found");
  const user = await requireUser(req);
  if (sheet.owner_id && sheet.owner_id !== user.id) throw new ApiError(404, "not_found");
  const wbId = sheet.workbook_id;
  const wbRes = await db.query("SELECT * FROM workbooks WHERE id = $1", [wbId]);
  const wb = wbRes.rows[0];
  if (!wb) throw new ApiError(404, "not_found");
  const role = await projectRoleOr404(db, user.id, wb.project_id);
  if ((role === "viewer" || role === "explorer") && wb.state === "draft") throw new ApiError(404, "not_found");
  return { sheet, workbook: wb, role };
}


export function registerWorkbookRoutes(app: FastifyInstance): void {
  app.get("/api/workbooks", async (req) => {
    const user = await requireUser(req);
    const db = req.appState.db;
    const res = await db.query(
      `SELECT w.id, w.name, w.project_id, w.state, w.certified_by FROM workbooks w
       JOIN projects p ON p.id = w.project_id
       JOIN members m ON m.project_id = p.id
       WHERE m.user_id = $1 AND (w.state = 'published' OR m.role = 'creator')
       ORDER BY w.name`,
      [user.id],
    );
    return res.rows.map((r) => ({ id: r.id, name: r.name, project: r.project_id, state: r.state, certified_by: r.certified_by }));
  });

  app.post("/api/projects/:id/workbooks", async (req, reply) => {
    const user = await requireUser(req);
    const projectId = (req.params as { id: string }).id;
    const role = await projectRoleOr404(req.appState.db, user.id, projectId);
    requireRole(role, "creator");
    const body = req.body as { name?: string; source?: string };
    if (!body.name) throw new ApiError(422, "invalid_input", { name: "Name is required." });
    const source = await loadSource(req.appState.db, body.source ?? "");
    if (!source) throw new ApiError(404, "not_found");
    const id = newId();
    await req.appState.db.query(
      "INSERT INTO workbooks (id, project_id, name, state, version, source_id) VALUES ($1, $2, $3, 'draft', 1, $4)",
      [id, projectId, body.name, body.source],
    );
    return reply.code(201).send({
      id,
      name: body.name,
      project: projectId,
      source: body.source,
      state: "draft",
      version: 1,
      certified_by: null,
      sheets: [],
      dashboards: [],
    });
  });

  app.get("/api/workbooks/:id", async (req) => {
    await workbookVisibleTo(req, (req.params as { id: string }).id);
    return workbookPayload(req, (req.params as { id: string }).id);
  });

  app.post("/api/workbooks/:id/publish", async (req) => {
    const user = await requireUser(req);
    const id = (req.params as { id: string }).id;
    const { workbook, role } = await workbookVisibleTo(req, id);
    requireRole(role, "creator");
    const body = req.body as { project?: string };
    const ifMatch = parseIfMatch(req);
    if (ifMatch.version === null || ifMatch.version !== workbook.version) {
      throw new ApiError(409, "stale_version");
    }
    const targetRole = await projectRoleOr404(req.appState.db, user.id, body.project ?? "");
    requireRole(targetRole, "creator");
    await req.appState.db.query(
      "UPDATE workbooks SET state = 'published', project = $2, certified_by = NULL, version = version + 1 WHERE id = $1",
      [id, body.project],
    );
    const after = (await req.appState.db.query("SELECT state, project, version, certified_by FROM workbooks WHERE id = $1", [id])).rows[0];
    return { state: after.state, project: after.project, version: after.version, certified_by: null };
  });

  app.post("/api/workbooks/:id/certify", async (req) => {
    const user = await requireUser(req);
    const id = (req.params as { id: string }).id;
    const { workbook, role } = await workbookVisibleTo(req, id);
    requireRole(role, "creator");
    if (workbook.state !== "published") throw new ApiError(409, "not_published");
    await req.appState.db.query("UPDATE workbooks SET certified_by = $2 WHERE id = $1", [id, user.username]);
    return { certified_by: user.username };
  });

  // Sheets
  app.post("/api/workbooks/:id/sheets", async (req, reply) => {
    const user = await requireUser(req);
    const id = (req.params as { id: string }).id;
    const { workbook, role } = await workbookVisibleTo(req, id);
    requireRole(role, "creator");
    const ifMatch = parseIfMatch(req);
    if (ifMatch.version === null || ifMatch.version !== workbook.version) {
      throw new ApiError(409, "stale_version", undefined, undefined);
    }
    const shape = req.body as SheetShape;
    const sheetId = newId();
    await req.appState.db.query(
      "INSERT INTO sheets (id, workbook_id, name, owner_id, copy_of, version, shape) VALUES ($1, $2, $3, NULL, NULL, 1, $4)",
      [sheetId, id, shape.name ?? "Sheet 1", JSON.stringify(shape)],
    );
    await req.appState.db.query("UPDATE workbooks SET version = version + 1 WHERE id = $1", [id]);
    return reply.code(201).send({ id: sheetId, version: workbook.version + 1, ...shape });
  });

  app.get("/api/sheets/:id", async (req) => {
    const sheetId = (req.params as { id: string }).id;
    const { sheet } = await sheetContext(req, sheetId);
    const calcs = await req.appState.db.query("SELECT id, name, formula FROM calculations WHERE sheet_id = $1 ORDER BY name", [sheetId]);
    return { ...sheet.shape, id: sheet.id, name: sheet.name, version: sheet.version, calculations: calcs.rows };
  });

  app.put("/api/sheets/:id", async (req) => {
    const user = await requireUser(req);
    const sheetId = (req.params as { id: string }).id;
    const { sheet, role } = await sheetContext(req, sheetId);
    const ifMatch = parseIfMatch(req);
    const expected = sheet.owner_id ? sheet.version : (await req.appState.db.query("SELECT version FROM workbooks WHERE id = $1", [sheet.workbook_id])).rows[0].version;
    if (ifMatch.version === null || ifMatch.version !== expected) {
      throw new ApiError(409, "stale_version");
    }
    if (sheet.owner_id) {
      if (sheet.owner_id !== user.id) throw new ApiError(404, "not_found");
    } else {
      requireRole(role, "creator");
    }
    const shape = req.body as SheetShape;
    await req.appState.db.query("UPDATE sheets SET shape = $2, name = $3 WHERE id = $1", [sheetId, JSON.stringify(shape), shape.name ?? sheet.name]);
    if (!sheet.owner_id) {
      await req.appState.db.query("UPDATE workbooks SET version = version + 1 WHERE id = $1", [sheet.workbook_id]);
    } else {
      await req.appState.db.query("UPDATE sheets SET version = version + 1 WHERE id = $1", [sheetId]);
    }
    return { ok: true };
  });

  app.post("/api/sheets/:id/copy", async (req, reply) => {
    const user = await requireUser(req);
    const sheetId = (req.params as { id: string }).id;
    const { sheet, role } = await sheetContext(req, sheetId);
    if (role === "viewer") throw new ApiError(403, "forbidden");
    const id = newId();
    await req.appState.db.query(
      "INSERT INTO sheets (id, workbook_id, name, owner_id, copy_of, version, shape) VALUES ($1, $2, $3, $4, $5, 1, $6)",
      [id, sheet.workbook_id, sheet.name, user.id, sheet.id, JSON.stringify(sheet.shape)],
    );
    const calcs = await req.appState.db.query("SELECT name, formula FROM calculations WHERE sheet_id = $1", [sheetId]);
    for (const c of calcs.rows) {
      await req.appState.db.query("INSERT INTO calculations (id, sheet_id, name, formula) VALUES ($1, $2, $3, $4)", [newId(), id, c.name, c.formula]);
    }
    return reply.code(201).send({ id, version: 1 });
  });

  app.post("/api/sheets/:id/query", async (req, reply) => {
    const user = await requireUser(req);
    const sheetId = (req.params as { id: string }).id;
    const { sheet, role } = await sheetContext(req, sheetId);
    if (role === "viewer" && sheet.owner_id && sheet.owner_id !== user.id) throw new ApiError(404, "not_found");
    const genRaw = (req.query as Record<string, string>).gen;
    const gen = Number(genRaw);
    const state = req.appState;
    const gate = state.queryLimiter.take(user.id, state.clockFixed !== null ? state.clockFixed + state.clockOffset : Date.now() + state.clockOffset);
    if (!gate.allowed) {
      throw new ApiError(429, "rate_limited", undefined, { "Retry-After": String(gate.retryAfter) });
    }
    const body = (req.body ?? { filters: [], parameters: {}, sets: {} }) as {
      filters?: Filter[];
      parameters?: Record<string, unknown>;
      sets?: Record<string, unknown>;
    };
    const ctx = await buildQueryContextForSheet(req.appState, { id: sheetId, workbook_id: sheet.workbook_id, owner_id: sheet.owner_id, name: sheet.name, version: sheet.version, shape: sheet.shape }, user.id, body.parameters ?? {}, body.sets ?? {});
    const deadline = Date.now() + state.config.queryBudgetMs;
    const view = buildView(sheet.shape, ctx, body.filters ?? [], { workMax: state.config.queryWorkMax, markMax: state.config.markMax }, deadline);
    if (view.refusal || view.notice) {
      const message = view.refusal ?? view.notice ?? "";
      return reply.code(422).send({ error: "view_refused", message });
    }
    const columns = [
      ...view.dims.map((d) => ({ name: d.field, role: "dimension" as const })),
      ...view.measures.map((m) => ({ name: m.caption, role: "measure" as const })),
    ];
    const rowsRaw = view.marks.map((m) => [
      ...m.dimValues.map((v, i) => (v === null ? null : v)),
      ...m.values.map((v, i) => (view.measures[i]?.share ? v : v)),
    ]);
    const total = view.total.map((t, i) => (view.measures[i]?.share ? t : t));
    return {
      gen,
      chart: view.chart,
      columns,
      rows: rowsRaw,
      total,
      reference_lines: view.refLines,
      trend: view.trend,
      notices: [],
    };
  });

  app.post("/api/sheets/:id/members", async (req) => {
    const user = await requireUser(req);
    const sheetId = (req.params as { id: string }).id;
    const { sheet } = await sheetContext(req, sheetId);
    const body = req.body as { field?: string; step?: string; filters?: Filter[]; parameters?: Record<string, unknown>; sets?: Record<string, unknown> };
    const ctx = await buildQueryContextForSheet(req.appState, { id: sheetId, workbook_id: sheet.workbook_id, owner_id: sheet.owner_id, name: sheet.name, version: sheet.version, shape: sheet.shape }, user.id, body.parameters ?? {}, body.sets ?? {});
    const field = ctx.fields.find((f) => f.name === body.field);
    if (!field) throw new ApiError(404, "not_found");
    // The member list comes from rows that pass every step before the filter's step.
    const order: string[] = ["source", "context", "dimension", "top", "measure", "table_calc"];
    const stepIndex = order.indexOf(body.step ?? "dimension");
    let rows = ctx.rows;
    const shapeFilters = sheet.shape.filters.filter((f) => order.indexOf(f.step) < stepIndex);
    const fieldByName = new Map(ctx.fields.map((f) => [f.name, f]));
    for (const f of shapeFilters) {
      if (f.step === "measure" || f.step === "table_calc") continue;
      const field2 = fieldByName.get(f.field);
      if (!field2) continue;
      const allowed = new Set((f.values ?? []).map((v) => (v === null ? "\u0000" : String(v))));
      rows = rows.filter((r) => {
        const v = dimValueFor(r, field2, null);
        return allowed.has(v === null ? "\u0000" : String(v));
      });
    }
    const members = new Map<string, Value>();
    for (const r of rows) {
      const v = dimValueFor(r, field, null);
      const key = v === null ? "\u0000" : String(v);
      if (!members.has(key)) members.set(key, v);
    }
    const sorted = [...members.values()].sort((a, b) => {
      const av = a ?? null;
      const bv = b ?? null;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
    });
    return { members: sorted.map((v) => (v === null ? null : v)) };
  });

  // Calculations
  app.post("/api/sheets/:id/calculations", async (req, reply) => {
    const user = await requireUser(req);
    const sheetId = (req.params as { id: string }).id;
    const { sheet, role } = await sheetContext(req, sheetId);
    if (sheet.owner_id) {
      if (sheet.owner_id !== user.id) throw new ApiError(404, "not_found");
    } else {
      requireRole(role, "creator");
    }
    const body = req.body as { name?: string; formula?: string };
    if (!body.name) throw new ApiError(422, "invalid_input", { name: "Name is required." });
    const existing = await req.appState.db.query("SELECT name FROM calculations WHERE sheet_id = $1", [sheetId]);
    const ctxFields = (await loadSource(req.appState.db, (await req.appState.db.query("SELECT source_id FROM workbooks WHERE id = $1", [sheet.workbook_id])).rows[0].source_id))?.fields ?? [];
    const wbParams = (await req.appState.db.query("SELECT name, type, value, values FROM parameters WHERE workbook_id = $1", [sheet.workbook_id])).rows;
    const wbSets = (await req.appState.db.query("SELECT name, field, members, top FROM sets WHERE workbook_id = $1", [sheet.workbook_id])).rows;
    const check = checkFormula(body.formula ?? "", {
      fields: ctxFields.filter((f) => !f.hidden),
      calcs: existing.rows.map((c) => ({ id: c.name, name: c.name, formula: "" })),
      parameters: wbParams.map((p) => ({ name: p.name, type: p.type, value: p.value, values: p.values ?? [] })),
      sets: wbSets.map((s) => ({ name: s.name, field: s.field, members: s.members ?? [], top: s.top })),
      formulaMaxDepth: req.appState.config.formulaMaxDepth,
    }, req.appState.config.formulaMaxChars);
    if (!check.valid) {
      throw new ApiError(422, "invalid_input", { formula: check.message ?? "Name is required." });
    }
    const id = newId();
    await req.appState.db.query("INSERT INTO calculations (id, sheet_id, name, formula) VALUES ($1, $2, $3, $4)", [id, sheetId, body.name, body.formula]);
    if (!sheet.owner_id) {
      await req.appState.db.query("UPDATE workbooks SET version = version + 1 WHERE id = $1", [sheet.workbook_id]);
    }
    return reply.code(201).send({ id, name: body.name, formula: body.formula });
  });

  app.put("/api/calculations/:id", async (req) => {
    const user = await requireUser(req);
    const id = (req.params as { id: string }).id;
    const res = await req.appState.db.query("SELECT * FROM calculations WHERE id = $1", [id]);
    const calc = res.rows[0];
    if (!calc) throw new ApiError(404, "not_found");
    const sheetRes = await req.appState.db.query("SELECT * FROM sheets WHERE id = $1", [calc.sheet_id]);
    const sheet = sheetRes.rows[0];
    if (!sheet) throw new ApiError(404, "not_found");
    if (sheet.owner_id && sheet.owner_id !== user.id) throw new ApiError(404, "not_found");
    if (!sheet.owner_id) {
      const role = await projectRoleOr404(req.appState.db, user.id, (await req.appState.db.query("SELECT project_id FROM workbooks WHERE id = $1", [sheet.workbook_id])).rows[0].project_id);
      requireRole(role, "creator");
    }
    const body = req.body as { name?: string; formula?: string };
    if (body.name !== undefined) {
      if (!body.name) throw new ApiError(422, "invalid_input", { name: "Name is required." });
      await req.appState.db.query("UPDATE calculations SET name = $2 WHERE id = $1", [id, body.name]);
    }
    if (body.formula !== undefined) {
      await req.appState.db.query("UPDATE calculations SET formula = $2 WHERE id = $1", [id, body.formula]);
    }
    const after = (await req.appState.db.query("SELECT * FROM calculations WHERE id = $1", [id])).rows[0];
    return { id: after.id, name: after.name, formula: after.formula };
  });

  // Formula check
  app.post("/api/formula/check", async (req) => {
    const user = await requireUser(req);
    const state = req.appState;
    const now = state.clockFixed !== null ? state.clockFixed + state.clockOffset : Date.now() + state.clockOffset;
    const gate = state.formulaLimiter.take(user.id, now);
    if (!gate.allowed) {
      throw new ApiError(429, "rate_limited", undefined, { "Retry-After": String(gate.retryAfter) });
    }
    const body = req.body as { sheet?: string; formula?: string };
    let fields: import("../query/core.js").FieldDef[] = [];
    let parameters: { name: string; type: "number" | "text" | "list"; value: string | number; values: string[] }[] = [];
    let sets: { name: string; field: string; members: string[]; top: { n: number | string; by: { field: string; agg: string } | null } | null }[] = [];
    if (body.sheet) {
      const ctx = await sheetContext(req, body.sheet);
      const sourceId = (await req.appState.db.query("SELECT source_id FROM workbooks WHERE id = $1", [ctx.sheet.workbook_id])).rows[0]?.source_id;
      const source = await loadSource(req.appState.db, sourceId);
      fields = source?.fields ?? [];
      const wbParams = (await req.appState.db.query("SELECT name, type, value, values FROM parameters WHERE workbook_id = $1", [ctx.sheet.workbook_id])).rows;
      parameters = wbParams.map((p) => ({ name: p.name, type: p.type, value: p.value, values: p.values ?? [] }));
      const wbSets = (await req.appState.db.query("SELECT name, field, members, top FROM sets WHERE workbook_id = $1", [ctx.sheet.workbook_id])).rows;
      sets = wbSets.map((s) => ({ name: s.name, field: s.field, members: s.members ?? [], top: s.top }));
    }
    const calcs = body.sheet
      ? (await req.appState.db.query("SELECT name, formula FROM calculations WHERE sheet_id = $1", [body.sheet])).rows
      : [];
    const check = checkFormula(body.formula ?? "", {
      fields: fields.filter((f) => !f.hidden),
      calcs: calcs.map((c) => ({ id: c.name, name: c.name, formula: c.formula })),
      parameters,
      sets,
      formulaMaxDepth: state.config.formulaMaxDepth,
    }, state.config.formulaMaxChars);
    if (!check.valid) {
      return { valid: false, message: check.message, line: check.line, column: check.column };
    }
    return { valid: true, type: check.type, aggregate: check.aggregate };
  });

  // Parameters and sets
  app.post("/api/workbooks/:id/parameters", async (req, reply) => {
    const user = await requireUser(req);
    const id = (req.params as { id: string }).id;
    const { workbook, role } = await workbookVisibleTo(req, id);
    requireRole(role, "creator");
    const body = req.body as { name?: string; type?: string; value?: unknown; values?: string[] };
    if (!body.name) throw new ApiError(422, "invalid_input", { name: "Name is required." });
    const paramId = newId();
    await req.appState.db.query(
      "INSERT INTO parameters (id, workbook_id, name, type, value, values) VALUES ($1, $2, $3, $4, $5, $6)",
      [paramId, id, body.name, body.type ?? "number", String(body.value ?? ""), JSON.stringify(body.values ?? [])],
    );
    await req.appState.db.query("UPDATE workbooks SET version = version + 1 WHERE id = $1", [id]);
    void workbook;
    return reply.code(201).send({ id: paramId, name: body.name, type: body.type ?? "number", value: body.value, values: body.values ?? [] });
  });

  app.put("/api/parameters/:id", async (req) => {
    const user = await requireUser(req);
    const id = (req.params as { id: string }).id;
    const res = await req.appState.db.query("SELECT * FROM parameters WHERE id = $1", [id]);
    const param = res.rows[0];
    if (!param) throw new ApiError(404, "not_found");
    const role = await projectRoleOr404(req.appState.db, user.id, (await req.appState.db.query("SELECT project_id FROM workbooks WHERE id = $1", [param.workbook_id])).rows[0].project_id);
    requireRole(role, "creator");
    const body = req.body as { name?: string; type?: string; value?: unknown; values?: string[] };
    if (body.name !== undefined) await req.appState.db.query("UPDATE parameters SET name = $2 WHERE id = $1", [id, body.name]);
    if (body.type !== undefined) await req.appState.db.query("UPDATE parameters SET type = $2 WHERE id = $1", [id, body.type]);
    if (body.value !== undefined) await req.appState.db.query("UPDATE parameters SET value = $2 WHERE id = $1", [id, String(body.value)]);
    if (body.values !== undefined) await req.appState.db.query("UPDATE parameters SET values = $2 WHERE id = $1", [id, JSON.stringify(body.values)]);
    await req.appState.db.query("UPDATE workbooks SET version = version + 1 WHERE id = $1", [param.workbook_id]);
    const after = (await req.appState.db.query("SELECT * FROM parameters WHERE id = $1", [id])).rows[0];
    return { id: after.id, name: after.name, type: after.type, value: after.value, values: after.values };
  });

  app.post("/api/workbooks/:id/sets", async (req, reply) => {
    const user = await requireUser(req);
    const id = (req.params as { id: string }).id;
    const { role } = await workbookVisibleTo(req, id);
    requireRole(role, "creator");
    const body = req.body as { name?: string; field?: string; members?: string[]; top?: { n: number | string; by: { field: string; agg: string } } };
    if (!body.name) throw new ApiError(422, "invalid_input", { name: "Name is required." });
    const setId = newId();
    await req.appState.db.query(
      "INSERT INTO sets (id, workbook_id, name, field, members, top) VALUES ($1, $2, $3, $4, $5, $6)",
      [setId, id, body.name, body.field ?? "", JSON.stringify(body.members ?? null), JSON.stringify(body.top ?? null)],
    );
    await req.appState.db.query("UPDATE workbooks SET version = version + 1 WHERE id = $1", [id]);
    return reply.code(201).send({ id: setId, name: body.name, field: body.field, members: body.members ?? null, top: body.top ?? null });
  });

  app.put("/api/sets/:id", async (req) => {
    const user = await requireUser(req);
    const id = (req.params as { id: string }).id;
    const res = await req.appState.db.query("SELECT * FROM sets WHERE id = $1", [id]);
    const set = res.rows[0];
    if (!set) throw new ApiError(404, "not_found");
    const role = await projectRoleOr404(req.appState.db, user.id, (await req.appState.db.query("SELECT project_id FROM workbooks WHERE id = $1", [set.workbook_id])).rows[0].project_id);
    requireRole(role, "creator");
    const body = req.body as { name?: string; field?: string; members?: string[]; top?: { n: number | string; by: { field: string; agg: string } } };
    if (body.name !== undefined) await req.appState.db.query("UPDATE sets SET name = $2 WHERE id = $1", [id, body.name]);
    if (body.field !== undefined) await req.appState.db.query("UPDATE sets SET field = $2 WHERE id = $1", [id, body.field]);
    if (body.members !== undefined) await req.appState.db.query("UPDATE sets SET members = $2 WHERE id = $1", [id, JSON.stringify(body.members)]);
    if (body.top !== undefined) await req.appState.db.query("UPDATE sets SET top = $2 WHERE id = $1", [id, JSON.stringify(body.top)]);
    await req.appState.db.query("UPDATE workbooks SET version = version + 1 WHERE id = $1", [set.workbook_id]);
    const after = (await req.appState.db.query("SELECT * FROM sets WHERE id = $1", [id])).rows[0];
    return { id: after.id, name: after.name, field: after.field, members: after.members, top: after.top };
  });

  // Alerts
  app.post("/api/sheets/:id/alerts", async (req, reply) => {
    const user = await requireUser(req);
    const sheetId = (req.params as { id: string }).id;
    await sheetContext(req, sheetId);
    const body = req.body as { name?: string; measure?: { field: string; agg?: string }; above?: number };
    if (!body.name) throw new ApiError(422, "invalid_input", { name: "Name is required." });
    if (typeof body.above !== "number" || !Number.isFinite(body.above)) {
      throw new ApiError(422, "invalid_input", { above: "Above must be a number." });
    }
    const id = newId();
    await req.appState.db.query(
      "INSERT INTO alerts (id, sheet_id, name, measure, above, armed, user_id) VALUES ($1, $2, $3, $4, $5, true, $6)",
      [id, sheetId, body.name, JSON.stringify(body.measure ?? { field: "Sales", agg: "SUM" }), body.above, user.id],
    );
    return reply.code(201).send({ id, name: body.name, above: body.above, armed: true });
  });

  // Dashboards
  app.post("/api/workbooks/:id/dashboards", async (req, reply) => {
    const user = await requireUser(req);
    const id = (req.params as { id: string }).id;
    const { role } = await workbookVisibleTo(req, id);
    requireRole(role, "creator");
    const body = req.body as {
      name?: string;
      layout?: unknown;
      floating?: unknown;
      phone_order?: string[];
      phone_heights?: Record<string, number>;
      actions?: unknown[];
    };
    if (!body.name) throw new ApiError(422, "invalid_input", { name: "Name is required." });
    const sheets = (await req.appState.db.query("SELECT id, name FROM sheets WHERE workbook_id = $1 AND owner_id IS NULL", [id])).rows;
    const sheetNames = sheets.map((s) => s.name);
    if (sheets.length < 2 || sheets.length > 4) {
      throw new ApiError(422, "invalid_input", { sheets: "A dashboard holds 2 to 4 sheets." });
    }
    const layout = body.layout as { type?: string; children?: unknown[] };
    if (!layout || !layout.children || !Array.isArray(layout.children)) {
      throw new ApiError(422, "invalid_input", { layout: "A dashboard holds 2 to 4 sheets." });
    }
    const dashId = newId();
    await req.appState.db.query(
      "INSERT INTO dashboards (id, workbook_id, name, version, layout, floating, phone_order, phone_heights, actions) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8)",
      [
        dashId,
        id,
        body.name,
        JSON.stringify(layout),
        JSON.stringify(body.floating ?? null),
        JSON.stringify(body.phone_order ?? sheets.map((s) => s.id)),
        JSON.stringify(body.phone_heights ?? {}),
        JSON.stringify(body.actions ?? []),
      ],
    );
    await req.appState.db.query("UPDATE workbooks SET version = version + 1 WHERE id = $1", [id]);
    void sheetNames;
    return reply.code(201).send(await dashboardPayload(req, dashId));
  });

  app.get("/api/dashboards/:id", async (req) => {
    const dashId = (req.params as { id: string }).id;
    const res = await req.appState.db.query("SELECT * FROM dashboards WHERE id = $1", [dashId]);
    const dash = res.rows[0];
    if (!dash) throw new ApiError(404, "not_found");
    await workbookVisibleTo(req, dash.workbook_id);
    return dashboardPayload(req, dashId);
  });

  app.put("/api/dashboards/:id", async (req) => {
    const user = await requireUser(req);
    const dashId = (req.params as { id: string }).id;
    const res = await req.appState.db.query("SELECT * FROM dashboards WHERE id = $1", [dashId]);
    const dash = res.rows[0];
    if (!dash) throw new ApiError(404, "not_found");
    const { role } = await workbookVisibleTo(req, dash.workbook_id);
    requireRole(role, "creator");
    const ifMatch = parseIfMatch(req);
    if (ifMatch.version === null || ifMatch.version !== dash.version) {
      throw new ApiError(409, "stale_version");
    }
    const body = req.body as Record<string, unknown>;
    for (const key of ["name", "layout", "floating", "phone_order", "phone_heights", "actions"]) {
      if (body[key] !== undefined) {
        const col = key === "name" ? "name" : key;
        await req.appState.db.query(`UPDATE dashboards SET ${col} = $2 WHERE id = $1`, [dashId, typeof body[key] === "string" ? body[key] : JSON.stringify(body[key])]);
      }
    }
    await req.appState.db.query("UPDATE dashboards SET version = version + 1 WHERE id = $1", [dashId]);
    await req.appState.db.query("UPDATE workbooks SET version = version + 1 WHERE id = $1", [dash.workbook_id]);
    return dashboardPayload(req, dashId);
  });
}

export async function dashboardPayload(req: FastifyRequest, dashboardId: string): Promise<Record<string, unknown>> {
  const db = req.appState.db;
  const res = await db.query("SELECT * FROM dashboards WHERE id = $1", [dashboardId]);
  const d = res.rows[0];
  if (!d) throw new ApiError(404, "not_found");
  const sheets = await db.query("SELECT id, name FROM sheets WHERE workbook_id = $1 AND owner_id IS NULL ORDER BY name", [d.workbook_id]);
  const objects = computeLayout(
    d.layout,
    sheets.rows.map((s) => ({ id: s.id, name: s.name })),
    (d.floating as { sheet: string; x: number; y: number; w: number; h: number }[] | null) ?? [],
  );
  return {
    id: d.id,
    name: d.name,
    workbook: d.workbook_id,
    layout: d.layout,
    floating: d.floating,
    phone_order: d.phone_order,
    phone_heights: d.phone_heights,
    actions: d.actions,
    objects,
  };
}

/** The container sizing rule, decided in exactly one place. */
export function computeLayout(
  layout: { type?: string; children?: { sheet?: string; fixed?: number | null; type?: string; children?: unknown[] }[] },
  sheets: { id: string; name: string }[],
  floating: { sheet: string; x: number; y: number; w: number; h: number }[],
): { sheet: string; name: string; x: number; y: number; w: number; h: number; floating: boolean }[] {
  const out: { sheet: string; name: string; x: number; y: number; w: number; h: number; floating: boolean }[] = [];
  const gap = 8;
  const children = layout?.children ?? [];
  const sizes: (number | null)[] = children.map((c) => (typeof c?.fixed === "number" ? c.fixed : null));
  const anyFixed = sizes.some((s) => s !== null);
  const flexCount = sizes.filter((s) => s === null).length;
  let totalFixed = 0;
  for (const s of sizes) totalFixed += s ?? 0;
  const totalLen = 1280;
  const inner = anyFixed ? totalLen - totalFixed - gap * (children.length - 1) : totalLen - gap * (children.length - 1);
  const flexEach = flexCount > 0 ? Math.floor(inner / flexCount) : 0;
  let leftover = flexCount > 0 ? inner - flexEach * flexCount : 0;
  let pos = 0;
  children.forEach((c, i) => {
    const sheet = sheets.find((s) => s.id === c?.sheet || s.name === c?.sheet);
    if (!sheet) return;
    let len = flexEach;
    if (typeof c?.fixed === "number") len = c.fixed;
    else if (leftover > 0) {
      len += 1;
      leftover -= 1;
    }
    out.push({ sheet: sheet.id, name: sheet.name, x: pos, y: 0, w: len, h: 800, floating: false });
    pos += len + gap;
  });
  for (const f of floating) {
    const sheet = sheets.find((s) => s.id === f.sheet || s.name === f.sheet);
    if (!sheet) continue;
    out.push({ sheet: sheet.id, name: sheet.name, x: f.x, y: f.y, w: f.w, h: f.h, floating: true });
  }
  return out;
}
