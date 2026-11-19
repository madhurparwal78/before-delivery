// Record endpoints part 2: read, patch, transition, notes, audit, bulk, search.

import { RouteContext } from '../api.js';
import { SessionUser } from '../auth.js';
import { sendJson } from '../apibase.js';
import { ApiError, notFound, forbidden, unknownField, operatorOnly, fieldDenied } from '../errors.js';
import { Db, clock } from '../db.js';
import { Table, Role, TRANSITIONS, STATE_LABELS, PRIORITY_LABELS, TABLES } from '../../shared/model.js';
import { loadAccessRules, Viewer, canReadRecord, readableFields, writableFields } from '../access.js';
import { RecordSnapshot, fieldLabel, stateLabel, typeLabel, knownPath, loadSnapshot, FIELD_SPECS, allFieldNames } from '../recordengine.js';
import { createRecord, saveRecord, transitionRecord } from '../recordservice.js';
import { matchesFilterText, recordScope } from '../filterengine.js';
import { slaViews, shownSla, syncSlas } from '../slarunner.js';
import { deliver } from '../inbox.js';

export async function readRecordFull(route: RouteContext, user: SessionUser, number: string): Promise<RecordSnapshot> {
  const snap = await loadSnapshot(route.ctx.db, number);
  if (!snap) throw notFound();
  const viewer = await viewerFor(route.ctx.db, user);
  const rules = await loadAccessRules(route.ctx.db);
  if (!canReadRecord(viewer, rules, snap)) throw notFound();
  return snap;
}

export async function viewerFor(db: Db, user: SessionUser): Promise<Viewer> {
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

/** A record response: fields filtered by the viewer's access. */
export async function recordBody(route: RouteContext, user: SessionUser, snap: RecordSnapshot): Promise<unknown> {
  const viewer = await viewerFor(route.ctx.db, user);
  const rules = await loadAccessRules(route.ctx.db);
  const deniedRead = readableFields(viewer, rules, snap.table);

  const fields: Record<string, unknown> = {};
  for (const spec of FIELD_SPECS[snap.table]) {
    if (deniedRead?.has(spec.name)) continue;
    const value = snap.fields[spec.name] ?? null;
    fields[spec.name] = {
      value,
      display: displayFor(snap.table, spec.name, value),
      version: await fieldVersion(route.ctx.db, snap.number, spec.name),
      label: spec.label,
      mandatory: false,
      read_only: spec.readOnly ?? false,
      visible: true,
    };
  }

  const slas = await slaViews(route.ctx.db, snap.number);
  const links = await loadLinks(route.ctx.db, snap.number);
  const transitions = allowedTransitions(snap, user.roles);

  return {
    number: snap.number,
    table: snap.table,
    state: snap.state,
    state_label: stateLabel(snap.state),
    fields,
    priority_overridden: snap.priority_overridden,
    slas,
    links,
    workaround: await workaroundFor(route.ctx.db, snap),
    transitions,
  };
}

async function fieldVersion(db: Db, number: string, field: string): Promise<number> {
  const res = await db.query(`SELECT version FROM field_versions WHERE record = $1 AND field = $2`, [number, field]);
  return res.rows.length ? Number(res.rows[0].version) : 1;
}

function displayFor(table: Table, field: string, value: unknown): string {
  if (value === null || value === undefined) return '';
  const spec = FIELD_SPECS[table].find(s => s.name === field);
  if (spec?.type === 'select' && spec.choices) {
    const labels: Record<string, string> = {
      awaiting_requester: 'Awaiting requester', awaiting_supplier: 'Awaiting supplier', awaiting_change: 'Awaiting change',
      fixed: 'Fixed', workaround_given: 'Workaround given', no_fault_found: 'No fault found', duplicate: 'Duplicate',
      successful: 'Successful', failed: 'Failed', backed_out: 'Backed out',
    };
    return labels[String(value)] ?? String(value);
  }
  if (field === 'priority') return PRIORITY_LABELS[Number(value)] ?? String(value);
  if (field === 'impact' || field === 'urgency') return Number(value) === 1 ? 'High' : Number(value) === 2 ? 'Medium' : 'Low';
  return String(value);
}

async function loadLinks(db: Db, number: string): Promise<unknown> {
  const children = await db.query(`SELECT child FROM record_links WHERE kind = 'parent' AND parent = $1`, [number]);
  const parent = await db.query(`SELECT parent FROM record_links WHERE kind = 'parent' AND child = $1 LIMIT 1`, [number]);
  const problem = await db.query(`SELECT parent FROM record_links WHERE kind = 'incident' AND child = $1 LIMIT 1`, [number]);
  const incidents = await db.query(`SELECT child FROM record_links WHERE kind = 'incident' AND parent = $1`, [number]);
  const fix = await db.query(`SELECT parent FROM record_links WHERE kind = 'fix_change' AND child = $1 LIMIT 1`, [number]);
  return {
    parent: parent.rows.length ? String(parent.rows[0].parent) : null,
    children: children.rows.map((r: Record<string, unknown>) => String(r.child)),
    problem: problem.rows.length ? String(problem.rows[0].parent) : null,
    incidents: incidents.rows.map((r: Record<string, unknown>) => String(r.child)),
    fix_change: fix.rows.length ? String(fix.rows[0].parent) : null,
  };
}

async function workaroundFor(db: Db, snap: RecordSnapshot): Promise<{ problem: string; text: string } | null> {
  if (snap.table !== 'incident') return null;
  const problemNumber = snap.fields.problem as string | null;
  if (!problemNumber) return null;
  const res = await db.query(`SELECT fields FROM records WHERE number = $1 AND "table" = 'problem'`, [problemNumber]);
  if (!res.rows.length) return null;
  const fields = res.rows[0].fields as Record<string, unknown>;
  const text = fields.workaround as string | null;
  if (!text) return null;
  return { problem: problemNumber, text };
}

/** The transitions this caller may make from the current state. */
export function allowedTransitions(snap: RecordSnapshot, roles: Role[]): Array<{ to: string; label: string }> {
  const out: Array<{ to: string; label: string }> = [];
  for (const t of TRANSITIONS[snap.table]) {
    if (t.from !== snap.state) continue;
    if (!t.roles.some(r => roles.includes(r))) continue;
    out.push({ to: t.to, label: stateLabel(t.to) });
  }
  return out;
}

/** A work note or comment. Comments may move an on-hold incident back. */
export async function appendNote(route: RouteContext, user: SessionUser, number: string, kind: 'work_note' | 'comment', text: string): Promise<void> {
  const snap = await readRecordFull(route, user, number);
  const now = clock.nowMs();
  await route.ctx.db.query(
    `INSERT INTO activity(record, at, actor, acting_for, kind, text)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [number, new Date(now), user.username, null, kind, text],
  );

  // A caller comment on an awaiting-requester hold moves the incident back.
  if (snap.table === 'incident' && kind === 'comment' &&
      snap.state === 'on_hold' && snap.fields.hold_reason === 'awaiting_requester' &&
      snap.fields.caller === user.username) {
    await applySystemTransition(route, snap, 'in_progress', user.username, 'Comment from the caller');
  }

  // Mentioned users get an inbox item.
  for (const match of text.matchAll(/@([a-z0-9_]+)/g)) {
    const mentioned = match[1];
    if (mentioned !== user.username) {
      const rules = await inboxRules(route.ctx.db);
      await deliver(route.ctx.db, rules, 'mentioned', mentioned, `${user.display_name} mentioned you on ${number}.`, number);
    }
  }
}

async function inboxRules(db: Db): Promise<Array<{ event: string; roles: string[]; enabled: boolean }>> {
  const res = await db.query(`SELECT event, roles, enabled FROM inbox_rules`);
  return res.rows.map((r: Record<string, unknown>) => ({ event: String(r.event), roles: r.roles as string[], enabled: Boolean(r.enabled) }));
}

/** A system-driven state change (caller comment, fix change, vote). */
export async function applySystemTransition(route: RouteContext, snap: RecordSnapshot, to: string, actor: string, reason: string): Promise<void> {
  const now = clock.nowMs();
  await route.ctx.db.query(`UPDATE records SET state = $2, updated_at = $3 WHERE number = $1`, [snap.number, to, new Date(now)]);
  await route.ctx.db.query(`INSERT INTO state_history(record, state, at) VALUES ($1,$2,$3)`, [snap.number, to, new Date(now)]);
  await route.ctx.db.query(
    `INSERT INTO activity(record, at, actor, acting_for, kind, text) VALUES ($1,$2,$3,NULL,'state', $4)`,
    [snap.number, new Date(now), actor, `${snap.number} moved to ${stateLabel(to)}. ${reason}`],
  );
  await syncSlas(route.ctx.db, { ...snap, state: to }, route.ctx.live);
}
