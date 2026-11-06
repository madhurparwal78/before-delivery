import { query, withTransaction } from '../db/pg.js';
import { ApiError, errors } from '../domain/errors.js';
import { claimedInstant, formatTimestamp, isValidDay, monthOf, nextBusinessDay, timeOccursOnDay } from '../domain/time.js';
import { foldAddress, graphemeCount, trimGraphemes } from '../domain/text.js';
import { entryHash, GENESIS_HASH } from '../domain/audit.js';
import { currentPolicy, scopeSql, capCount, checkClaimAgainstRecord, projectLeaveKind, LEAVE_LABELS, parseQueueQuery, queueQuery, inWindow } from './rules.js';
import { TYPE_CODES } from '../db/seed.js';
import { getPersonByFoldedAddress, currentManagerIds } from './people.js';
import { config } from './config.js';
import { passwordGrant } from './keycloak.js';
import { createSession, endSessionByToken, SESSION_COOKIE } from './sessions.js';

const JSON_TYPE = 'application/json; charset=utf-8';

export function json(reply, status, body) {
  reply.header('content-type', JSON_TYPE);
  reply.status(status);
  reply.send(body);
}

function ts(date) {
  return date ? formatTimestamp(date) : null;
}

function requestShape(r, viewer) {
  return {
    id: Number(r.id),
    person: r.person_name,
    work_address: r.work_address,
    manager: r.manager_name ?? null,
    day: typeof r.day === 'string' ? r.day : r.day.toISOString().slice(0, 10),
    correction_type: r.correction_type,
    claimed_in: r.claimed_in,
    claimed_out: r.claimed_out,
    reason: r.reason,
    state: r.state,
    raised_at: ts(r.raised_at),
    decided_by: r.decided_by_name ?? null,
    decided_at: ts(r.decided_at),
    decision_note: r.decision_note ?? null,
  };
}

function queueRowShape(r) {
  const row = requestShape(r);
  row.recorded_in = r.recorded_in_ts ? ts(r.recorded_in_ts) : null;
  row.recorded_out = r.recorded_out_ts ? ts(r.recorded_out_ts) : null;
  return row;
}

/** A viewer context: person plus live reporting lines, read from the store. */
async function viewerFor(personRow) {
  const directReportIds = personRow.role === 'manager'
    ? await currentManagerIds(personRow.id)
    : [];
  return {
    id: personRow.id,
    name: personRow.name,
    work_address: personRow.work_address,
    role: personRow.role,
    active: personRow.active,
    directReportIds,
  };
}

async function getRequestFull(id) {
  const rows = await query(
    `SELECT r.*, p.name AS person_name, p.work_address, p.role AS raiser_role,
            m.name AS manager_name,
            d.name AS decided_by_name
     FROM regularisation_request r
     JOIN person p ON p.id = r.person_id
     LEFT JOIN person m ON m.id = p.manager_id
     LEFT JOIN person d ON d.id = r.decided_by
     WHERE r.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function appendAudit(client, entry, overrides = {}) {
  const last = await client.query(
    'SELECT seq, entry_hash FROM audit_event ORDER BY seq DESC LIMIT 1'
  );
  const prevHash = last.rowCount > 0 ? last.rows[0].entry_hash : GENESIS_HASH;
  const seq = last.rowCount > 0 ? Number(last.rows[0].seq) + 1 : 1;
  // the hash is computed over the whole-second instant postgres will store
  const now = overrides.occurredAt ? new Date(overrides.occurredAt) : new Date();
  now.setMilliseconds(0);
  const shape = {
    seq,
    at: formatTimestamp(now),
    actor_id: entry.actor_id,
    action: entry.verb,
    subject_type: entry.subject_type,
    subject_id: entry.subject_id,
    detail: entry.note ?? null,
    prev_hash: prevHash,
  };
  const hash = entryHash(shape);
  await client.query(
    `INSERT INTO audit_event (seq, request_id, actor_id, actor_role, verb, subject_type, subject_id, occurred_at, note, prev_hash, entry_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [seq, entry.request_id ?? null, entry.actor_id, entry.actor_role, entry.verb,
      entry.subject_type, entry.subject_id, now, entry.note ?? null, prevHash, hash]
  );
  return { seq, id: hash };
}

// ---------------------------------------------------------------------------
// Body handling
// ---------------------------------------------------------------------------

export async function readBody(request) {
  if (request.body === undefined || request.body === null) return {};
  return request.body;
}

export function checkUnpublishedKeys(body, published) {
  for (const key of Object.keys(body)) {
    if (!published.includes(key)) {
      throw errors.unpublishedKey(key);
    }
  }
}

function requireField(body, field) {
  const v = body[field];
  if (v === undefined || v === null) throw errors.signInRequired(field);
  return v;
}

function assertNoNul(field, value) {
  if (typeof value === 'string' && value.includes('\u0000')) {
    throw errors.nulCharacter(field);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleHealth(request, reply) {
  const { readiness, isReady } = await import('./readiness.js');
  const flags = readiness();
  if (isReady()) {
    json(reply, 200, {
      status: 'ok', schema: true, seeded: true, realm: true,
    });
  } else {
    json(reply, 503, {
      status: 'starting',
      schema: !!flags.schema,
      seeded: !!flags.seeded,
      realm: !!flags.realm,
    });
  }
}

export async function handleSignIn(ctx, request, reply) {
  request = request ?? ctx?.request;
  reply = reply ?? ctx?.reply;
  const raw = request.body;
  if (raw === undefined || raw === null || typeof raw !== 'object') {
    throw new ApiError(400, 'The body must be a JSON object.');
  }
  checkUnpublishedKeys(raw, ['work_address', 'password']);
  let workAddress = raw.work_address;
  let password = raw.password;
  assertNoNul('work_address', workAddress ?? '');
  if (workAddress === undefined || workAddress === null) throw errors.signInRequired('work_address');
  if (typeof workAddress !== 'string') throw new ApiError(400, 'work_address must be text.', { field: 'work_address' });
  assertNoNul('password', password ?? '');
  if (password === undefined || password === null) throw errors.signInRequired('password');
  if (typeof password !== 'string') throw new ApiError(400, 'password must be text.', { field: 'password' });

  const folded = foldAddress(workAddress);

  // Lockout: simulate the refusal count since the latest of last success,
  // end of last lock, and the window start.
  const now = new Date();
  const horizon = new Date(now.getTime() -
    (config.signInWindowSeconds + config.signInLockoutSeconds) * 1000);
  const attempts = await query(
    `SELECT attempted_at, succeeded FROM sign_in_attempt
     WHERE work_address = $1 AND attempted_at >= $2
     ORDER BY attempted_at ASC`,
    [folded, horizon]
  );
  let count = 0;
  let lockEnd = null;

  for (const a of attempts) {
    const withinWindow = now.getTime() - a.attempted_at.getTime() <= config.signInWindowSeconds * 1000;
    if (a.succeeded) {
      count = 0;
      continue;
    }
    if (lockEnd && a.attempted_at.getTime() <= lockEnd.getTime()) continue;
    if (!withinWindow) continue;
    count++;
    if (count === 5) {
      lockEnd = new Date(a.attempted_at.getTime() + config.signInLockoutSeconds * 1000);
      count = 0;
    }
  }
  const locked = lockEnd !== null && now.getTime() < lockEnd.getTime();
  if (locked) {
    const retryAfter = Math.max(1, Math.ceil((lockEnd.getTime() - now.getTime()) / 1000));
    await recordAttempt(folded, false, now);
    reply.header('Retry-After', String(retryAfter));
    throw new ApiError(429, 'Too many attempts for this address. Try again later.');
  }

  // realm check
  let grant;
  try {
    grant = await passwordGrant(fetch, folded, password);
  } catch {
    await recordAttempt(folded, false, now);
    throw errors.signInUnavailable();
  }
  if (grant.refused) {
    await recordAttempt(folded, false, now);
    throw errors.signInRefused();
  }
  const person = await getPersonByFoldedAddress(folded);
  if (!person || !person.active) {
    await recordAttempt(folded, false, now);
    throw errors.signInRefused();
  }

  await recordAttempt(folded, true, now);

  // rotate: end any presented session, then start a fresh one
  const presentedToken = bearerToken(request) ?? request.cookies?.[SESSION_COOKIE];
  if (presentedToken) await endSessionByToken(presentedToken);
  const token = await createSession(person.id);

  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionMaxSeconds,
  });
  const viewer = await viewerFor(person);
  json(reply, 200, {
    person: { name: person.name, work_address: person.work_address },
    role: viewer.role,
    token,
  });
}

async function recordAttempt(folded, succeeded, at) {
  await query(
    'INSERT INTO sign_in_attempt (work_address, attempted_at, succeeded) VALUES ($1,$2,$3)',
    [folded, at, succeeded]
  );
}

function bearerToken(request) {
  const h = request.headers.get
    ? request.headers.get('authorization')
    : request.headers.authorization;
  if (h && /^Bearer /.test(h)) return h.slice(7);
  return null;
}

export { bearerToken };

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export async function handleQueue(viewer, request, reply) {
  const q = parseQueueQuery(request.queryParams || new URLSearchParams(request.url.split('?')[1] || ''), viewer);
  const out = await queueQuery(viewer, q);
  json(reply, 200, {
    rows: out.rows.map(queueRowShape),
    matched: out.matched,
    total: out.total,
    page: out.page,
    pages: out.pages,
  });
}

// ---------------------------------------------------------------------------
// Raise
// ---------------------------------------------------------------------------

const RAISE_FIELDS = ['day', 'correction_type', 'claimed_in', 'claimed_out', 'reason'];

export async function handleRaise(viewer, request, reply) {
  const body = request.body ?? {};
  if (viewer.role === 'admin') {
    throw new ApiError(403, 'People operations does not raise corrections.');
  }
  const idemKey = request.headers['idempotency-key'];
  if (idemKey !== undefined) {
    if (typeof idemKey !== 'string' || idemKey.length < 1 || idemKey.length > 64 || !/^[\x20-\x7e]+$/.test(idemKey)) {
      throw new ApiError(400, 'Idempotency-Key must be 1 to 64 visible characters.', { field: 'Idempotency-Key' });
    }
  }

  // repeat send check
  if (idemKey) {
    const prior = await query(
      `SELECT r.* FROM regularisation_request r
       WHERE r.person_id = $1 AND r.idempotency_key = $2`,
      [viewer.id, idemKey]
    );
    if (prior.length > 0) {
      const same =
        dayString(prior[0].day) === (body.day ?? null) &&
        prior[0].correction_type === (body.correction_type ?? null) &&
        prior[0].claimed_in === (body.claimed_in ?? null) &&
        prior[0].claimed_out === (body.claimed_out ?? null) &&
        prior[0].reason === (body.reason ?? null);
      if (!same) {
        throw new ApiError(422, 'That idempotency key was already used for a different correction.');
      }
      const full = await getRequestFull(prior[0].id);
      reply.header('Idempotent-Replayed', 'true');
      return json(reply, 200, requestShape(full, viewer));
    }
  }

  // field checks
  checkUnpublishedKeys(body, RAISE_FIELDS);
  for (const field of RAISE_FIELDS) {
    const v = body[field];
    if (v === undefined || v === null) {
      if (field === 'day' || field === 'correction_type') throw errors.signInRequired(field);
      if (field === 'reason') throw errors.signInRequired(field);
      continue;
    }
    if (typeof v === 'string' && v.includes('\u0000')) throw errors.nulCharacter(field);
  }
  const day = body.day;
  if (day !== undefined && day !== null && (typeof day !== 'string' || !isValidDay(day))) {
    throw new ApiError(400, 'day must read YYYY-MM-DD.', { field: 'day' });
  }
  const correctionType = body.correction_type;
  if (correctionType !== undefined && correctionType !== null && !TYPE_CODES.includes(correctionType)) {
    throw new ApiError(400, `Unknown correction type: ${correctionType}.`, { field: 'correction_type' });
  }
  for (const field of ['claimed_in', 'claimed_out']) {
    const v = body[field];
    if (v !== undefined && v !== null) {
      if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
        throw new ApiError(400, `${field} must read HH:MM.`, { field });
      }
    }
  }
  if (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string') {
    throw new ApiError(400, 'reason must be text.', { field: 'reason' });
  }
  const reason = body.reason ?? null;
  if (reason !== null) {
    const n = graphemeCount(reason);
    if (n < 20) throw new ApiError(400, 'A reason needs at least twenty characters.', { field: 'reason' });
    if (n > 280) throw new ApiError(422, 'A reason is limited to 280 characters.', { field: 'reason' });
  }

  // required times by type
  if (correctionType === 'missed_in' && (body.claimed_in === undefined || body.claimed_in === null)) {
    throw errors.signInRequired('claimed_in');
  }
  if (correctionType === 'missed_out' && (body.claimed_out === undefined || body.claimed_out === null)) {
    throw errors.signInRequired('claimed_out');
  }
  if (['offsite', 'whole_day', 'night_shift'].includes(correctionType)) {
    if (body.claimed_in === undefined || body.claimed_in === null) throw errors.signInRequired('claimed_in');
    if (body.claimed_out === undefined || body.claimed_out === null) throw errors.signInRequired('claimed_out');
  }

  // time-order rule
  const ci = body.claimed_in ?? null;
  const co = body.claimed_out ?? null;
  if (correctionType === 'night_shift' && ci && co) {
    if (!(co < ci)) throw new ApiError(400, 'A night shift must end on the following day.', { field: 'claimed_out' });
  } else if (ci && co) {
    if (!(co > ci)) throw new ApiError(400, 'The sign-out must come after the sign-in.', { field: 'claimed_out' });
  }

  const policy = await currentPolicy();

  // type enabled
  if (!policy.enabled_types.includes(correctionType)) {
    throw new ApiError(422, 'That correction type is not currently accepted.');
  }

  // window
  const seeded = await query('SELECT seeded_on FROM employer WHERE id = 1');
  const seededOn = seeded[0].seeded_on.toISOString().slice(0, 10);
  if (!inWindow(day, seededOn, policy.lookback_days)) {
    throw new ApiError(422, `That day is outside the ${policy.lookback_days} day correction window.`);
  }

  // times that occur
  if (ci) {
    if (!timeOccursOnDay(day, ci)) {
      throw new ApiError(422, `${ci} does not occur on ${day} in Kestrel Works time.`, { field: 'claimed_in' });
    }
  }
  if (co) {
    const checkDay = correctionType === 'night_shift' ? nextBusinessDay(day) : day;
    if (!timeOccursOnDay(checkDay, co)) {
      throw new ApiError(422, `${co} does not occur on ${checkDay} in Kestrel Works time.`, { field: 'claimed_out' });
    }
  }

  // claim vs record
  await checkClaimAgainstRecord(null, {
    personId: viewer.id, day, correctionType, claimedIn: ci, claimedOut: co,
  });

  // approved leave
  const leaveRow = await query(
    `SELECT 1 FROM leave_day WHERE person_id = $1 AND day = $2 AND status = 'approved'`,
    [viewer.id, day]
  );
  if (leaveRow.length > 0) {
    throw new ApiError(422, `You were on approved leave on ${day}.`);
  }

  // monthly cap (approved + pending)
  const month = monthOf(day);
  const used = await capCount(null, viewer.id, month, ['approved', 'pending']);
  if (used >= policy.monthly_cap) {
    throw new ApiError(422, `You have ${used} of ${policy.monthly_cap} corrections approved or waiting in ${month}.`);
  }

  // create inside one transaction; the unique pending index guards the race
  const raisedAt = new Date();
  raisedAt.setMilliseconds(0);
  try {
    const newId = await withTransaction(async (client) => {
      const res = await client.query(
        `INSERT INTO regularisation_request
         (person_id, day, correction_type, claimed_in, claimed_out, reason, state, raised_at, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8)
         RETURNING id`,
        [viewer.id, day, correctionType, ci, co, reason, raisedAt, idemKey ?? null]
      );
      return res.rows[0].id;
    });
    const full = await getRequestFull(newId);
    reply.status(201);
    return json(reply, 201, requestShape(full, viewer));
  } catch (err) {
    if (err && err.code === '23505') {
      if (err.constraint === 'request_one_pending_per_day') {
        throw new ApiError(409, `You already have a correction waiting on ${day}.`);
      }
      if (err.constraint === 'request_idempotency_key') {
        // replay race: fetch and compare
        const prior = await query(
          `SELECT * FROM regularisation_request WHERE person_id = $1 AND idempotency_key = $2`,
          [viewer.id, idemKey]
        );
        if (prior.length > 0) {
          const same =
            dayString(prior[0].day) === (body.day ?? null) &&
            prior[0].correction_type === (body.correction_type ?? null) &&
            prior[0].claimed_in === (body.claimed_in ?? null) &&
            prior[0].claimed_out === (body.claimed_out ?? null) &&
            prior[0].reason === (body.reason ?? null);
          if (same) {
            const full = await getRequestFull(prior[0].id);
            reply.header('Idempotent-Replayed', 'true');
            return json(reply, 200, requestShape(full, viewer));
          }
          throw new ApiError(422, 'That idempotency key was already used for a different correction.');
        }
        throw new ApiError(409, `You already have a correction waiting on ${day}.`);
      }
      throw errors.serverError();
    }
    throw err;
  }
}

function dayString(d) {
  return typeof d === 'string' ? d : d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export async function requestDetail(viewer, id) {
  const full = await getRequestFull(id);
  if (!full) throw errors.noSuchRequest();
  const scope = scopeSql(viewer);
  const visible = await query(
    `SELECT 1 FROM regularisation_request r WHERE r.id = $${scope.params.length + 1} AND ${scope.sql}`,
    [...scope.params, id]
  );
  if (visible.length === 0) throw errors.noSuchRequest();

  const day = dayString(full.day);
  const att = await query(
    'SELECT recorded_in, recorded_out, source FROM attendance_day WHERE person_id = $1 AND day = $2',
    [full.person_id, full.day]
  );
  const leave = await query(
    'SELECT kind, status FROM leave_day WHERE person_id = $1 AND day = $2',
    [full.person_id, full.day]
  );
  const audit = await query(
    `SELECT a.seq, a.verb, a.occurred_at, a.note, p.name AS actor_name, a.actor_role
     FROM audit_event a JOIN person p ON p.id = a.actor_id
     WHERE a.request_id = $1 ORDER BY a.seq ASC`,
    [id]
  );

  const out = {
    request: requestShape(full, viewer),
    evidence: {
      recorded_in: att[0]?.recorded_in ? ts(att[0].recorded_in) : null,
      recorded_out: att[0]?.recorded_out ? ts(att[0].recorded_out) : null,
      source: att[0]?.source ?? null,
    },
    leave: leave[0]
      ? {
          kind: projectLeaveKind(leave[0].kind, viewer, full.person_id),
          status: leave[0].status,
          label: LEAVE_LABELS[projectLeaveKind(leave[0].kind, viewer, full.person_id)],
        }
      : null,
    audit: audit.map((a) => ({
      seq: Number(a.seq),
      actor: a.actor_name,
      actor_role: a.actor_role,
      verb: a.verb,
      occurred_at: ts(a.occurred_at),
      note: a.note ?? null,
    })),
  };
  if (viewer.role === 'admin') {
    const raiser = await query(
      'SELECT phone, private_note FROM person WHERE id = $1',
      [full.person_id]
    );
    out.contact = { phone: raiser[0]?.phone ?? null, private_note: raiser[0]?.private_note ?? null };
  }
  return out;
}

export async function handleDetail(viewer, id, reply) {
  const out = await requestDetail(viewer, id);
  return json(reply, 200, out);
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export async function handleDecision(viewer, id, request, reply) {
  const body = request.body ?? {};
  const full = await getRequestFull(id);
  if (!full) throw errors.noSuchRequest();
  const scope = scopeSql(viewer);
  const visible = await query(
    `SELECT 1 FROM regularisation_request r WHERE r.id = $${scope.params.length + 1} AND ${scope.sql}`,
    [...scope.params, id]
  );
  if (visible.length === 0) throw errors.noSuchRequest();

  if (full.person_id === viewer.id) {
    throw new ApiError(403, 'You cannot decide a request you raised.');
  }
  if (viewer.role === 'admin') {
    throw new ApiError(403, 'People operations does not decide requests.');
  }
  if (full.state === 'approved' || full.state === 'rejected') {
    const err = new ApiError(409, `${full.decided_by_name} already decided this on ${dayString(full.decided_at)}.`);
    err.decided_by = full.decided_by_name;
    err.decided_at = ts(full.decided_at);
    throw err;
  }
  if (full.state === 'cancelled') {
    throw new ApiError(409, 'This request was withdrawn and can no longer be decided.');
  }

  checkUnpublishedKeys(body, ['outcome', 'note']);
  const outcome = body.outcome;
  if (outcome !== 'approve' && outcome !== 'reject') {
    throw new ApiError(400, 'outcome must be approve or reject.', { field: 'outcome' });
  }
  const noteRaw = body.note === undefined ? null : body.note;
  assertNoNul('note', noteRaw);
  if (noteRaw !== null && typeof noteRaw !== 'string') {
    throw new ApiError(400, 'note must be text.', { field: 'note' });
  }
  const note = noteRaw;
  if (note !== null && graphemeCount(note) > 500) {
    throw new ApiError(400, 'A note is limited to 500 characters.', { field: 'note' });
  }
  if (outcome === 'reject') {
    if (note === null || graphemeCount(note) < 10) {
      throw new ApiError(400, 'A rejection needs a note of at least ten characters.', { field: 'note' });
    }
  }
  const policy = await currentPolicy();
  if (outcome === 'approve' && policy.require_note_on_approve) {
    if (note === null || trimGraphemes(note) === '') {
      throw new ApiError(400, 'This policy requires a note when approving.', { field: 'note' });
    }
  }

  const day = dayString(full.day);
  const seeded = await query('SELECT seeded_on FROM employer WHERE id = 1');
  const seededOn = seeded[0].seeded_on.toISOString().slice(0, 10);

  if (outcome === 'approve') {
    // window of the policy then in force
    if (!inWindow(day, seededOn, policy.lookback_days)) {
      throw new ApiError(422, `That day is outside the ${policy.lookback_days} day correction window.`);
    }
    // cap: approved corrections only, not counting this request
    const month = monthOf(day);
    const used = await capCount(null, full.person_id, month, ['approved']);
    if (used >= policy.monthly_cap) {
      throw new ApiError(422, `${full.person_name} has used ${used} of ${policy.monthly_cap} corrections in ${month}.`);
    }
  }

  // everything below in one transaction
  const decidedAt = new Date();
  const result = await withTransaction(async (client) => {
    // lock the request row
    const locked = await client.query(
      `SELECT state, decided_by FROM regularisation_request WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const current = locked.rows[0];
    if (current.state !== 'pending') {
      return { conflict: current };
    }
    if (outcome === 'approve') {
      // re-check window and cap inside the transaction
      const pol = await currentPolicy(client);
      if (!inWindow(day, seededOn, pol.lookback_days)) {
        return { windowRefused: pol.lookback_days };
      }
      const month = monthOf(day);
      const used = await capCount(client, full.person_id, month, ['approved']);
      if (used >= pol.monthly_cap) {
        return { capRefused: { used, cap: pol.monthly_cap, month } };
      }
      // re-check claim against the attendance as it now stands
      try {
        await checkClaimAgainstRecord(client, {
          personId: full.person_id, day, correctionType: full.correction_type,
          claimedIn: full.claimed_in, claimedOut: full.claimed_out,
        });
      } catch (err) {
        return { claimRefused: err };
      }
    }
    await client.query(
      `UPDATE regularisation_request
       SET state = $1, decided_by = $2, decided_at = $3, decision_note = $4
       WHERE id = $5`,
      [outcome === 'approve' ? 'approved' : 'rejected', viewer.id, decidedAt,
        outcome === 'reject' ? note : note, id]
    );
    if (outcome === 'approve') {
      // the attendance write: each claimed punch lands on its own business
      // day, a night shift's sign-out on the following one, and any punch the
      // request carries no claim for is kept
      const writePunch = async (targetDay, field, instant) => {
        const existing = await client.query(
          'SELECT recorded_in, recorded_out FROM attendance_day WHERE person_id = $1 AND day = $2',
          [full.person_id, targetDay]
        );
        if (existing.rowCount > 0) {
          const other = field === 'recorded_in' ? existing.rows[0].recorded_out : existing.rows[0].recorded_in;
          const setIn = field === 'recorded_in' ? instant : other;
          const setOut = field === 'recorded_out' ? instant : other;
          await client.query(
            'UPDATE attendance_day SET recorded_in = $1, recorded_out = $2, source = $3 WHERE person_id = $4 AND day = $5',
            [setIn, setOut, 'regularisation', full.person_id, targetDay]
          );
        } else {
          await client.query(
            'INSERT INTO attendance_day (person_id, day, recorded_in, recorded_out, source) VALUES ($1,$2,$3,$4,$5)',
            [full.person_id, targetDay,
              field === 'recorded_in' ? instant : null,
              field === 'recorded_out' ? instant : null,
              'regularisation']
          );
        }
      };
      if (full.claimed_in) {
        await writePunch(day, 'recorded_in', new Date(claimedInstant(day, full.claimed_in)));
      }
      if (full.claimed_out) {
        const outDay = full.correction_type === 'night_shift' ? nextBusinessDay(day) : day;
        await writePunch(outDay, 'recorded_out', new Date(claimedInstant(outDay, full.claimed_out)));
      }
    }
    await appendAudit(client, {
      request_id: id,
      actor_id: viewer.id,
      actor_role: 'manager',
      verb: outcome === 'approve' ? 'approved' : 'rejected',
      subject_type: 'request',
      subject_id: id,
      note: outcome === 'reject' ? note : note,
    }, { occurredAt: decidedAt });
    return { ok: true };
  });

  if (result.conflict) {
    const current = result.conflict;
    if (current.state === 'cancelled') {
      throw new ApiError(409, 'This request was withdrawn and can no longer be decided.');
    }
    const after = await getRequestFull(id);
    const err = new ApiError(409, `${after.decided_by_name} already decided this on ${dayString(after.decided_at)}.`);
    err.decided_by = after.decided_by_name;
    err.decided_at = ts(after.decided_at);
    throw err;
  }
  if (result.windowRefused !== undefined) {
    throw new ApiError(422, `That day is outside the ${result.windowRefused} day correction window.`);
  }
  if (result.capRefused) {
    const { used, cap, month } = result.capRefused;
    throw new ApiError(422, `${full.person_name} has used ${used} of ${cap} corrections in ${month}.`);
  }
  if (result.claimRefused) throw result.claimRefused;

  const after = await getRequestFull(id);
  return json(reply, 200, requestShape(after, viewer));
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export async function handleCancel(viewer, id, request, reply) {
  const body = request.body ?? {};
  const full = await getRequestFull(id);
  if (!full) throw errors.noSuchRequest();
  const scope = scopeSql(viewer);
  const visible = await query(
    `SELECT 1 FROM regularisation_request r WHERE r.id = $${scope.params.length + 1} AND ${scope.sql}`,
    [...scope.params, id]
  );
  if (visible.length === 0) throw errors.noSuchRequest();

  if (full.person_id !== viewer.id) {
    throw new ApiError(403, 'Only the person who raised a request can withdraw it.');
  }
  if (full.state !== 'pending') {
    throw new ApiError(409, `This request is already ${full.state} and can no longer be withdrawn.`);
  }
  checkUnpublishedKeys(body, []);

  await withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE regularisation_request SET state = 'cancelled'
       WHERE id = $1 AND state = 'pending'`,
      [id]
    );
    if (res.rowCount === 0) {
      throw new ApiError(409, `This request is already ${full.state} and can no longer be withdrawn.`);
    }
  });
  const after = await getRequestFull(id);
  return json(reply, 200, requestShape(after, viewer));
}
