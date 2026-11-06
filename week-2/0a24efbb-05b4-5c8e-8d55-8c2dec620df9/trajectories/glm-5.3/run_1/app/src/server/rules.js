import { query, run } from '../db/pg.js';
import { ApiError, errors } from '../domain/errors.js';
import { claimedInstant, isValidDay, isValidMonth, nextBusinessDay, previousBusinessDay, dayToUtcDate,  } from '../domain/time.js';
import { foldAddress, trimGraphemes } from '../domain/text.js';
import { TYPE_CODES } from '../db/seed.js';

export const STATE_VALUES = ['pending', 'approved', 'rejected', 'cancelled'];
export const SORT_VALUES = ['day', 'raised', 'person'];
export const PAGE_SIZE = 25;

/** The policy version in force: the highest version. */
export async function currentPolicy(client) {
  const rows = await run(client, 'SELECT * FROM policy ORDER BY version DESC LIMIT 1');
  return rows[0] || null;
}

export function policyShape(p) {
  return {
    version: p.version,
    monthly_cap: p.monthly_cap,
    lookback_days: p.lookback_days,
    enabled_types: TYPE_CODES.filter((t) => p.enabled_types.includes(t)),
    require_note_on_approve: p.require_note_on_approve,
    self_approval_allowed: false,
    created_by: p.created_by_name ?? p.created_by,
    created_at: p.created_at_iso ?? p.created_at,
  };
}

/** The raiser's scope of requests: employee own, manager own + direct reports, admin all. */
export function scopeSql(person) {
  if (person.role === 'admin') {
    return { sql: 'TRUE', params: [] };
  }
  if (person.role === 'manager') {
    return {
      sql: '(r.person_id = ANY($1))',
      params: [[person.id, ...person.directReportIds]],
    };
  }
  return { sql: '(r.person_id = $1)', params: [person.id] };
}

export async function canSeeRequest(person, requestId) {
  const scope = scopeSql(person);
  const rows = await query(
    `SELECT r.id FROM regularisation_request r WHERE r.id = $${scope.params.length + 1} AND ${scope.sql}`,
    [...scope.params, requestId]
  );
  return rows.length > 0;
}

/** The window: seeded_on and the N days before it, N the policy's lookback. */
export function inWindow(day, seededOn, lookbackDays) {
  if (!isValidDay(day) || !isValidDay(seededOn)) return false;
  const diff = dayDiff(seededOn, day);
  return diff >= 0 && diff <= lookbackDays;
}

function dayDiff(a, b) {
  return Math.round((dayToUtcDate(a) - dayToUtcDate(b)) / 86400000);
}

/** The person's approved + pending corrections whose day falls in the month. */
export async function capCount(client, personId, month, states = ['approved', 'pending']) {
  const rows = await run(client, 
    `SELECT COUNT(*)::int AS n FROM regularisation_request
     WHERE person_id = $1 AND state = ANY($2) AND to_char(day, 'YYYY-MM') = $3`,
    [personId, states, month]
  );
  return rows[0].n;
}

/** Compare claimed instants against attendance as it stands. Throws 422 on contradiction. */
export async function checkClaimAgainstRecord(client, opts) {
  const { personId, day, correctionType, claimedIn, claimedOut } = opts;
  const claimedInInst = claimedIn ? claimedInstant(day, claimedIn) : null;
  const claimedOutInst = claimedOut
    ? correctionType === 'night_shift'
      ? claimedInstant(nextBusinessDay(day), claimedOut)
      : claimedInstant(day, claimedOut)
    : null;

  const thisRow = await run(client, 
    'SELECT recorded_in, recorded_out FROM attendance_day WHERE person_id = $1 AND day = $2',
    [personId, day]
  );
  const prevRow = await run(client, 
    'SELECT recorded_in, recorded_out FROM attendance_day WHERE person_id = $1 AND day = $2',
    [personId, previousBusinessDay(day)]
  );
  const nextRow = await run(client, 
    'SELECT recorded_in, recorded_out FROM attendance_day WHERE person_id = $1 AND day = $2',
    [personId, nextBusinessDay(day)]
  );

  const recordedIn = thisRow[0]?.recorded_in ?? null;
  const recordedOut = thisRow[0]?.recorded_out ?? null;

  if (correctionType === 'missed_in' && claimedInInst !== null && recordedOut !== null) {
    if (!(claimedInInst < recordedOut.getTime())) {
      throw new ApiError(422, 'The claimed sign-in must come before the recorded sign-out.', {
        field: 'claimed_in',
      });
    }
  }
  if (claimedInInst !== null && prevRow[0]?.recorded_out) {
    if (claimedInInst < prevRow[0].recorded_out.getTime()) {
      throw new ApiError(422, `A sign-in cannot come before the sign-out recorded on ${previousBusinessDay(day)}.`, {
        field: 'claimed_in',
      });
    }
  }
  if (correctionType === 'missed_out' && claimedOutInst !== null && recordedIn !== null) {
    if (!(claimedOutInst > recordedIn.getTime())) {
      throw new ApiError(422, 'The claimed sign-out must come after the recorded sign-in.', {
        field: 'claimed_out',
      });
    }
  }
  if (correctionType === 'night_shift' && claimedOutInst !== null && nextRow[0]?.recorded_in) {
    if (claimedOutInst > nextRow[0].recorded_in.getTime()) {
      throw new ApiError(422, `A night shift cannot end after the sign-in recorded on ${nextBusinessDay(day)}.`, {
        field: 'claimed_out',
      });
    }
  }
}

/** Leave kind as each reader sees it. */
export function projectLeaveKind(storedKind, viewer, raiserId) {
  if (viewer.role === 'admin' || viewer.id === raiserId) return storedKind;
  if (storedKind === 'sickness') return 'absence';
  return storedKind;
}

export const LEAVE_LABELS = {
  annual: 'Annual leave',
  sickness: 'Sickness',
  absence: 'Absence',
};

/** Shared-link mint scope, read live. */
export async function mintScope(client, minter) {
  if (minter.role === 'admin') {
    const rows = await run(client, 
      'SELECT id, name, work_address FROM person WHERE active = true ORDER BY name'
    );
    return rows;
  }
  if (minter.role === 'manager') {
    const rows = await run(client, 
      'SELECT id, name, work_address FROM person WHERE manager_id = $1 AND active = true ORDER BY name',
      [minter.id]
    );
    return rows;
  }
  return [];
}

/** Is a shared link dead at the moment of the check? */
export async function isLinkDead(client, link) {
  const now = Date.now();
  if (now >= link.expires_at.getTime()) return true;
  if (link.revoked_at) return true;
  if (link.replaced_at) return true;
  const rows = await run(client, 
    `SELECT p.active, p.manager_id, p.role FROM person p WHERE p.id = $1`,
    [link.person_id]
  );
  const person = rows[0];
  if (!person || !person.active) return true;
  const minterRows = await run(client, 
    'SELECT id, role, active FROM person WHERE id = $1',
    [link.minted_by]
  );
  const minter = minterRows[0];
  if (!minter || !minter.active) return true;
  if (minter.role !== 'admin' && minter.role !== 'manager') return true;
  if (minter.role === 'manager' && person.manager_id !== minter.id) return true;
  return false;
}

/** Canonical queue query: only parameters that differ from defaults, in order. */
export function canonicalQueueQuery(q) {
  const parts = [];
  if (q.state && q.state !== 'all') parts.push(`state=${encodeURIComponent(q.state)}`);
  if (q.type) parts.push(`type=${encodeURIComponent(q.type)}`);
  if (q.person) parts.push(`person=${encodeURIComponent(q.person)}`);
  if (q.month) parts.push(`month=${encodeURIComponent(q.month)}`);
  if (q.q) parts.push(`q=${encodeURIComponent(q.q)}`);
  if (q.sort) parts.push(`sort=${encodeURIComponent(q.sort)}`);
  if (q.page && q.page > 1) parts.push(`page=${q.page}`);
  return parts.join('&');
}

/** Validate and parse a queue query. Throws ApiError 400 on bad values. */
export function parseQueueQuery(searchParams, viewer) {
  const single = (name) => {
    if (!searchParams.has(name)) return undefined;
    const v = searchParams.get(name);
    if (v === '') return undefined;
    return v;
  };
  const q = {};
  const checks = [
    ['state', STATE_VALUES],
    ['type', TYPE_CODES],
    ['sort', SORT_VALUES],
  ];
  for (const name of ['state', 'type', 'person', 'month', 'q', 'sort', 'page']) {
    const raw = searchParams.has(name) ? searchParams.get(name) : undefined;
    if (raw !== undefined && raw.includes('\u0000')) {
      throw new ApiError(400, `${name} cannot contain a NUL character.`, { field: name });
    }
  }
  const state = single('state');
  if (state !== undefined && !STATE_VALUES.includes(state)) {
    throw new ApiError(400, `Unknown state value: ${state}.`, { field: 'state' });
  }
  const type = single('type');
  if (type !== undefined && !TYPE_CODES.includes(type)) {
    throw new ApiError(400, `Unknown type value: ${type}.`, { field: 'type' });
  }
  const person = single('person');
  const month = single('month');
  if (month !== undefined && !isValidMonth(month)) {
    throw new ApiError(400, `Unknown month value: ${month}.`, { field: 'month' });
  }
  const qText = single('q');
  if (qText !== undefined && trimGraphemes(qText).length > 100) {
    throw new ApiError(400, 'Search is limited to 100 characters.', { field: 'q' });
  }
  const sort = single('sort');
  if (sort !== undefined && !SORT_VALUES.includes(sort)) {
    throw new ApiError(400, `Unknown sort value: ${sort}.`, { field: 'sort' });
  }
  const pageRaw = single('page');
  let page = 1;
  if (pageRaw !== undefined) {
    if (!/^[1-9][0-9]*$/.test(pageRaw)) {
      throw new ApiError(400, `Unknown page value: ${pageRaw}.`, { field: 'page' });
    }
    page = Number(pageRaw);
  }
  return {
    state, type, person, month,
    q: qText !== undefined ? trimGraphemes(qText) : undefined,
    sort, page,
  };
}

/** SQL for the queue with scope applied first. */
export async function queueQuery(person, q) {
  const scope = scopeSql(person);
  const params = [...scope.params];
  const param = (v) => {
    params.push(v);
    return `\$${params.length}`;
  };
  const where = [scope.sql];
  if (q.state) where.push(`r.state = ${param(q.state)}`);
  if (q.type) where.push(`r.correction_type = ${param(q.type)}`);
  if (q.month) where.push(`to_char(r.day, 'YYYY-MM') = ${param(q.month)}`);
  if (q.person) {
    const folded = foldAddress(q.person);
    where.push(`EXISTS (SELECT 1 FROM person fp WHERE fp.id = r.person_id AND lower(fp.work_address) = lower(${param(folded)}))`);
  }
  if (q.q) {
    const escaped = q.q.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
    where.push(`r.reason ILIKE ${param('%' + escaped + '%')} ESCAPE '\\'`);
  }
  const whereSql = where.join(' AND ');

  const totalRows = await query(
    `SELECT COUNT(*)::int AS n FROM regularisation_request r WHERE ${scope.sql}`,
    scope.params
  );
  const matchedRows = await query(
    `SELECT COUNT(*)::int AS n FROM regularisation_request r WHERE ${whereSql}`,
    params
  );
  const total = totalRows[0].n;
  const matched = matchedRows[0].n;
  const pages = Math.max(1, Math.ceil(matched / PAGE_SIZE));
  const page = Math.min(q.page || 1, pages);

  let orderBy;
  if (q.sort === 'day') orderBy = 'r.day DESC, r.id ASC';
  else if (q.sort === 'raised') orderBy = 'r.raised_at ASC, r.id ASC';
  else if (q.sort === 'person') orderBy = 'lower(p.name) ASC, r.id ASC';
  else orderBy = 'CASE WHEN r.state = \'pending\' THEN 0 ELSE 1 END, r.raised_at ASC, r.id ASC';

  const rows = await query(
    `SELECT r.*, p.name AS person_name, p.work_address AS work_address,
            m.name AS manager_name,
            a.recorded_in AS recorded_in_ts, a.recorded_out AS recorded_out_ts
     FROM regularisation_request r
     JOIN person p ON p.id = r.person_id
     LEFT JOIN person m ON m.id = p.manager_id
     LEFT JOIN attendance_day a ON a.person_id = r.person_id AND a.day = r.day
     WHERE ${whereSql}
     ORDER BY ${orderBy}
     LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    params
  );
  return { rows, matched, total, page, pages };
}
