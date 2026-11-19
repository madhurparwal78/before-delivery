import type { AppState } from "./auth.js";
import { Buffer } from "node:buffer";
import { parseCsv } from "./csv.js";
import { loadSource, sha256Of, type JoinedRow } from "./sample.js";
import { newId } from "./ids.js";
import { buildView, type SheetShape } from "./query/view.js";
import { buildQueryContextForSheet } from "./routes/workbook-query.js";

/** The extract state machine: live -> refreshing -> live, or refreshing -> refresh_failed. */
export async function refreshSource(state: AppState, sourceId: string): Promise<{ ok: boolean }> {
  const db = state.db;
  const source = await loadSource(db, sourceId);
  if (!source) return { ok: false };
  const extractRes = await db.query("SELECT * FROM extracts WHERE source_id = $1", [sourceId]);
  if (extractRes.rows[0]?.state === "refreshing") {
    // A refresh asked for while one runs waits for it and does not start a second.
    for (let i = 0; i < 300; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const again = await db.query("SELECT state FROM extracts WHERE source_id = $1", [sourceId]);
      if (again.rows[0]?.state !== "refreshing") break;
    }
    return { ok: true };
  }
  await db.query("UPDATE extracts SET state = 'refreshing' WHERE source_id = $1", [sourceId]);
  await broadcast(state, sourceId);
  const ok = await runRefresh(state, sourceId);
  await broadcast(state, sourceId);
  if (ok) {
    await checkAlerts(state, sourceId);
  }
  return { ok };
}

async function runRefresh(state: AppState, sourceId: string): Promise<boolean> {
  const db = state.db;
  const source = await loadSource(db, sourceId);
  if (!source) return false;
  const tables = await db.query("SELECT * FROM tables WHERE source_id = $1 ORDER BY name", [sourceId]);
  if (tables.rows.length === 0) return false;
  const now = Date.now();
  try {
    // A full refresh replaces the snapshot with the table's current file. An
    // incremental refresh appends rows whose key is above the snapshot's max.
    const schedule = (await db.query("SELECT * FROM schedules WHERE source_id = $1", [sourceId])).rows[0];
    const kind = schedule?.kind === "incremental" ? "incremental" : "full";
    const first = tables.rows[0];
    const firstBytes = await state.storage.get(`uploads/${sourceId}/${first.name}/${first.sha256}.csv`);
    const parsedFirst = parseCsv(firstBytes, { rowMax: state.config.rowMax });
    let newRows: JoinedRow[];
    if (tables.rows.length === 1 || !source.relation) {
      newRows = parsedFirst.records.map((r) => {
        const values: Record<string, string | null> = {};
        parsedFirst.columns.forEach((c, i) => {
          values[c.name] = r[i] ?? null;
        });
        return { values };
      });
    } else {
      const second = tables.rows[1];
      const secondBytes = await state.storage.get(`uploads/${sourceId}/${second.name}/${second.sha256}.csv`);
      const parsedSecond = parseCsv(secondBytes, { rowMax: state.config.rowMax });
      const { joinRows } = await import("./sample.js");
      newRows = joinRows(parsedFirst, parsedSecond, source.relation.left_key, source.relation.right_key).rows;
    }
    let rows = newRows;
    if (kind === "incremental" && schedule?.key) {
      const keyField = source.fields.find((f) => f.name === schedule.key);
      if (keyField) {
        const existing = source.rows as JoinedRow[];
        let maxKey: number | null = null;
        for (const r of existing) {
          const raw = r.values[schedule.key];
          if (raw === null || raw === undefined) continue;
          const v = keyField.type === "number" ? Number(raw) : Date.parse(raw);
          if (Number.isFinite(v) && (maxKey === null || v > maxKey)) maxKey = v;
        }
        const appended = maxKey === null ? newRows : newRows.filter((r) => {
          const raw = r.values[schedule.key];
          if (raw === null || raw === undefined) return false;
          const v = keyField.type === "number" ? Number(raw) : Date.parse(raw);
          return Number.isFinite(v) && v > maxKey;
        });
        rows = [...existing, ...appended];
      }
    }
    // A grading-forced failure keeps the last good snapshot.
    const forcedFail = (await db.query("SELECT times FROM refresh_failures WHERE source_id = $1", [sourceId])).rows[0];
    if (forcedFail && forcedFail.times > 0) {
      if (forcedFail.times > 1) {
        await db.query("UPDATE refresh_failures SET times = times - 1 WHERE source_id = $1", [sourceId]);
      } else {
        await db.query("DELETE FROM refresh_failures WHERE source_id = $1", [sourceId]);
      }
      throw new Error("forced refresh failure");
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const versionRes = await client.query("SELECT version FROM sources WHERE id = $1", [sourceId]);
      await client.query("DELETE FROM snapshots WHERE source_id = $1", [sourceId]);
      await client.query("INSERT INTO snapshots (source_id, version, rows) VALUES ($1, $2, $3)", [
        sourceId,
        versionRes.rows[0].version,
        JSON.stringify(rows),
      ]);
      await client.query(
        "UPDATE extracts SET state = 'live', stale = false, rows_count = $2, last_success_at = $3, last_failure_at = NULL WHERE source_id = $1",
        [sourceId, rows.length, new Date(now)],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    await db.query("UPDATE sources SET version = version + 1 WHERE id = $1", [sourceId]);
    return true;
  } catch {
    const lastGood = await db.query("SELECT last_success_at FROM extracts WHERE source_id = $1", [sourceId]);
    await db.query(
      "UPDATE extracts SET state = 'refresh_failed', stale = false, last_failure_at = $2 WHERE source_id = $1",
      [sourceId, new Date(now)],
    );
    void lastGood;
    return false;
  }
}

/** After each successful refresh, armed alerts above their threshold create one inbox item and disarm. */
async function checkAlerts(state: AppState, sourceId: string): Promise<void> {
  const db = state.db;
  const alerts = await db.query(
    `SELECT a.* FROM alerts a JOIN sheets s ON s.id = a.sheet_id JOIN workbooks w ON w.id = s.workbook_id WHERE w.source_id = $1`,
    [sourceId],
  );
  for (const alert of alerts.rows) {
    const measure = alert.measure as { field: string; agg?: string };
    const sheetRes = await db.query("SELECT * FROM sheets WHERE id = $1", [alert.sheet_id]);
    const sheet = sheetRes.rows[0];
    if (!sheet) continue;
    const shape = sheet.shape as SheetShape;
    const ctx = await buildQueryContextForSheet(state, sheet, alert.user_id);
    const view = buildView(
      {
        ...shape,
        rows: [],
        columns: [{ field: measure.field, agg: measure.agg ?? "SUM" }],
        filters: [],
      },
      ctx,
      [],
      { workMax: state.config.queryWorkMax, markMax: state.config.markMax },
      Date.now() + state.config.queryBudgetMs,
    );
    const value = view.marks[0]?.values[0] ?? null;
    const userRes = await db.query("SELECT username FROM users WHERE id = $1", [alert.user_id]);
    const username = userRes.rows[0]?.username ?? "";
    void username;
    if (value !== null && value > alert.above) {
      if (alert.armed) {
        const { displayNumber } = await import("../shared/display.js");
        const text = `${alert.name} crossed ${displayNumber(alert.above)}: now ${displayNumber(value)}.`;
        await db.query("INSERT INTO inbox (id, user_id, text, read) VALUES ($1, $2, $3, false)", [newId(), alert.user_id, text]);
        await db.query("UPDATE alerts SET armed = false WHERE id = $1", [alert.id]);
        const unread = await db.query("SELECT COUNT(*)::int AS n FROM inbox WHERE user_id = $1 AND read = false", [alert.user_id]);
        state.events.emitToUser(alert.user_id, "inbox", JSON.stringify({ unread: unread.rows[0].n }));
      }
    } else {
      await db.query("UPDATE alerts SET armed = true WHERE id = $1", [alert.id]);
    }
  }
}

async function broadcast(state: AppState, sourceId: string): Promise<void> {
  const { extractPayload } = await import("./extract-state.js");
  const payload = await extractPayload(state.db, sourceId);
  const members = await state.db.query(
    `SELECT m.user_id FROM members m
     JOIN sources s ON s.project_id = m.project_id
     WHERE s.id = $1`,
    [sourceId],
  );
  const userIds = new Set<string>(members.rows.map((r) => r.user_id as string));
  state.events.emitToUsers(userIds, "extract", JSON.stringify(payload));
}

/** The server checks due work every second of real time. */
export function startScheduler(state: AppState): void {
  setInterval(() => {
    if (!state.started) return;
    void runDueWork(state).catch(() => {
      // PostgreSQL may be briefly unavailable; the next tick retries.
    });
  }, 1000);
}

/** A refresh is due when now >= last run + interval; missed intervals run once. */
export async function runDueWork(state: AppState): Promise<void> {
  const now = serverNowMs(state);
  const due = await state.db
    .query(
      `SELECT s.source_id, s.every_minutes, s.last_run_at, e.state
       FROM schedules s JOIN extracts e ON e.source_id = s.source_id
       WHERE s.last_run_at IS NOT NULL`,
    )
    .catch(() => ({ rows: [] }));
  for (const row of due.rows as { source_id: string; every_minutes: number; last_run_at: Date; state: string }[]) {
    if (row.state === "refreshing") continue;
    const dueAt = new Date(row.last_run_at).getTime();
    if (now >= dueAt) {
      // Several missed intervals run once: set the next run from this attempt.
      await refreshSource(state, row.source_id).catch(() => undefined);
      const interval = row.every_minutes * 60000;
      const next = new Date(now + interval);
      await state.db.query("UPDATE schedules SET last_run_at = $2 WHERE source_id = $1", [row.source_id, next]).catch(() => undefined);
      await state.db.query("UPDATE extracts SET next_run_at = $2 WHERE source_id = $1", [row.source_id, next]).catch(() => undefined);
      await broadcast(state, row.source_id).catch(() => undefined);
    }
  }
  // Staleness is computed by the server.
  const staleMs = state.config.staleMs;
  const extracts = await state
    .db!.query("SELECT source_id, last_success_at, stale FROM extracts WHERE state = 'live'")
    .catch(() => ({ rows: [] }));
  for (const e of extracts.rows as { source_id: string; last_success_at: Date | null; stale: boolean }[]) {
    if (!e.last_success_at) continue;
    const stale = now - new Date(e.last_success_at).getTime() >= staleMs;
    if (stale !== e.stale) {
      await state.db.query("UPDATE extracts SET stale = $2 WHERE source_id = $1", [e.source_id, stale]).catch(() => undefined);
      await broadcast(state, e.source_id).catch(() => undefined);
    }
  }
}

export function serverNowMs(state: AppState): number {
  if (state.clockFixed !== null) return state.clockFixed + state.clockOffset;
  return Date.now() + state.clockOffset;
}
