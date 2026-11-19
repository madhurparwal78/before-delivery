import { now } from '../clock.js';
import { config } from '../config.js';
import { id, pool, q, q1, tx } from '../db.js';
import { broadcastExtract, broadcastInbox } from '../events.js';
import { getObject } from '../storage.js';
import { buildTable, parseCsv } from './csv.js';
import type { CellData } from './csv.js';
import { aggregateValues, compareValues, evalRow, keyOf, type DataRow, type EvalEnv } from './evaluate.js';
import { entitledRows, invalidateSource, isRightField, loadSource } from './source.js';
import { displayNumber } from '../../shared/display.js';
import type { Agg, MeasurePill, ScheduleSpec } from '../../shared/types.js';
import { parseFormula, type Ast } from '../../shared/formula.js';

export interface ExtractState {
  state: 'live' | 'refreshing' | 'refresh_failed';
  stale: boolean;
  last_success_at: string | null;
  last_failure_at: string | null;
  next_run_at: string | null;
  rows: number;
}

const failureInjection = new Map<string, number>();

export function injectRefreshFailures(sourceId: string, times: number): void {
  failureInjection.set(sourceId, times);
}

interface ExtractRecord {
  source_id: string;
  state: 'live' | 'refreshing' | 'refresh_failed';
  last_success_at: Date | null;
  last_failure_at: Date | null;
  last_run_at: Date | null;
}

async function record(sourceId: string): Promise<ExtractRecord | null> {
  return q1<ExtractRecord>(
    'SELECT source_id, state, last_success_at, last_failure_at, last_run_at FROM extracts WHERE source_id = $1',
    [sourceId],
  );
}

export async function ensureExtract(sourceId: string): Promise<void> {
  await q1(
    `INSERT INTO extracts (source_id, state, last_success_at, last_run_at) VALUES ($1, 'live', $2, $2)
     ON CONFLICT (source_id) DO UPDATE SET last_success_at = $2, last_run_at = $2, state = 'live'`,
    [sourceId, now()],
  );
}

export async function scheduleOf(sourceId: string): Promise<(ScheduleSpec & { saved_at?: string }) | null> {
  const row = await q1<{ schedule: ScheduleSpec | null }>('SELECT schedule FROM sources WHERE id = $1', [sourceId]);
  return row?.schedule ?? null;
}

export async function nextRunAt(sourceId: string): Promise<string | null> {
  const schedule = await scheduleOf(sourceId);
  if (schedule === null) return null;
  const rec = await record(sourceId);
  const last = rec?.last_run_at ?? null;
  if (last === null) return null;
  return new Date(last.getTime() + schedule.every_minutes * 60000).toISOString();
}

export async function extractState(sourceId: string): Promise<ExtractState> {
  const rec = await record(sourceId);
  const counts = await q<{ count: string }>(
    `SELECT COALESCE(SUM(jsonb_array_length(rows)), 0)::text AS count FROM snapshots WHERE source_id = $1 AND table_name = (
       SELECT name FROM source_tables WHERE source_id = $1 ORDER BY ord LIMIT 1
     )`,
    [sourceId],
  );
  const rows = Number(counts[0]?.count ?? '0');
  const lastSuccess = rec?.last_success_at ?? null;
  const stale = lastSuccess === null ? true : now().getTime() - lastSuccess.getTime() >= config.staleMs;
  return {
    state: rec?.state ?? 'live',
    stale,
    last_success_at: lastSuccess === null ? null : lastSuccess.toISOString(),
    last_failure_at: rec?.last_failure_at === null || rec?.last_failure_at === undefined ? null : rec.last_failure_at.toISOString(),
    next_run_at: await nextRunAt(sourceId),
    rows,
  };
}

async function publishState(sourceId: string): Promise<ExtractState> {
  const state = await extractState(sourceId);
  await broadcastExtract(sourceId, {
    source: sourceId,
    state: state.state,
    stale: state.stale,
    last_success_at: state.last_success_at,
    last_failure_at: state.last_failure_at,
    next_run_at: state.next_run_at,
  });
  return state;
}

const running = new Map<string, Promise<ExtractState>>();

export async function refreshSource(sourceId: string): Promise<ExtractState> {
  const current = running.get(sourceId);
  if (current !== undefined) return current;
  const task = runRefresh(sourceId).finally(() => running.delete(sourceId));
  running.set(sourceId, task);
  return task;
}

async function runRefresh(sourceId: string): Promise<ExtractState> {
  await q1("UPDATE extracts SET state = 'refreshing', last_run_at = $2 WHERE source_id = $1", [sourceId, now()]);
  await publishState(sourceId);

  const schedule = await scheduleOf(sourceId);
  const tables = await q<{ name: string; object_key: string }>(
    'SELECT name, object_key FROM source_tables WHERE source_id = $1 ORDER BY ord',
    [sourceId],
  );

  const injected = failureInjection.get(sourceId) ?? 0;
  try {
    if (injected > 0) {
      failureInjection.set(sourceId, injected - 1);
      throw new Error('injected');
    }
    const loaded: { name: string; rows: Record<string, CellData>[] }[] = [];
    for (const table of tables) {
      const bytes = await getObject(table.object_key);
      const parsed = parseCsv(bytes);
      if (parsed.errors.length > 0) throw new Error('invalid_csv');
      loaded.push({ name: table.name, rows: buildTable(parsed).rows });
    }
    const key = schedule?.kind === 'incremental' ? schedule.key : null;
    await tx(async (client) => {
      for (const table of loaded) {
        let rows = table.rows;
        if (key !== null && rows.length > 0 && key in rows[0]) {
          const existing = await client.query<{ rows: Record<string, CellData>[] }>(
            'SELECT rows FROM snapshots WHERE source_id = $1 AND table_name = $2',
            [sourceId, table.name],
          );
          const old = existing.rows[0]?.rows ?? [];
          let max: CellData = null;
          for (const row of old) {
            const v = row[key] ?? null;
            if (max === null || compareValues(v, max) > 0) max = v;
          }
          const fresh = max === null ? rows : rows.filter((r) => compareValues(r[key] ?? null, max) > 0);
          rows = [...old, ...fresh];
        }
        await client.query(
          `INSERT INTO snapshots (source_id, table_name, rows, updated_at) VALUES ($1, $2, $3, $4)
           ON CONFLICT (source_id, table_name) DO UPDATE SET rows = $3, updated_at = $4`,
          [sourceId, table.name, JSON.stringify(rows), now()],
        );
        await client.query('UPDATE source_tables SET rows = $3 WHERE source_id = $1 AND name = $2', [
          sourceId,
          table.name,
          rows.length,
        ]);
      }
    });
    invalidateSource(sourceId);
    await q1("UPDATE extracts SET state = 'live', last_success_at = $2 WHERE source_id = $1", [sourceId, now()]);
    const state = await publishState(sourceId);
    await checkAlerts(sourceId);
    return state;
  } catch {
    await q1("UPDATE extracts SET state = 'refresh_failed', last_failure_at = $2 WHERE source_id = $1", [
      sourceId,
      now(),
    ]);
    return publishState(sourceId);
  }
}

interface AlertRecord {
  id: string;
  name: string;
  above: number;
  armed: boolean;
  measure: MeasurePill;
  user_id: string;
  username: string;
  sheet_id: string;
}

export async function checkAlerts(sourceId: string): Promise<void> {
  const alerts = await q<AlertRecord>(
    `SELECT a.id, a.name, a.above, a.armed, a.measure, a.user_id, u.username, a.sheet_id
     FROM alerts a
     JOIN users u ON u.id = a.user_id
     JOIN sheets s ON s.id = a.sheet_id
     JOIN workbooks w ON w.id = s.workbook_id
     WHERE w.source_id = $1`,
    [sourceId],
  );
  if (alerts.length === 0) return;
  const source = await loadSource(sourceId);
  if (source === null) return;
  const touched = new Set<string>();
  for (const alert of alerts) {
    const calcRows = await q<{ name: string; formula: string }>(
      'SELECT name, formula FROM calculations WHERE sheet_id = $1',
      [alert.sheet_id],
    );
    const calcs = new Map<string, Ast>();
    for (const c of calcRows) {
      const parsed = parseFormula(c.formula, config.formulaMaxDepth);
      if (parsed.ast !== null) calcs.set(c.name, parsed.ast);
    }
    const env: EvalEnv = {
      parameters: {},
      setMembers: new Map(),
      calcs,
      lodValues: new Map(),
      tableCalcValues: new Map(),
      dedupe: (rows) => rows,
    };
    const rows = entitledRows(source, alert.username).rows;
    const value = wholeTableValue(source, alert.measure, rows, env, calcs);
    const numeric = typeof value === 'number' ? value : null;
    if (numeric !== null && numeric > alert.above) {
      if (alert.armed) {
        await q1('INSERT INTO inbox_items (id, user_id, body, created_at) VALUES ($1, $2, $3, $4)', [
          id(),
          alert.user_id,
          `${alert.name} crossed ${displayNumber(alert.above)}: now ${displayNumber(numeric)}.`,
          now(),
        ]);
        await q1('UPDATE alerts SET armed = false WHERE id = $1', [alert.id]);
        touched.add(alert.user_id);
      }
    } else if (!alert.armed) {
      await q1('UPDATE alerts SET armed = true WHERE id = $1', [alert.id]);
    }
  }
  for (const userId of touched) {
    const unread = await q1<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM inbox_items WHERE user_id = $1 AND read = false',
      [userId],
    );
    broadcastInbox(userId, Number(unread?.count ?? '0'));
  }
}

function wholeTableValue(
  source: Awaited<ReturnType<typeof loadSource>> & object,
  pill: MeasurePill,
  rows: DataRow[],
  env: EvalEnv,
  calcs: Map<string, Ast>,
): CellData {
  const ast = calcs.get(pill.field);
  if (ast !== undefined) return aggregateValues(pill.agg, rows.map((r) => evalRow(ast, r, env)));
  const deduped = isRightField(source, pill.field) ? dedupeRight(rows) : rows;
  return aggregateValues(pill.agg as Agg, deduped.map((r) => (pill.field in r ? r[pill.field] : null)));
}

function dedupeRight(rows: DataRow[]): DataRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = keyOf((row.__rk ?? null) as CellData);
    if (key === '\u0000null') return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function runDueRefreshes(): Promise<void> {
  if (pool.totalCount < 0) return;
  const sources = await q<{ id: string; schedule: ScheduleSpec | null; last_run_at: Date | null; state: string }>(
    `SELECT s.id, s.schedule, e.last_run_at, e.state
     FROM sources s JOIN extracts e ON e.source_id = s.id
     WHERE s.schedule IS NOT NULL`,
  );
  const current = now().getTime();
  for (const source of sources) {
    if (source.schedule === null) continue;
    const last = source.last_run_at?.getTime() ?? 0;
    if (current >= last + source.schedule.every_minutes * 60000) {
      await refreshSource(source.id);
    }
  }
}
