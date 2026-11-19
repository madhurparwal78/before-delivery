import type { FastifyInstance } from "fastify";
import { newId } from "../ids.js";
import { hashPassword } from "../accounts.js";
import { Buffer } from "node:buffer";
import { parseCsv } from "../csv.js";
import { sha256Of, joinRows, loadSource, createSampleSource } from "../sample.js";
import { ORDERS_CSV, STOCKISTS_CSV, generatedCsv } from "../sample-data.js";
import { SESSION_COOKIE } from "../accounts.js";
import { runDueWork, serverNowMs } from "../scheduler.js";
import { refreshSource } from "../scheduler.js";
import { checkFormula } from "../formula/checker.js";
import type { SheetShape } from "../query/view.js";
import { StorageUnavailable } from "../storage.js";

/**
 * The grading routes exist only when LOZ_GRADING=1 and need no sign-in.
 */
export function registerGradingRoutes(app: FastifyInstance): void {
  app.post("/api/grading/seed", async (req, reply) => {
    const state = app.state;
    const db = state.db;
    const body = req.body as Record<string, unknown>;
    const users: Record<string, string> = {};
    const projects: Record<string, string> = {};
    const sources: Record<string, string> = {};
    const workbooks: Record<string, string> = {};
    const sheets: Record<string, string> = {};
    const dashboards: Record<string, string> = {};
    const parameters: Record<string, string> = {};
    const sets: Record<string, string> = {};
    const alerts: Record<string, string> = {};

    for (const u of (body.users as { username: string; password: string }[]) ?? []) {
      const username = u.username.toLowerCase();
      const existing = await db.query("SELECT id FROM users WHERE username = $1", [username]);
      if (existing.rows.length === 0) {
        const id = newId();
        await db.query("INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)", [id, username, hashPassword(u.password)]);
        users[username] = id;
      } else {
        users[username] = existing.rows[0].id;
      }
    }
    for (const p of (body.projects as { name: string; members?: Record<string, string>; explorers_schedule?: boolean }[]) ?? []) {
      const existing = await db.query("SELECT id FROM projects WHERE name = $1", [p.name]);
      let id: string;
      if (existing.rows.length === 0) {
        id = newId();
        await db.query("INSERT INTO projects (id, name, explorers_schedule) VALUES ($1, $2, $3)", [id, p.name, p.explorers_schedule ?? false]);
        projects[p.name] = id;
      } else {
        id = existing.rows[0].id;
        projects[p.name] = id;
      }
      for (const [username, role] of Object.entries(p.members ?? {})) {
        const userId = users[username] ?? (await db.query("SELECT id FROM users WHERE username = $1", [username])).rows[0]?.id;
        if (!userId) continue;
        await db.query(
          "INSERT INTO members (project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (project_id, user_id) DO UPDATE SET role = $3",
          [id, userId, role],
        );
      }
    }
    for (const s of (body.sources as { name: string; project: string; sample?: string; rows?: number; tables?: { name: string; csv: string }[]; relation?: { left_table: string; left_key: string; right_table: string; right_key: string } }[]) ?? []) {
      const projectId = projects[s.project] ?? null;
      const existing = await db.query("SELECT id FROM sources WHERE name = $1 AND project_id = $2", [s.name, projectId]);
      if (existing.rows.length > 0) {
        sources[s.name] = existing.rows[0].id;
        continue;
      }
      if (s.sample === "fernhollow") {
        sources[s.name] = await createSampleSource(db, projectId);
        continue;
      }
      const id = newId();
      sources[s.name] = id;
      await db.query("INSERT INTO sources (id, project_id, name, version, relation, notices) VALUES ($1, $2, $3, 1, $4, '[]'::jsonb)", [
        id,
        projectId,
        s.name,
        JSON.stringify(s.relation ?? null),
      ]);
      let csvs: { name: string; csv: string }[];
      if (typeof s.rows === "number") {
        csvs = [{ name: "data", csv: generatedCsv(s.rows) }];
      } else {
        csvs = s.tables ?? [];
      }
      for (const t of csvs) {
        const bytes = Buffer.from(t.csv, "utf8");
        await state.storage.put(`uploads/${id}/${t.name}/${sha256Of(bytes)}.csv`, bytes);
        const parsed = parseCsv(bytes, { rowMax: state.config.rowMax });
        await db.query("INSERT INTO tables (source_id, name, rows_count, sha256, columns) VALUES ($1, $2, $3, $4, $5)", [
          id,
          t.name,
          parsed.rowCount,
          sha256Of(bytes),
          JSON.stringify(parsed.columns),
        ]);
        for (const c of parsed.columns) {
          await db.query(
            "INSERT INTO fields (id, source_id, name, table_name, type, kind, continuous, hidden, origin) VALUES ($1, $2, $3, $4, $5, $6, $7, false, 'null'::jsonb)",
            [newId(), id, c.name, t.name, c.type, c.type === "number" ? "measure" : "dimension", c.type === "date"],
          );
        }
      }
      // Snapshot: join when a relation exists.
      const tablesRes = await db.query("SELECT * FROM tables WHERE source_id = $1 ORDER BY name", [id]);
      if (tablesRes.rows.length > 0) {
        const t0 = tablesRes.rows[0];
        const bytes0 = await state.storage.get(`uploads/${id}/${t0.name}/${t0.sha256}.csv`);
        const parsed0 = parseCsv(bytes0, { rowMax: state.config.rowMax });
        let rows: { values: Record<string, string | null> }[];
        if (tablesRes.rows.length === 1 || !s.relation) {
          rows = parsed0.records.map((r) => {
            const values: Record<string, string | null> = {};
            parsed0.columns.forEach((c, i) => {
              values[c.name] = r[i] ?? null;
            });
            return { values };
          });
        } else {
          const t1 = tablesRes.rows[1];
          const bytes1 = await state.storage.get(`uploads/${id}/${t1.name}/${t1.sha256}.csv`);
          const parsed1 = parseCsv(bytes1, { rowMax: state.config.rowMax });
          rows = joinRows(parsed0, parsed1, s.relation.left_key, s.relation.right_key).rows;
        }
        await db.query("INSERT INTO snapshots (source_id, version, rows) VALUES ($1, 1, $2)", [id, JSON.stringify(rows)]);
        await db.query("INSERT INTO extracts (source_id, state, stale, rows_count) VALUES ($1, 'live', false, $2)", [id, rows.length]);
      }
    }
    for (const e of (body.entitlements as { source: string; field: string; users: Record<string, string[]> }[]) ?? []) {
      const sid = sources[e.source];
      if (!sid) continue;
      await db.query("UPDATE sources SET entitlement_field = $2, entitlement_users = $3 WHERE id = $1", [sid, e.field, JSON.stringify(e.users)]);
    }
    for (const w of (body.workbooks as {
      name: string;
      project: string;
      source: string;
      state?: string;
      certified_by?: string | null;
      parameters?: { name: string; type: string; value: unknown; values?: string[] }[];
      sets?: { name: string; field: string; members?: string[]; top?: unknown }[];
      sheets?: (SheetShape & { calcs?: { name: string; formula: string }[] })[];
      dashboards?: { name: string; sheets: string[]; layout?: unknown; actions?: unknown[]; phone_order?: string[] }[];
    }[]) ?? []) {
      const projectId = projects[w.project];
      const sourceId = sources[w.source];
      if (!projectId || !sourceId) continue;
      const existing = await db.query("SELECT id FROM workbooks WHERE name = $1 AND project_id = $2", [w.name, projectId]);
      let id: string;
      if (existing.rows.length === 0) {
        id = newId();
        await db.query(
          "INSERT INTO workbooks (id, project_id, name, state, version, source_id, certified_by) VALUES ($1, $2, $3, $4, 1, $5, $6)",
          [id, projectId, w.name, w.state === "published" ? "published" : "draft", sourceId, w.certified_by ?? null],
        );
      } else {
        id = existing.rows[0].id;
      }
      workbooks[w.name] = id;
      for (const p of w.parameters ?? []) {
        const pid = newId();
        parameters[p.name] = pid;
        await db.query("INSERT INTO parameters (id, workbook_id, name, type, value, values) VALUES ($1, $2, $3, $4, $5, $6)", [
          pid,
          id,
          p.name,
          p.type,
          String(p.value ?? ""),
          JSON.stringify(p.values ?? []),
        ]);
      }
      for (const s of w.sets ?? []) {
        const sid = newId();
        sets[s.name] = sid;
        await db.query("INSERT INTO sets (id, workbook_id, name, field, members, top) VALUES ($1, $2, $3, $4, $5, $6)", [
          sid,
          id,
          s.name,
          s.field,
          JSON.stringify(s.members ?? null),
          JSON.stringify(s.top ?? null),
        ]);
      }
      const sheetIds: string[] = [];
      for (const s of w.sheets ?? []) {
        const sid = newId();
        sheets[`${w.name}/${s.name}`] = sid;
        sheetIds.push(sid);
        const exists = await db.query("SELECT id FROM sheets WHERE workbook_id = $1 AND name = $2 AND owner_id IS NULL", [id, s.name]);
        if (exists.rows.length > 0) {
          sheetIds[sheetIds.length - 1] = exists.rows[0].id;
          sheets[`${w.name}/${s.name}`] = exists.rows[0].id;
          continue;
        }
        await db.query(
          "INSERT INTO sheets (id, workbook_id, name, owner_id, copy_of, version, shape) VALUES ($1, $2, $3, NULL, NULL, 1, $4)",
          [sid, id, s.name, JSON.stringify({ ...s, name: s.name })],
        );
        for (const c of s.calcs ?? []) {
          await db.query("INSERT INTO calculations (id, sheet_id, name, formula) VALUES ($1, $2, $3, $4)", [newId(), sid, c.name, c.formula]);
        }
      }
      for (const d of w.dashboards ?? []) {
        const did = newId();
        dashboards[`${w.name}/${d.name}`] = did;
        const exists = await db.query("SELECT id FROM dashboards WHERE workbook_id = $1 AND name = $2", [id, d.name]);
        if (exists.rows.length > 0) {
          dashboards[`${w.name}/${d.name}`] = exists.rows[0].id;
          continue;
        }
        const namedSheetIds = d.sheets.map((n) => sheets[`${w.name}/${n}`]).filter((x) => x);
        await db.query(
          "INSERT INTO dashboards (id, workbook_id, name, version, layout, floating, phone_order, phone_heights, actions) VALUES ($1, $2, $3, 1, $4, NULL, $5, '{}', $6)",
          [
            did,
            id,
            d.name,
            JSON.stringify(d.layout ?? { type: "horizontal", children: namedSheetIds.map((x) => ({ sheet: x, fixed: null })) }),
            JSON.stringify(namedSheetIds),
            JSON.stringify(d.actions ?? []),
          ],
        );
      }
    }
    for (const s of (body.schedules as { source: string; every_minutes: number; kind?: string; key?: string }[]) ?? []) {
      const sid = sources[s.source];
      if (!sid) continue;
      const now = serverNowMs(state);
      const next = new Date(now + s.every_minutes * 60000);
      await db.query(
        `INSERT INTO schedules (source_id, every_minutes, kind, key, last_run_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_id) DO UPDATE SET every_minutes = $2, kind = $3, key = $4, last_run_at = $5`,
        [sid, s.every_minutes, s.kind === "incremental" ? "incremental" : "full", s.key ?? null, next],
      );
      await db.query("UPDATE extracts SET next_run_at = $2 WHERE source_id = $1", [sid, next]);
    }
    for (const a of (body.alerts as { username: string; workbook: string; sheet: string; name: string; measure: { field: string; agg?: string }; above: number }[]) ?? []) {
      const userId = users[a.username] ?? (await db.query("SELECT id FROM users WHERE username = $1", [a.username])).rows[0]?.id;
      const sheetId = sheets[`${a.workbook}/${a.sheet}`];
      if (!userId || !sheetId) continue;
      const id = newId();
      alerts[a.name] = id;
      await db.query(
        "INSERT INTO alerts (id, sheet_id, name, measure, above, armed, user_id) VALUES ($1, $2, $3, $4, $5, true, $6)",
        [id, sheetId, a.name, JSON.stringify(a.measure), a.above, userId],
      );
    }
    for (const e of (body.extracts as { source: string; state?: string; last_success_at?: string; last_failure_at?: string }[]) ?? []) {
      const sid = sources[e.source];
      if (!sid) continue;
      await db.query(
        "INSERT INTO extracts (source_id, state, stale, rows_count, last_success_at, last_failure_at) VALUES ($1, $2, false, 0, $3, $4) ON CONFLICT (source_id) DO UPDATE SET state = $2, last_success_at = $3, last_failure_at = $4",
        [sid, e.state === "refresh_failed" ? "refresh_failed" : "live", e.last_success_at ?? null, e.last_failure_at ?? null],
      );
    }
    return reply.code(201).send({
      users,
      projects,
      sources,
      workbooks,
      sheets,
      dashboards,
      parameters,
      sets,
      alerts,
    });
  });

  app.post("/api/grading/session", async (req, reply) => {
    const body = req.body as { username?: string };
    const username = (body.username ?? "").toLowerCase();
    const res = await app.state.db.query("SELECT id FROM users WHERE username = $1", [username]);
    const user = res.rows[0];
    if (!user) return reply.code(404).send({ error: "not_found" });
    const token = newId() + newId();
    await app.state.db.query("INSERT INTO sessions (token, user_id) VALUES ($1, $2)", [token, user.id]);
    reply.header("set-cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`);
    return reply.send({ ok: true });
  });

  app.post("/api/grading/clock", async (req) => {
    const state = app.state;
    const body = req.body as { set?: string; advance_ms?: number };
    if (typeof body.set === "string") {
      state.clockFixed = Date.parse(body.set);
      state.clockOffset = 0;
    } else if (typeof body.advance_ms === "number") {
      if (state.clockFixed === null) state.clockFixed = Date.now();
      state.clockOffset += body.advance_ms;
    }
    await runDueWork(state);
    // Due refreshes and alert checks run before the answer, then a clock event.
    state.events.emitToUsers(new Set(), "clock", JSON.stringify({ server_now: new Date(serverNowMs(state)).toISOString() }));
    await broadcastClock(state);
    return { now: new Date(serverNowMs(state)).toISOString() };
  });

  app.post("/api/grading/storage", async (req) => {
    const body = req.body as { down?: boolean };
    app.state.storage.gradingDown = body.down === true;
    return { down: app.state.storage.gradingDown };
  });

  app.post("/api/grading/source-file", async (req) => {
    const body = req.body as { source?: string; table?: string; csv?: string };
    const state = app.state;
    const sourceId = body.source;
    const table = body.table;
    const bytes = Buffer.from(body.csv ?? "", "utf8");
    const sha = sha256Of(bytes);
    await state.storage.put(`uploads/${sourceId}/${table}/${sha}.csv`, bytes);
    const parsed = parseCsv(bytes, { rowMax: state.config.rowMax });
    await state.db.query("UPDATE tables SET rows_count = $3, sha256 = $4, columns = $5 WHERE source_id = $1 AND name = $2", [
      sourceId,
      table,
      parsed.rowCount,
      sha,
      JSON.stringify(parsed.columns),
    ]);
    await state.db.query("UPDATE sources SET version = version + 1 WHERE id = $1", [sourceId]);
    return { ok: true };
  });

  app.post("/api/grading/refresh-failure", async (req) => {
    const body = req.body as { source?: string; times?: number };
    await app.state.db.query(
      `INSERT INTO refresh_failures (source_id, times) VALUES ($1, $2)
       ON CONFLICT (source_id) DO UPDATE SET times = $2`,
      [body.source, body.times ?? 1],
    );
    return { ok: true };
  });

  app.post("/api/grading/exports", async (req) => {
    const body = req.body as { paused?: boolean };
    await app.state.db.query(
      `INSERT INTO grading_flags (key, value) VALUES ('exports_paused', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [body.paused === true],
    );
    if (body.paused !== true) {
      // Resume any queued jobs.
      const { resumeQueuedExports } = await import("./exports.js");
      void resumeQueuedExports(app.state);
    }
    return { paused: body.paused === true };
  });
}

async function broadcastClock(state: import("../auth.js").AppState): Promise<void> {
  const members = await state.db.query("SELECT DISTINCT user_id FROM members");
  const userIds = new Set<string>(members.rows.map((r) => r.user_id as string));
  state.events.emitToUsers(userIds, "clock", JSON.stringify({ server_now: new Date(serverNowMs(state)).toISOString() }));
}
