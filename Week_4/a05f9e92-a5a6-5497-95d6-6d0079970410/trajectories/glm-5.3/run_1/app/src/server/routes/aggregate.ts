// Reports and dashboards: aggregates computed on the server, in the viewer's
// time zone, after access rules.

import { RouteContext } from '../api.js';
import { SessionUser } from '../auth.js';
import { Db, clock } from '../db.js';
import { Table, TABLES } from '../../shared/model.js';
import { loadAccessRules, canReadRecord } from '../access.js';
import { RecordSnapshot } from '../recordengine.js';
import { matchesFilterText, recordScope } from '../filterengine.js';
import { startOfWeek, partsOf, dateStr, civilToEpoch } from '../../shared/time.js';

export interface Group { key: string; label: string; count: number; filter: string }

/** Aggregate a table by a field after access rules. */
export async function aggregate(route: RouteContext, user: SessionUser, table: string, filter: string, groupBy: string | null): Promise<{ groups: Group[]; total: number }> {
  if (!TABLES.includes(table as Table)) return { groups: [], total: 0 };
  const snaps = await visibleRecords(route.ctx.db, user, table as Table);
  const filtered = filter.trim() ? snaps.filter(s => matchesFilterText(filter, recordScope(s), user.username)) : snaps;
  const groups = new Map<string, number>();
  for (const snap of filtered) {
    const value = groupBy ? fieldValue(snap, groupBy) : '';
    const key = value === null ? '' : String(value);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const out: Group[] = [...groups.entries()].map(([key, count]) => ({
    key,
    label: key === '' ? '(empty)' : key,
    count,
    filter: key === '' ? 'true' : 'true',
  }));
  return { groups: out, total: filtered.length };
}

async function visibleRecords(db: Db, user: SessionUser, table: Table): Promise<RecordSnapshot[]> {
  const res = await db.query(
    `SELECT number, "table", state, workspace, fields, priority_overridden, created_at, created_by FROM records WHERE "table" = $1 AND workspace = 'live'`,
    [table],
  );
  const viewer = await viewerOf(db, user);
  const rules = await loadAccessRules(db);
  const out: RecordSnapshot[] = [];
  for (const row of res.rows) {
    const snap: RecordSnapshot = {
      number: String(row.number), table: row.table as Table, state: String(row.state),
      workspace: row.workspace as 'live' | 'test', fields: (row.fields ?? {}) as Record<string, unknown>,
      priority_overridden: Boolean(row.priority_overridden),
      created_at: new Date(row.created_at as Date).getTime(),
      created_by: (row.created_by as string | null) ?? null,
    };
    if (canReadRecord(viewer, rules, snap)) out.push(snap);
  }
  return out;
}

async function viewerOf(db: Db, user: SessionUser) {
  const res = await db.query(`SELECT username, department FROM people`);
  const departments = new Map<string, string>();
  for (const row of res.rows) departments.set(String(row.username), String(row.department ?? ''));
  return {
    username: user.username,
    display_name: user.display_name,
    roles: user.roles,
    department: user.department,
    departments,
  };
}

function fieldValue(snap: RecordSnapshot, field: string): unknown {
  const parts = field.split('.');
  let cur: unknown = { ...snap.fields, state: snap.state, number: snap.number };
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }
  return cur;
}

interface WidgetSpec {
  id: string;
  title: string;
  kind: 'count' | 'bar' | 'trend';
  table: string;
  filter: string;
  group_by: string | null;
  bucket: string | null;
  date_field: string | null;
}

/** Compute dashboard widgets as the viewer, in the viewer's time zone. */
export async function computeWidgets(route: RouteContext, user: SessionUser, specs: unknown): Promise<unknown[]> {
  const list = specs as WidgetSpec[];
  const out: unknown[] = [];
  for (const spec of list) {
    const table = spec.table as Table;
    const snaps = await visibleRecords(route.ctx.db, user, table);
    const filtered = spec.filter?.trim() ? snaps.filter(s => matchesFilterText(spec.filter, recordScope(s), user.username)) : snaps;

    if (spec.kind === 'count') {
      out.push({
        id: spec.id, title: spec.title, kind: 'count', table: spec.table,
        filter: spec.filter, group_by: null, bucket: null,
        data: [], total: filtered.length,
      });
      continue;
    }

    if (spec.kind === 'bar') {
      const buckets = new Map<string, number>();
      for (const snap of filtered) {
        const value = fieldValue(snap, spec.group_by ?? '');
        const key = value === null ? '' : String(value);
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
      const data = [...buckets.entries()].sort((a, b) => {
        const na = Number(a[0]), nb = Number(b[0]);
        if (!Number.isNaN(na) && String(na) === a[0] && !Number.isNaN(nb) && String(nb) === b[0]) return na - nb;
        return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
      }).map(([key, count]) => ({
        key,
        label: barLabel(spec.group_by ?? '', key),
        count,
        filter: `${spec.group_by ?? ''} = ${key === '' ? 'null' : /^\d+$/.test(key) ? key : `"${key}"`}`,
      }));
      out.push({
        id: spec.id, title: spec.title, kind: 'bar', table: spec.table,
        filter: spec.filter, group_by: spec.group_by, bucket: null,
        data, total: filtered.length,
      });
      continue;
    }

    // Trend: 14 buckets of local days or weeks in the viewer's zone.
    const tz = user.time_zone;
    const now = clock.nowMs();
    const dayMs = 86_400_000;
    const weekMs = 7 * dayMs;
    const bucketMs = spec.bucket === 'week' ? weekMs : dayMs;
    const lastStart = spec.bucket === 'week' ? startOfWeek(now, tz) : startOfLocalDay(now, tz);
    const firstStart = lastStart - 13 * bucketMs;
    const dateField = spec.date_field ?? 'created_at';

    const buckets: Array<{ start: number; end: number; count: number }> = [];
    for (let i = 0; i < 14; i++) {
      buckets.push({ start: firstStart + i * bucketMs, end: firstStart + (i + 1) * bucketMs, count: 0 });
    }
    for (const snap of filtered) {
      const raw = snap.fields[dateField];
      if (!raw) continue;
      const at = Date.parse(String(raw));
      if (Number.isNaN(at)) continue;
      for (const b of buckets) {
        if (at >= b.start && at < b.end) { b.count++; break; }
      }
    }
    const data = buckets.map(b => ({
      key: dateStr(b.start, tz),
      label: dateStr(b.start, tz),
      count: b.count,
      filter: bucketFilter(dateField, b.start, b.end, tz),
    }));
    out.push({
      id: spec.id, title: spec.title, kind: 'trend', table: spec.table,
      filter: spec.filter, group_by: null, bucket: spec.bucket,
      data, total: filtered.length,
    });
  }
  return out;
}

function startOfLocalDay(epochMs: number, tz: string): number {
  const p = partsOf(epochMs, tz);
  return civilToEpoch(p.y, p.mo, p.d, 0, 0, 0, tz);
}

function bucketFilter(field: string, start: number, end: number, tz: string): string {
  return `(${field} >= "${isoWithTz(start, tz)}") and (${field} < "${isoWithTz(end, tz)}")`;
}

function isoWithTz(epochMs: number, tz: string): string {
  const p = partsOf(epochMs, tz);
  const offset = civilToEpoch(p.y, p.mo, p.d, p.h, p.mi, p.s, tz) - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset) / 60000;
  const oh = String(Math.floor(abs / 60)).padStart(2, '0');
  const om = String(abs % 60).padStart(2, '0');
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:00${sign}${oh}:${om}`;
}

function barLabel(field: string, key: string): string {
  if (key === '') return '(empty)';
  void field;
  return key;
}
