// Server-only data access for route loaders. Never imported by client code.
import { resolveViewer } from '../../src/server/bridge.js';
import { query } from '../../src/db/pg.js';
import { parseQueueQuery, queueQuery, canonicalQueueQuery } from '../../src/server/rules.js';
import { currentPolicy } from '../../src/server/rules.js';
import { calendarScope, calendarCounts } from '../../src/server/calendar.js';
import { formatTimestamp } from '../../src/domain/time.js';
 '../../src/server/rules.js';
import { readShareMonth } from '../../src/server/api2.js';

export { resolveViewer };

/** The viewer of a page request, or null when the session is not live. */
export async function viewerFromRequest(request) {
  const cookies = {};
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  const resolved = await resolveViewer({ cookies, headers: request.headers });
  return resolved.state === 'ok' ? resolved.viewer : null;
}

export async function loadQueue(viewer, url) {
  const params = url.searchParams;
  const q = parseQueueQuery(params, viewer);
  const out = await queueQuery(viewer, q);
  const scopePeople = await scopePeopleFor(viewer);
  return {
    queueQuery: canonicalQueueQuery(q),
    parsedQuery: q,
    rows: out.rows.map((r) => ({
      id: Number(r.id),
      person: r.person_name,
      day: r.day.toISOString().slice(0, 10),
      correction_type: r.correction_type,
      claimed_in: r.claimed_in,
      claimed_out: r.claimed_out,
      reason: r.reason,
      state: r.state,
      raised_at: formatTimestamp(r.raised_at),
      recorded_in: r.recorded_in_ts ? formatTimestamp(r.recorded_in_ts) : null,
      recorded_out: r.recorded_out_ts ? formatTimestamp(r.recorded_out_ts) : null,
    })),
    matched: out.matched,
    total: out.total,
    page: out.page,
    pages: out.pages,
    scopePeople,
  };
}

/** People the caller may name in the Person filter, read live. */
async function scopePeopleFor(viewer) {
  if (viewer.role === 'admin') {
    const rows = await query('SELECT id, name, work_address FROM person ORDER BY name');
    return rows.map((r) => ({ id: r.id, name: r.name, work_address: r.work_address }));
  }
  if (viewer.role === 'manager') {
    const rows = await query(
      `SELECT id, name, work_address FROM person
       WHERE id = $1 OR (manager_id = $1 AND active = true) ORDER BY name`,
      [viewer.id]
    );
    return rows.map((r) => ({ id: r.id, name: r.name, work_address: r.work_address }));
  }
  const rows = await query('SELECT id, name, work_address FROM person WHERE id = $1', [viewer.id]);
  return rows.map((r) => ({ id: r.id, name: r.name, work_address: r.work_address }));
}

export async function loadPolicyVersion() {
  const p = await currentPolicy();
  return p.version;
}

export async function loadPolicyFull() {
  const p = await currentPolicy();
  const creator = await query('SELECT name FROM person WHERE id = $1', [p.created_by]);
  const history = await query('SELECT * FROM policy ORDER BY version DESC');
  const trail = await query(
    `SELECT a.*, p.name AS actor_name FROM audit_event a
     JOIN person p ON p.id = a.actor_id ORDER BY a.seq DESC`
  );
  const TYPE_CODES = ['missed_in', 'missed_out', 'offsite', 'whole_day', 'night_shift'];
  const shape = (v) => ({
    version: v.version,
    monthly_cap: v.monthly_cap,
    lookback_days: v.lookback_days,
    enabled_types: TYPE_CODES.filter((t) => v.enabled_types.includes(t)),
    require_note_on_approve: v.require_note_on_approve,
    self_approval_allowed: false,
    created_by: v.created_by_name ?? creator[0]?.name,
    created_at: formatTimestamp(v.created_at),
  });
  return {
    policy: shape(p),
    history: history.map(shape),
    trail: trail.map((a) => ({
      seq: Number(a.seq),
      actor: a.actor_name,
      actor_role: a.actor_role,
      verb: a.verb,
      subject_type: a.subject_type,
      subject_id: Number(a.subject_id),
      request_id: a.request_id ?? null,
      occurred_at: formatTimestamp(a.occurred_at),
      note: a.note ?? null,
    })),
  };
}

export async function loadCalendar(viewer, month, person) {
  const scopePeople = await calendarScope(viewer);
  const days = await calendarCounts(month, scopePeople, person || null);
  return {
    month,
    days,
    people: scopePeople.map((p) => ({ id: p.id, name: p.name, work_address: p.work_address })),
  };
}

export async function loadDetail(viewer, id) {
  const { requestDetail } = await import('../../src/server/api.js');
  return requestDetail(viewer, id);
}

export async function loadShareMonth(token) {
  return readShareMonth(token);
}
