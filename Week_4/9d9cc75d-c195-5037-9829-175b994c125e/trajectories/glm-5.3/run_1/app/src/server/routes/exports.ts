import type { FastifyInstance, FastifyRequest } from "fastify";
import { ApiError, projectRoleOr404, requireUser } from "../auth.js";
import { newId } from "../ids.js";
import { StorageUnavailable } from "../storage.js";
import { buildView, type SheetShape } from "../query/view.js";
import { buildQueryContextForSheet, type SheetRecord } from "./workbook-query.js";
import { displayDate, displayNumber } from "../../shared/display.js";
import { dataValue } from "../../shared/display.js";
import { renderPdf } from "../exporters/pdf.js";
import { renderPng } from "../exporters/png.js";
import { renderCrosstab } from "../exporters/crosstab.js";
import { dashboardPayload } from "./workbooks.js";
import { loadSource } from "../sample.js";

interface ExportJob {
  id: string;
  kind: "pdf" | "png" | "csv";
  userId: string;
  status: "queued" | "rendering" | "ready" | "failed";
  progress: number;
  targetType: string;
  targetId: string;
  targetName: string;
  filters: unknown[];
  parameters: Record<string, unknown>;
  bytes: Buffer | null;
}

/** Jobs live in the database; their rendered bytes live in object storage. */
export async function jobPayload(state: import("../auth.js").AppState, job: { id: string; status: string; progress: number }): Promise<Record<string, unknown>> {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    download: job.status === "ready" ? `/api/exports/${job.id}/file` : null,
  };
}

export function registerExportRoutes(app: FastifyInstance): void {
  app.post("/api/exports", async (req, reply) => {
    const user = await requireUser(req);
    const state = req.appState;
    const body = req.body as {
      kind?: string;
      sheet?: string;
      dashboard?: string;
      filters?: unknown[];
      parameters?: Record<string, unknown>;
    };
    const kind = body.kind === "pdf" || body.kind === "png" || body.kind === "csv" ? body.kind : null;
    if (!kind) throw new ApiError(422, "invalid_input", { kind: "Name is required." });
    let targetType: string;
    let targetId: string;
    let targetName: string;
    if (body.sheet) {
      targetType = "sheet";
      targetId = body.sheet;
      const sheet = await loadSheet(req, targetId, user.id);
      targetName = sheet.name;
    } else if (body.dashboard) {
      targetType = "dashboard";
      targetId = body.dashboard;
      const dash = (await state.db.query("SELECT * FROM dashboards WHERE id = $1", [targetId])).rows[0];
      if (!dash) throw new ApiError(404, "not_found");
      const wbRole = await projectRoleOr404(state.db, user.id, (await state.db.query("SELECT project_id FROM workbooks WHERE id = $1", [dash.workbook_id])).rows[0].project_id);
      if (wbRole === "viewer" || wbRole === "explorer") {
        const wb = (await state.db.query("SELECT state FROM workbooks WHERE id = $1", [dash.workbook_id])).rows[0];
        if (wb.state !== "published") throw new ApiError(404, "not_found");
      }
      targetName = dash.name;
    } else {
      throw new ApiError(422, "invalid_input", { sheet: "Name is required." });
    }
    // An export replay returns its job before any state check.
    const existing = await state.db.query(
      `SELECT * FROM exports
       WHERE user_id = $1 AND kind = $2 AND target_type = $3 AND target_id = $4
         AND filters::text = $5 AND parameters::text = $6 AND status IN ('queued','rendering')`,
      [user.id, kind, targetType, targetId, JSON.stringify(body.filters ?? []), JSON.stringify(body.parameters ?? {})],
    );
    if (existing.rows.length > 0) {
      const job = existing.rows[0];
      return reply.code(200).send(await jobPayload(state, job));
    }
    const id = newId();
    await state.db.query(
      "INSERT INTO exports (id, user_id, kind, target_type, target_id, target_name, filters, parameters, status, progress) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', 0)",
      [id, user.id, kind, targetType, targetId, targetName, JSON.stringify(body.filters ?? []), JSON.stringify(body.parameters ?? {})],
    );
    // Move the job through the published states with the published pause.
    void advanceJob(state, id);
    return reply.code(202).send({ id, kind, status: "queued", progress: 0 });
  });

  app.get("/api/exports/:id", async (req) => {
    const user = await requireUser(req);
    const id = (req.params as { id: string }).id;
    const res = await req.appState.db.query("SELECT * FROM exports WHERE id = $1 AND user_id = $2", [id, user.id]);
    const job = res.rows[0];
    if (!job) throw new ApiError(404, "not_found");
    return jobPayload(req.appState, job);
  });

  app.get("/api/exports/:id/events", async (req, reply) => {
    const user = await requireUser(req);
    const id = (req.params as { id: string }).id;
    const res = await req.appState.db.query("SELECT id FROM exports WHERE id = $1 AND user_id = $2", [id, user.id]);
    if (res.rows.length === 0) throw new ApiError(404, "not_found");
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    let last = "";
    const push = (status: string, progress: number): void => {
      reply.raw.write(`event: state\ndata: ${JSON.stringify({ status, progress })}\n\n`);
    };
    for (;;) {
      const job = (await req.appState.db.query("SELECT * FROM exports WHERE id = $1", [id])).rows[0];
      if (!job) break;
      const key = `${job.status}:${job.progress}`;
      if (key !== last) {
        push(job.status, job.progress);
        last = key;
      }
      if (job.status === "ready" || job.status === "failed") {
        reply.raw.write(`event: end\ndata: ${JSON.stringify({ status: job.status })}\n\n`);
        break;
      }
      await new Promise((r) => setTimeout(r, Math.min(50, req.appState.config.exportStepMs)));
    }
    reply.raw.end();
  });

  app.post("/api/exports/:id/retry", async (req, reply) => {
    const user = await requireUser(req);
    const id = (req.params as { id: string }).id;
    const res = await req.appState.db.query("SELECT * FROM exports WHERE id = $1 AND user_id = $2", [id, user.id]);
    const job = res.rows[0];
    if (!job) throw new ApiError(404, "not_found");
    if (job.status !== "failed") throw new ApiError(409, "not_failed");
    await req.appState.db.query("UPDATE exports SET status = 'queued', progress = 0 WHERE id = $1", [id]);
    void advanceJob(req.appState, id);
    return reply.code(202).send({ id, kind: job.kind, status: "queued", progress: 0 });
  });

  app.get("/api/exports/:id/file", async (req, reply) => {
    const user = await requireUser(req);
    const id = (req.params as { id: string }).id;
    const res = await req.appState.db.query("SELECT * FROM exports WHERE id = $1 AND user_id = $2", [id, user.id]);
    const job = res.rows[0];
    if (!job) throw new ApiError(404, "not_found");
    if (job.status !== "ready") throw new ApiError(409, "not_ready");
    try {
      const bytes = await req.appState.storage.get(`exports/${id}.${job.kind === "csv" ? "csv" : job.kind}`);
      const type = job.kind === "pdf" ? "application/pdf" : job.kind === "png" ? "image/png" : "text/csv; charset=utf-8";
      reply.header("content-type", type);
      reply.header("content-disposition", `attachment; filename="${job.target_name}.${job.kind === "csv" ? "csv" : job.kind}"`);
      return reply.send(bytes);
    } catch (e) {
      if (e instanceof StorageUnavailable) throw new ApiError(503, "storage_unavailable");
      throw e;
    }
  });
}

async function loadSheet(req: FastifyRequest, sheetId: string, userId: string): Promise<SheetRecord> {
  const db = req.appState.db;
  const res = await db.query("SELECT * FROM sheets WHERE id = $1", [sheetId]);
  const sheet = res.rows[0];
  if (!sheet) throw new ApiError(404, "not_found");
  if (sheet.owner_id && sheet.owner_id !== userId) throw new ApiError(404, "not_found");
  const wb = (await db.query("SELECT * FROM workbooks WHERE id = $1", [sheet.workbook_id])).rows[0];
  if (!wb) throw new ApiError(404, "not_found");
  const role = await projectRoleOr404(db, userId, wb.project_id);
  if ((role === "viewer" || role === "explorer") && wb.state === "draft") throw new ApiError(404, "not_found");
  return {
    id: sheet.id,
    workbook_id: sheet.workbook_id,
    owner_id: sheet.owner_id,
    name: sheet.name,
    version: sheet.version,
    shape: sheet.shape as SheetShape,
  };
}

interface ExportTarget {
  sheets: { name: string; shape: SheetShape; sheet: SheetRecord }[];
  filters: unknown[];
  parameters: Record<string, unknown>;
}

async function exportTarget(state: import("../auth.js").AppState, job: { target_type: string; target_id: string; user_id: string; filters: unknown[]; parameters: Record<string, unknown> }): Promise<ExportTarget> {
  if (job.target_type === "sheet") {
    const sheetRes = await state.db.query("SELECT * FROM sheets WHERE id = $1", [job.target_id]);
    const sheet = sheetRes.rows[0];
    return {
      sheets: [{ name: sheet.name, shape: sheet.shape as SheetShape, sheet: { id: sheet.id, workbook_id: sheet.workbook_id, owner_id: sheet.owner_id, name: sheet.name, version: sheet.version, shape: sheet.shape as SheetShape } }],
      filters: job.filters,
      parameters: job.parameters,
    };
  }
  const dashRes = await state.db.query("SELECT * FROM dashboards WHERE id = $1", [job.target_id]);
  const dash = dashRes.rows[0];
  const payload = await computeDashboardSheets(state, dash, job.user_id);
  return { sheets: payload, filters: job.filters, parameters: job.parameters };
}

async function computeDashboardSheets(state: import("../auth.js").AppState, dash: Record<string, unknown>, userId: string): Promise<{ name: string; shape: SheetShape; sheet: SheetRecord }[]> {
  const reqStub = { appState: state } as unknown as FastifyRequest;
  const payload = await dashboardPayload(reqStub, dash.id as string);
  const objects = payload.objects as { sheet: string; name: string }[];
  const out: { name: string; shape: SheetShape; sheet: SheetRecord }[] = [];
  for (const obj of objects) {
    const sheetRes = await state.db.query("SELECT * FROM sheets WHERE id = $1", [obj.sheet]);
    const sheet = sheetRes.rows[0];
    if (!sheet) continue;
    out.push({
      name: sheet.name,
      shape: sheet.shape as SheetShape,
      sheet: { id: sheet.id, workbook_id: sheet.workbook_id, owner_id: sheet.owner_id, name: sheet.name, version: sheet.version, shape: sheet.shape as SheetShape },
    });
  }
  void userId;
  return out;
}

/**
 * The export state machine: queued -> rendering -> ready, or rendering ->
 * failed. Each step pauses LOZ_EXPORT_STEP_MS. A job becomes ready only
 * after object storage confirms the file's write.
 */
async function advanceJob(state: import("../auth.js").AppState, id: string): Promise<void> {
  await sleep(state.config.exportStepMs);
  const paused = (await state.db.query("SELECT value FROM grading_flags WHERE key = 'exports_paused'")).rows[0];
  if (paused?.value === true) return;
  await state.db.query("UPDATE exports SET status = 'rendering', progress = 50 WHERE id = $1 AND status = 'queued'", [id]);
  state.events.emitToUser((await state.db.query("SELECT user_id FROM exports WHERE id = $1", [id])).rows[0].user_id, "export", JSON.stringify({ id, status: "rendering", progress: 50 }));
  await sleep(state.config.exportStepMs);
  const job = (await state.db.query("SELECT * FROM exports WHERE id = $1", [id])).rows[0];
  if (!job || job.status !== "rendering") return;
  try {
    const target = await exportTarget(state, { ...job, filters: job.filters, parameters: job.parameters });
    const bytes = await renderExport(state, job, target);
    await state.storage.put(`exports/${id}.${job.kind === "csv" ? "csv" : job.kind}`, bytes);
    await state.db.query("UPDATE exports SET status = 'ready', progress = 100 WHERE id = $1", [id]);
    state.events.emitToUser(job.user_id, "export", JSON.stringify({ id, status: "ready", progress: 100 }));
  } catch (e) {
    if (e instanceof StorageUnavailable) {
      await state.db.query("UPDATE exports SET status = 'failed', progress = 0 WHERE id = $1", [id]);
      state.events.emitToUser(job.user_id, "export", JSON.stringify({ id, status: "failed", progress: 0 }));
      return;
    }
    await state.db.query("UPDATE exports SET status = 'failed', progress = 0 WHERE id = $1", [id]);
    state.events.emitToUser(job.user_id, "export", JSON.stringify({ id, status: "failed", progress: 0 }));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Resume every queued export job after the grading pause lifts. */
export async function resumeQueuedExports(state: import("../auth.js").AppState): Promise<void> {
  const queued = await state.db.query("SELECT id FROM exports WHERE status = 'queued'");
  for (const q of queued.rows) {
    void advanceJob(state, q.id);
  }
}

async function renderExport(
  state: import("../auth.js").AppState,
  job: { kind: string; user_id: string; target_name: string },
  target: ExportTarget,
): Promise<Buffer> {
  // Every export uses the requesting user's rows and the sent filters and
  // parameters, and never includes a hidden field.
  const views: { name: string; view: ReturnType<typeof buildView>; shape: SheetShape }[] = [];
  for (const s of target.sheets) {
    const ctx = await buildQueryContextForSheet(state, s.sheet, job.user_id, target.parameters, {});
    const view = buildView(s.shape, ctx, target.filters as never[], { workMax: state.config.queryWorkMax, markMax: state.config.markMax }, Date.now() + state.config.queryBudgetMs);
    views.push({ name: s.name, view, shape: s.shape });
  }
  const filtersText = formatFilters(target.filters as { field: string; step: string; values?: unknown[]; min?: number | null; max?: number | null; n?: number; by?: { field: string; agg: string } | null }[]);
  if (job.kind === "pdf") {
    return renderPdf(views.map((v) => ({ name: v.name, view: serializeView(v.view), shape: v.shape })), job.target_name, filtersText);
  }
  if (job.kind === "png") {
    return renderPng(views.map((v) => ({ name: v.name, view: serializeView(v.view), shape: v.shape })), job.target_name, filtersText);
  }
  return renderCrosstab(views.map((v) => ({ name: v.name, view: serializeView(v.view), shape: v.shape })), job.target_name);
}

export interface SerializedView {
  chart: string;
  dims: { field: string; type: string }[];
  measures: { caption: string; share: boolean }[];
  marks: { key: string; dimValues: unknown[]; values: (number | null)[] }[];
  total: (number | null)[];
  refLines: { type: string; value: number | null }[];
  trend: { slope: number; intercept: number } | null;
}

function serializeView(view: ReturnType<typeof buildView>): SerializedView {
  return {
    chart: view.chart,
    dims: view.dims,
    measures: view.measures.map((m) => ({ caption: m.caption, share: m.share })),
    marks: view.marks.map((m) => ({ key: m.key, dimValues: m.dimValues, values: m.values })),
    total: view.total,
    refLines: view.refLines,
    trend: view.trend,
  };
}

function formatFilters(filters: { field: string; step: string; values?: unknown[]; min?: number | null; max?: number | null; n?: number; by?: { field: string; agg: string } | null }[]): string[] {
  if (!filters || filters.length === 0) return ["Filters: none"];
  return filters.map((f) => {
    if (typeof f.n === "number" && f.by) {
      return `Filters: ${f.field} is top ${f.n} by ${f.by.agg === "SUM" ? f.by.field : `${f.by.agg} ${f.by.field}`}`;
    }
    if (f.min !== null && f.min !== undefined && f.max !== null && f.max !== undefined) {
      return `Filters: ${f.field} is ${f.min} to ${f.max}`;
    }
    if (f.min !== null && f.min !== undefined) {
      return `Filters: ${f.field} is at least ${f.min}`;
    }
    if (f.max !== null && f.max !== undefined) {
      return `Filters: ${f.field} is at most ${f.max}`;
    }
    const values = (f.values ?? []).map((v) => (v === null ? "(null)" : String(v))).join(", ");
    return `Filters: ${f.field} is ${values}`;
  });
}

export { displayDate, displayNumber, dataValue, loadSource, StorageUnavailable };
