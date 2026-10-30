// Workbooks: list and search, create, import, read, rename and cutoff, season actions, sync.
import { randomUUID } from "node:crypto";
import { type WorkbookContent } from "../../shared/engine.js";
import { LIMITS } from "../../shared/limits.js";
import { localDateTimeText, parseLocalDateTime, resolveLocal } from "../../shared/time.js";
import { type Member } from "../auth.js";
import { type Tx, tx } from "../db.js";
import { ApiError, invalid } from "../errors.js";
import { readImport } from "../files/importFile.js";
import { type Reply, type Request, jsonBody, member } from "../http.js";
import { canonicalJson, fingerprint, once, replay, requestKey } from "../idempotency.js";
import { queueSeasonClosed } from "../mail.js";
import { requireRole } from "../rules/roles.js";
import { SEASON_ACTIONS, SEASON_LABEL, type SeasonAction, settingsBlock, transition } from "../rules/season.js";
import { type Services } from "../services/index.js";
import { applyBatch, parseBatch } from "../sync.js";
import { StoredObjects } from "../versions.js";
import { type WorkbookRow, chartsOut, derive, sheetsOut, stationClock, stationWorkbook, summary } from "../workbook.js";

const NAME_MESSAGE = "Give the workbook a name of 1 to 80 characters.";

function workbookName(value: unknown): string | null {
  return typeof value === "string" && value.length >= 1 && value.length <= 80 ? value : null;
}

/** A cutoff is a station wall-clock time in the future; a skipped time is refused. */
function parseCutoff(value: unknown, zone: string, now: Date): { local: string; utc: Date } {
  const local = typeof value === "string" ? parseLocalDateTime(value) : null;
  if (!local) throw invalid({ closesAt: "Enter a local date and time." });
  const resolved = resolveLocal(local, zone);
  if (resolved.kind === "skipped") throw invalid({ closesAt: `That time is skipped by a clock change in ${zone}.` });
  if (resolved.ms <= now.getTime()) throw invalid({ closesAt: `Pick a time after now in ${zone}.` });
  return { local: localDateTimeText(local), utc: new Date(resolved.ms) };
}

async function insertWorkbook(t: Tx, me: Member, name: string, content: WorkbookContent, originalKey: string | null, id: string): Promise<WorkbookRow> {
  const r = await t.query<WorkbookRow>(
    `INSERT INTO workbooks (id, station_id, name, state, genesis, head_seq, sheet_count, original_key)
     VALUES ($1, $2, $3, 'draft', $4, 0, $5, $6) RETURNING *`,
    [id, me.stationId, name, JSON.stringify(content), content.sheets.length, originalKey],
  );
  return r.rows[0];
}

function fileStem(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

async function importWorkbook(svc: Services, req: Request, me: Member): Promise<Reply> {
  requireRole(me.role, "createWorkbook");
  const key = requestKey(req);
  const file = req.parts?.find((p) => p.name === "file" && p.filename !== null);
  const nameField = req.parts?.find((p) => p.name === "name" && p.filename === null)?.data.toString("utf8");
  const name = nameField ?? (file ? fileStem(file.filename as string) : "");
  const scope = `${me.id}:import`;
  const fp = fingerprint(file?.data ?? "", name, file?.filename ?? "");
  const prior = await replay(svc.db, scope, key, fp);
  if (prior) return prior;
  if (!file) throw invalid({ file: "Choose a .xlsx or .csv workbook file." });
  if (workbookName(name) === null) throw invalid({ name: NAME_MESSAGE });
  const imported = readImport(file.data, fileStem(file.filename as string));
  const id = randomUUID();
  const originalKey = `stations/${me.stationId}/imports/${id}/original.${imported.kind}`;
  const objects = new StoredObjects(svc.storage);
  await objects.put(originalKey, file.data, imported.kind === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv");
  try {
    const reply = await once(svc.db, scope, key, fp, async (t) => {
      const row = await insertWorkbook(t, me, name, imported.content, originalKey, id);
      return {
        status: 201,
        body: { workbook: summary(row), sheets: imported.content.sheets.map((s) => ({ id: s.id, name: s.name })), originalKey },
      };
    });
    // Undo: a concurrent request with this key won, so this request's stored original is not needed.
    if (!reply.fresh) await objects.undo();
    return reply;
  } catch (error) {
    // Undo: the workbook was not recorded, so the stored original is removed before answering.
    await objects.undo();
    throw error;
  }
}

export function workbookRoutes(svc: Services): void {
  member("GET", "/api/workbooks", async ({ req, member: me }) => {
    const q = req.query.get("q") ?? "";
    if (q.length > LIMITS.maxSearchChars) throw invalid({ q: "Search text can be at most 100 characters." });
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const r = await svc.db.query<WorkbookRow>(
      "SELECT * FROM workbooks WHERE station_id = $1 AND name ILIKE $2 ORDER BY updated_at DESC, name",
      [me.stationId, pattern],
    );
    return { status: 200, json: { workbooks: r.rows.map(summary) } };
  });

  member("POST", "/api/workbooks", async ({ req, member: me }) => {
    requireRole(me.role, "createWorkbook");
    const key = requestKey(req);
    const body = jsonBody(req);
    const scope = `${me.id}:create`;
    const fp = fingerprint(canonicalJson(body));
    const prior = await replay(svc.db, scope, key, fp);
    if (prior) return prior;
    const name = workbookName(body.name);
    if (name === null) throw invalid({ name: NAME_MESSAGE });
    return once(svc.db, scope, key, fp, async (t) => {
      const content: WorkbookContent = { sheets: [{ id: randomUUID(), name: "Plots", cells: {} }], charts: [] };
      const row = await insertWorkbook(t, me, name, content, null, randomUUID());
      return { status: 201, body: { workbook: summary(row) } };
    });
  });

  member("POST", "/api/workbooks/import", ({ req, member: me }) => importWorkbook(svc, req, me), { upload: true });

  member("GET", "/api/workbooks/:id", async ({ req, member: me }) => {
    const row = await stationWorkbook(svc.db, me.stationId, req.params.id);
    const derived = await derive(svc.db, row, stationClock(me.timeZone));
    const engine = derived.engine;
    return {
      status: 200,
      json: {
        workbook: {
          ...summary(row),
          timeZone: me.timeZone,
          headSeq: row.head_seq,
          myRole: me.role,
          sheets: sheetsOut(engine, true),
          charts: chartsOut(engine).map(({ sheetName: _s, ...chart }) => chart),
        },
      },
    };
  });

  member("PATCH", "/api/workbooks/:id", async ({ req, member: me }) => {
    await stationWorkbook(svc.db, me.stationId, req.params.id);
    requireRole(me.role, "manageSeason");
    const body = jsonBody(req);
    return tx(svc.db, async (t) => {
      const row = await stationWorkbook(t, me.stationId, req.params.id, true);
      const blocked = settingsBlock(row.state);
      if (blocked) throw new ApiError(409, blocked, `That isn't allowed while the workbook is ${SEASON_LABEL[row.state]}.`);
      const name = "name" in body ? workbookName(body.name) : row.name;
      if (name === null) throw invalid({ name: NAME_MESSAGE });
      let cutoff = { local: row.closes_at_local, utc: row.closes_at_utc };
      if ("closesAt" in body) cutoff = body.closesAt === null ? { local: null, utc: null } : parseCutoff(body.closesAt, me.timeZone, new Date());
      const r = await t.query<WorkbookRow>(
        "UPDATE workbooks SET name = $2, closes_at_local = $3, closes_at_utc = $4, updated_at = clock_timestamp() WHERE id = $1 RETURNING *",
        [row.id, name, cutoff.local, cutoff.utc],
      );
      return { status: 200, json: { workbook: summary(r.rows[0]) } };
    });
  });

  member("POST", "/api/workbooks/:id/season", async ({ req, member: me }) => {
    await stationWorkbook(svc.db, me.stationId, req.params.id);
    requireRole(me.role, "manageSeason");
    const body = jsonBody(req);
    const action = body.action;
    if (!SEASON_ACTIONS.includes(action as SeasonAction)) throw invalid({ action: "Pick start, close, reopen or archive." });
    if (action === "archive") requireRole(me.role, "archive");
    const reply = await tx(svc.db, async (t) => {
      const row = await stationWorkbook(t, me.stationId, req.params.id, true);
      const next = transition(row.state, action as SeasonAction);
      if (!next) throw new ApiError(409, "illegal_transition", `Cannot ${action as string} a workbook that is ${SEASON_LABEL[row.state]}.`);
      let cutoff = { local: row.closes_at_local, utc: row.closes_at_utc };
      if (action === "reopen") {
        cutoff = body.closesAt === undefined || body.closesAt === null ? { local: null, utc: null } : parseCutoff(body.closesAt, me.timeZone, new Date());
      }
      const r = await t.query<WorkbookRow>(
        "UPDATE workbooks SET state = $2, closes_at_local = $3, closes_at_utc = $4, updated_at = clock_timestamp() WHERE id = $1 RETURNING *",
        [row.id, next, cutoff.local, cutoff.utc],
      );
      if (next === "locked") await queueSeasonClosed(t, { stationId: me.stationId, workbookName: row.name, at: new Date(), zone: me.timeZone });
      return { status: 200, json: { workbook: summary(r.rows[0]) } };
    });
    svc.workers.kickMail();
    return reply;
  });

  member("POST", "/api/workbooks/:id/sync", async ({ req, member: me }) => {
    const current = await stationWorkbook(svc.db, me.stationId, req.params.id);
    const key = requestKey(req);
    const body = jsonBody(req);
    const scope = `${me.id}:sync:${current.id}`;
    const fp = fingerprint(canonicalJson(body));
    const prior = await replay(svc.db, scope, key, fp);
    if (prior) return prior;
    const batch = parseBatch(body, current.head_seq);
    return once(svc.db, scope, key, fp, async (t) => {
      const row = await stationWorkbook(t, me.stationId, current.id, true);
      const derived = await derive(t, row, stationClock(me.timeZone));
      return { status: 200, body: await applyBatch(t, row, me, derived, batch, key) };
    });
  });
}

