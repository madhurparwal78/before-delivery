import {
  addDays,
  businessInstant,
  isBusinessDay,
  isClaimTime,
  monthOf,
  truncateToSecond,
  utcSeconds,
} from '../shared/businessTime.js';
import {
  CLAIM_REQUIREMENTS,
  CORRECTION_TYPES,
  PAGE_SIZE,
  REASON_MAX,
  REASON_MIN,
  NOTE_MAX,
  REJECTION_NOTE_MIN,
} from '../shared/constants.js';
import { refusals, alreadyDecidedWording } from '../shared/copy.js';
import { foldWorkAddress, graphemeLength } from '../shared/text.js';
import { appendAuditEntry, auditEntryObject } from './audit.js';
import { attendanceFor, claimedInstants, claimedOutDay, writeApprovedAttendance } from './attendance.js';
import { checkNoNul, checkUnpublishedKeys, isMissing } from './bodyChecks.js';
import { LOCKS, lock, pool, transaction } from './db.js';
import { Refusal, noSuchRequest, refuse, refuseField } from './errors.js';
import { employer, namesByIds, requestScopeIds } from './people.js';
import { capUsedForApproval, capUsedForRaise, dayIsInsideWindow, policyInForce } from './policy.js';
import { leaveLabel, projectContact, projectLeaveKind, readerSeesStoredLeaveKind } from './projections.js';

export const RAISE_FIELDS = ['day', 'correction_type', 'claimed_in', 'claimed_out', 'reason'];
export const DECISION_FIELDS = ['outcome', 'note'];

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{1,64}$/;
const RECORD_ID_PATTERN = /^[1-9][0-9]*$/;

const REQUEST_COLUMNS = `
  r.id, r.person_id, r.day, r.correction_type, r.claimed_in, r.claimed_out, r.reason, r.state,
  r.raised_at, r.decided_by, r.decided_at, r.decision_note,
  p.name AS person_name, p.work_address, p.phone, p.private_note,
  m.name AS manager_name, d.name AS decided_by_name`;

const REQUEST_JOINS = `
  FROM regularisation_request r
  JOIN person p ON p.id = r.person_id
  LEFT JOIN person m ON m.id = p.manager_id
  LEFT JOIN person d ON d.id = r.decided_by`;

const REQUEST_SELECT = `SELECT ${REQUEST_COLUMNS} ${REQUEST_JOINS}`;

const QUEUE_SELECT = `SELECT ${REQUEST_COLUMNS}, a.recorded_in, a.recorded_out ${REQUEST_JOINS}
  LEFT JOIN attendance_day a ON a.person_id = r.person_id AND a.day = r.day`;

const SORT_CLAUSES = {
  '': "(r.state = 'pending') DESC, r.raised_at ASC, r.id ASC",
  day: 'r.day DESC, r.id ASC',
  raised: 'r.raised_at ASC, r.id ASC',
  person: 'lower(p.name) ASC, r.id ASC',
};

/** A path segment names a record only when it is a plain positive whole number. */
export function parseRecordId(segment) {
  if (typeof segment !== 'string' || !RECORD_ID_PATTERN.test(segment)) return null;
  if (BigInt(segment) > 9223372036854775807n) return null;
  if (Number(segment) > Number.MAX_SAFE_INTEGER) return null;
  return Number(segment);
}

export function requestObject(row) {
  return {
    id: row.id,
    person: row.person_name,
    work_address: row.work_address,
    manager: row.manager_name,
    day: row.day,
    correction_type: row.correction_type,
    claimed_in: row.claimed_in,
    claimed_out: row.claimed_out,
    reason: row.reason,
    state: row.state,
    raised_at: utcSeconds(row.raised_at),
    decided_by: row.decided_by_name ?? null,
    decided_at: utcSeconds(row.decided_at),
    decision_note: row.decision_note,
  };
}

function queueRowObject(row) {
  return {
    ...requestObject(row),
    recorded_in: utcSeconds(row.recorded_in),
    recorded_out: utcSeconds(row.recorded_out),
  };
}

async function requestInScope(client, caller, id) {
  if (id === null) throw noSuchRequest();
  const scope = await requestScopeIds(caller, client);
  const result = await client.query(`${REQUEST_SELECT} WHERE r.id = $1 AND r.person_id = ANY ($2::int[])`, [id, scope]);
  const row = result.rows[0];
  if (!row) throw noSuchRequest();
  return row;
}

/** The queue: scope first, then the caller's filters, which only ever narrow. */
export async function readQueue(caller, query) {
  const scope = await requestScopeIds(caller);
  const where = ['r.person_id = ANY ($1::int[])'];
  const values = [scope];

  if (query.state) {
    values.push(query.state);
    where.push(`r.state = $${values.length}`);
  }
  if (query.type) {
    values.push(query.type);
    where.push(`r.correction_type = $${values.length}`);
  }
  if (query.person) {
    const found = await pool.query('SELECT id FROM person WHERE lower(work_address) = $1', [
      foldWorkAddress(query.person),
    ]);
    values.push(found.rows[0] ? found.rows[0].id : -1);
    where.push(`r.person_id = $${values.length}`);
  }
  if (query.month) {
    values.push(query.month);
    where.push(`to_char(r.day, 'YYYY-MM') = $${values.length}`);
  }
  if (query.q.trim()) {
    values.push(query.q.trim());
    where.push(`position(lower($${values.length}) in lower(r.reason)) > 0`);
  }

  const counted = await pool.query(
    `SELECT count(*)::int AS matched FROM regularisation_request r JOIN person p ON p.id = r.person_id
      WHERE ${where.join(' AND ')}`,
    values,
  );
  const totalled = await pool.query(
    'SELECT count(*)::int AS total FROM regularisation_request WHERE person_id = ANY ($1::int[])',
    [scope],
  );
  const matched = counted.rows[0].matched;
  const total = totalled.rows[0].total;
  const pages = Math.max(1, Math.ceil(matched / PAGE_SIZE));
  const page = Math.min(Math.max(1, query.page), pages);

  const listed = await pool.query(
    `${QUEUE_SELECT}
     WHERE ${where.join(' AND ')}
     ORDER BY ${SORT_CLAUSES[query.sort]}
     LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    values,
  );

  return { rows: listed.rows.map(queueRowObject), matched, total, page, pages };
}

/** One read carrying the request, the evidence, that day's leave and the trail. */
export async function readRequestDetail(caller, id) {
  const row = await requestInScope(pool, caller, id);
  const attendance = await pool.query(
    'SELECT recorded_in, recorded_out, source FROM attendance_day WHERE person_id = $1 AND day = $2',
    [row.person_id, row.day],
  );
  const record = attendance.rows[0] ?? null;
  const leave = await pool.query('SELECT kind, status FROM leave_day WHERE person_id = $1 AND day = $2', [
    row.person_id,
    row.day,
  ]);
  const trail = await pool.query(
    'SELECT * FROM audit_event WHERE request_id = $1 ORDER BY seq ASC',
    [row.id],
  );
  const actorNames = await namesByIds([...new Set(trail.rows.map((entry) => entry.actor_id))]);

  const storedLeave = leave.rows[0] ?? null;
  const seesStoredKind = readerSeesStoredLeaveKind(caller, row.person_id);
  const projectedLeave = storedLeave
    ? { kind: projectLeaveKind(storedLeave.kind, seesStoredKind), status: storedLeave.status }
    : null;

  const detail = {
    request: requestObject(row),
    evidence: {
      recorded_in: utcSeconds(record?.recorded_in ?? null),
      recorded_out: utcSeconds(record?.recorded_out ?? null),
      source: record?.source ?? null,
    },
    leave: projectedLeave,
    audit: trail.rows.map((entry) => auditEntryObject(entry, actorNames.get(entry.actor_id))),
  };
  const contact = projectContact(caller, row);
  if (contact) detail.contact = contact;
  return { detail, raiserId: row.person_id, leaveLabel: projectedLeave ? leaveLabel(projectedLeave.kind, projectedLeave.status) : null };
}

/** Compares a claim with the attendance rows as they stand, in the published order. */
async function checkClaimAgainstRecord(client, claim) {
  const previousDay = addDays(claim.day, -1);
  const nextDay = addDays(claim.day, 1);
  const byDay = await attendanceFor(client, claim.person_id, [previousDay, claim.day, nextDay]);
  const instants = claimedInstants(claim);
  const today = byDay.get(claim.day);
  const previous = byDay.get(previousDay);
  const next = byDay.get(nextDay);

  if (claim.correction_type === 'missed_in' && instants.in && today?.recorded_out) {
    if (!(instants.in < today.recorded_out)) {
      refuseField(422, refusals.claimedInBeforeRecordedOut, 'claimed_in');
    }
  }
  if (instants.in && previous?.recorded_out) {
    if (instants.in < previous.recorded_out) {
      refuseField(422, refusals.signInBeforePreviousOut(previousDay), 'claimed_in');
    }
  }
  if (claim.correction_type === 'missed_out' && instants.out && today?.recorded_in) {
    if (!(instants.out > today.recorded_in)) {
      refuseField(422, refusals.claimedOutAfterRecordedIn, 'claimed_out');
    }
  }
  if (claim.correction_type === 'night_shift' && instants.out && next?.recorded_in) {
    if (instants.out > next.recorded_in) {
      refuseField(422, refusals.nightShiftAfterNextIn(nextDay), 'claimed_out');
    }
  }
}

function checkClaimedTimesOccur(claim) {
  if (claim.claimed_in && businessInstant(claim.day, claim.claimed_in) === null) {
    refuseField(422, refusals.timeDoesNotOccur(claim.claimed_in, claim.day), 'claimed_in');
  }
  if (claim.claimed_out) {
    const day = claimedOutDay(claim.correction_type, claim.day);
    if (businessInstant(day, claim.claimed_out) === null) {
      refuseField(422, refusals.timeDoesNotOccur(claim.claimed_out, day), 'claimed_out');
    }
  }
}

function checkRaiseFields(body) {
  checkUnpublishedKeys(body, RAISE_FIELDS);

  checkNoNul(body.day, 'day');
  if (isMissing(body, 'day')) refuseField(400, refusals.missingField('day'), 'day');
  if (!isBusinessDay(body.day)) refuseField(400, refusals.dayFormat, 'day');

  checkNoNul(body.correction_type, 'correction_type');
  if (isMissing(body, 'correction_type')) refuseField(400, refusals.missingField('correction_type'), 'correction_type');
  if (!CORRECTION_TYPES.includes(body.correction_type)) {
    refuseField(400, refusals.unknownCorrectionType(body.correction_type), 'correction_type');
  }

  const claimed = {};
  for (const field of ['claimed_in', 'claimed_out']) {
    checkNoNul(body[field], field);
    const needed = CLAIM_REQUIREMENTS[body.correction_type].includes(field);
    if (isMissing(body, field)) {
      if (needed) refuseField(400, refusals.missingField(field), field);
      claimed[field] = null;
      continue;
    }
    if (!isClaimTime(body[field])) refuseField(400, refusals.timeFormat(field), field);
    claimed[field] = body[field];
  }

  checkNoNul(body.reason, 'reason');
  if (isMissing(body, 'reason')) refuseField(400, refusals.missingField('reason'), 'reason');
  if (typeof body.reason !== 'string') refuseField(400, refusals.reasonNotText, 'reason');
  const reasonLength = graphemeLength(body.reason);
  if (reasonLength < REASON_MIN) refuseField(400, refusals.reasonTooShort, 'reason');
  if (reasonLength > REASON_MAX) refuseField(422, refusals.reasonTooLong, 'reason');

  if (body.correction_type === 'night_shift') {
    if (!(claimed.claimed_out < claimed.claimed_in)) refuseField(400, refusals.nightShiftOrder, 'claimed_out');
  } else if (claimed.claimed_in && claimed.claimed_out) {
    if (!(claimed.claimed_out > claimed.claimed_in)) refuseField(400, refusals.dayOrder, 'claimed_out');
  }

  return {
    day: body.day,
    correction_type: body.correction_type,
    claimed_in: claimed.claimed_in,
    claimed_out: claimed.claimed_out,
    reason: body.reason,
  };
}

function sameRaiseValues(row, body) {
  return (
    row.day === body.day &&
    row.correction_type === body.correction_type &&
    (row.claimed_in ?? null) === (isMissing(body, 'claimed_in') ? null : body.claimed_in) &&
    (row.claimed_out ?? null) === (isMissing(body, 'claimed_out') ? null : body.claimed_out) &&
    row.reason === body.reason
  );
}

/** Raises a correction, the refusals running in the published order and creating nothing. */
export async function raiseRequest(caller, body, idempotencyKey) {
  if (caller.role === 'admin') refuse(403, refusals.adminDoesNotRaise);

  if (idempotencyKey !== undefined && idempotencyKey !== null) {
    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      refuseField(400, refusals.idempotencyKeyFormat, 'Idempotency-Key');
    }
    const existing = await pool.query(
      `${REQUEST_SELECT} WHERE r.person_id = $1 AND r.idempotency_key = $2`,
      [caller.id, idempotencyKey],
    );
    const row = existing.rows[0];
    if (row) {
      if (!sameRaiseValues(row, body)) refuse(422, refusals.idempotencyKeyReused);
      return { replayed: true, request: requestObject(row) };
    }
  }

  const claim = checkRaiseFields(body);
  const policy = await policyInForce();
  const site = await employer();

  if (!policy.enabled_types.includes(claim.correction_type)) refuse(422, refusals.typeNotAccepted);
  if (!dayIsInsideWindow(claim.day, site.seeded_on, policy.lookback_days)) {
    refuse(422, refusals.outsideWindow(policy.lookback_days));
  }
  checkClaimedTimesOccur(claim);

  return transaction(async (client) => {
    await checkClaimAgainstRecord(client, { ...claim, person_id: caller.id });

    const leave = await client.query(
      "SELECT 1 FROM leave_day WHERE person_id = $1 AND day = $2 AND status = 'approved'",
      [caller.id, claim.day],
    );
    if (leave.rows.length > 0) refuse(422, refusals.approvedLeave(claim.day));

    const waiting = await client.query(
      "SELECT 1 FROM regularisation_request WHERE person_id = $1 AND day = $2 AND state = 'pending'",
      [caller.id, claim.day],
    );
    if (waiting.rows.length > 0) refuse(409, refusals.alreadyWaiting(claim.day));

    const used = await capUsedForRaise(client, caller.id, claim.day);
    if (used >= policy.monthly_cap) {
      refuse(422, refusals.raiseCap(used, policy.monthly_cap, monthOf(claim.day)));
    }

    const created = await client.query(
      `INSERT INTO regularisation_request
         (person_id, day, correction_type, claimed_in, claimed_out, reason, state, raised_at, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', date_trunc('second', now()), $7)
       RETURNING id`,
      [
        caller.id,
        claim.day,
        claim.correction_type,
        claim.claimed_in,
        claim.claimed_out,
        claim.reason,
        idempotencyKey ?? null,
      ],
    );
    const stored = await client.query(`${REQUEST_SELECT} WHERE r.id = $1`, [created.rows[0].id]);
    return { replayed: false, request: requestObject(stored.rows[0]) };
  }).catch(async (error) => {
    if (error.code !== '23505') throw error;
    if (error.constraint === 'regularisation_request_idempotency_key') {
      const row = await oneRequestByKey(caller.id, idempotencyKey);
      if (row && sameRaiseValues(row, body)) return { replayed: true, request: requestObject(row) };
      throw new Refusal(422, refusals.idempotencyKeyReused);
    }
    throw new Refusal(409, refusals.alreadyWaiting(claim.day));
  });
}

async function oneRequestByKey(personId, key) {
  const result = await pool.query(`${REQUEST_SELECT} WHERE r.person_id = $1 AND r.idempotency_key = $2`, [
    personId,
    key,
  ]);
  return result.rows[0] ?? null;
}

function checkDecisionFields(body, policy) {
  checkUnpublishedKeys(body, DECISION_FIELDS);
  if (body.outcome !== 'approve' && body.outcome !== 'reject') refuseField(400, refusals.outcomeValue, 'outcome');

  checkNoNul(body.note, 'note');
  const note = isMissing(body, 'note') ? null : body.note;
  if (note !== null && typeof note !== 'string') refuseField(400, refusals.noteNotText, 'note');
  if (note !== null && graphemeLength(note) > NOTE_MAX) refuseField(400, refusals.noteTooLong, 'note');
  if (body.outcome === 'reject' && (note === null || graphemeLength(note) < REJECTION_NOTE_MIN)) {
    refuseField(400, refusals.rejectionNeedsNote, 'note');
  }
  if (body.outcome === 'approve' && policy.require_note_on_approve && (note === null || note === '')) {
    refuseField(400, refusals.approvalNeedsNote, 'note');
  }
  return { outcome: body.outcome, note };
}

/** A decision: its checks, the re-check, the state change, the write and the trail, together. */
export async function decideRequest(caller, id, body) {
  return transaction(async (client) => {
    const row = await requestInScope(client, caller, id);
    if (row.person_id === caller.id) refuse(403, refusals.selfDecision);
    if (caller.role === 'admin') refuse(403, refusals.adminDoesNotDecide);

    await lock(client, LOCKS.raiserApprovals, row.person_id);
    const locked = await client.query(`${REQUEST_SELECT} WHERE r.id = $1 FOR UPDATE OF r`, [id]);
    const fresh = locked.rows[0];
    if (fresh.state !== 'pending') {
      if (fresh.state === 'cancelled') refuse(409, refusals.withdrawnNoDecision);
      throw new Refusal(409, alreadyDecidedWording(fresh.decided_by_name, fresh.decided_at), {
        decided_by: fresh.decided_by_name,
        decided_at: utcSeconds(fresh.decided_at),
      });
    }

    const policy = await policyInForce(client);
    const site = await employer(client);
    const decision = checkDecisionFields(body, policy);

    if (decision.outcome === 'approve') {
      if (!dayIsInsideWindow(fresh.day, site.seeded_on, policy.lookback_days)) {
        refuse(422, refusals.outsideWindow(policy.lookback_days));
      }
      const used = await capUsedForApproval(client, fresh.person_id, fresh.day, fresh.id);
      if (used >= policy.monthly_cap) {
        refuse(422, refusals.approvalCap(fresh.person_name, used, policy.monthly_cap, monthOf(fresh.day)));
      }
      await checkClaimAgainstRecord(client, fresh);
    }

    const decidedAt = truncateToSecond(new Date());
    const state = decision.outcome === 'approve' ? 'approved' : 'rejected';
    await client.query(
      'UPDATE regularisation_request SET state = $2, decided_by = $3, decided_at = $4, decision_note = $5 WHERE id = $1',
      [fresh.id, state, caller.id, decidedAt, decision.note],
    );
    if (state === 'approved') await writeApprovedAttendance(client, fresh);
    await appendAuditEntry(client, {
      request_id: fresh.id,
      actor_id: caller.id,
      actor_role: 'manager',
      verb: state === 'approved' ? 'approved' : 'rejected',
      subject_type: 'request',
      subject_id: fresh.id,
      occurred_at: decidedAt,
      note: decision.note,
    });

    const after = await client.query(`${REQUEST_SELECT} WHERE r.id = $1`, [fresh.id]);
    return requestObject(after.rows[0]);
  });
}

/** A withdrawal by the person who raised it, freeing that day to claim again. */
export async function cancelRequest(caller, id, body) {
  return transaction(async (client) => {
    const row = await requestInScope(client, caller, id);
    if (row.person_id !== caller.id) refuse(403, refusals.onlyRaiserWithdraws);

    const locked = await client.query(`${REQUEST_SELECT} WHERE r.id = $1 FOR UPDATE OF r`, [id]);
    const fresh = locked.rows[0];
    if (fresh.state !== 'pending') refuse(409, refusals.notPendingWithdraw(fresh.state));

    checkUnpublishedKeys(body, []);
    await client.query("UPDATE regularisation_request SET state = 'cancelled' WHERE id = $1", [fresh.id]);
    const after = await client.query(`${REQUEST_SELECT} WHERE r.id = $1`, [fresh.id]);
    return requestObject(after.rows[0]);
  });
}
