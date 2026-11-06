import { isUniqueViolation, one, rows, tx } from "./db.mjs";
import {
  WORDING, fieldRefusal, hasNul, isMissing, nulRefusal, onlyPublished, pathId, refuse, required,
} from "./http.mjs";
import { currentPolicy, seededOn } from "./policy.mjs";
import { QUEUE_PARAMS, queueValues } from "./queue-query.mjs";
import {
  CORRECTION_TYPES, STATES, claimAgainstRecord, projectLeaveKind, requiredTimes, windowRefusal,
} from "./rules.mjs";
import { appendAudit, auditEntries } from "./audit.mjs";
import { requestScope } from "./scope.mjs";
import { fold, foldedColumn, graphemeCount } from "./text.mjs";
import { addDays, businessDate, isRealDay, isRealMonth, monthOf, stamp } from "./time.mjs";

const PAGE_SIZE = 25;
const SORTS = {
  waiting: "(r.state <> 'pending'), r.raised_at, r.id",
  day: "r.day DESC, r.id",
  raised: "r.raised_at, r.id",
  person: `lower(p.name) COLLATE "C", r.id`,
};
const RAISE_FIELDS = ["day", "correction_type", "claimed_in", "claimed_out", "reason"];
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

const COLUMNS = `r.id, r.person_id, p.name AS person, p.work_address, m.name AS manager, r.day, r.correction_type,
  r.claimed_in, r.claimed_out, r.reason, r.state, r.raised_at, d.name AS decided_by, r.decided_at, r.decision_note`;
const FROM = `regularisation_request r JOIN person p ON p.id = r.person_id
  LEFT JOIN person m ON m.id = p.manager_id LEFT JOIN person d ON d.id = r.decided_by`;

const noRequest = () => refuse(404, WORDING.noRequest);

function requestObject(row) {
  return {
    id: Number(row.id),
    person: row.person,
    work_address: row.work_address,
    manager: row.manager,
    day: row.day,
    correction_type: row.correction_type,
    claimed_in: row.claimed_in,
    claimed_out: row.claimed_out,
    reason: row.reason,
    state: row.state,
    raised_at: stamp(row.raised_at),
    decided_by: row.decided_by,
    decided_at: stamp(row.decided_at),
    decision_note: row.decision_note,
  };
}

async function readRequest(id, client) {
  return requestObject(await one(`SELECT ${COLUMNS} FROM ${FROM} WHERE r.id = $1`, [id], client));
}

/** The queue query, checked in the published order; answers the first value of each parameter. */
export function readQueueQuery(search) {
  const values = queueValues(search);
  for (const name of QUEUE_PARAMS) {
    const value = values[name];
    if (value === undefined) continue;
    if (hasNul(value)) throw nulRefusal(name);
    if (name === "q") {
      if (value.trim().length > 100) throw fieldRefusal(400, "q", "Search is limited to 100 characters.");
      continue;
    }
    const accepted = {
      state: () => STATES.includes(value),
      type: () => CORRECTION_TYPES.includes(value),
      person: () => true,
      month: () => isRealMonth(value),
      sort: () => value !== "waiting" && value in SORTS,
      page: () => /^[1-9][0-9]*$/.test(value),
    }[name];
    if (!accepted()) throw fieldRefusal(400, name, `Unknown ${name} value: ${value}.`);
  }
  return values;
}

/** `GET /api/requests`: the caller's scope first, then the filters, one page in a total order. */
export async function queue(caller, values) {
  const params = [caller.id];
  const filters = [];
  const add = (sql, value) => {
    params.push(value);
    filters.push(sql.replace("?", `$${params.length}`));
  };
  if (values.state) add("r.state = ?", values.state);
  if (values.type) add("r.correction_type = ?", values.type);
  if (values.person) add(`${foldedColumn("p.work_address")} = ?`, fold(values.person));
  if (values.month) add("to_char(r.day, 'YYYY-MM') = ?", values.month);
  if (values.q?.trim()) add("strpos(lower(r.reason), lower(?)) > 0", values.q.trim());
  const scope = requestScope(caller, "p", 1);
  const narrowed = filters.length ? filters.join(" AND ") : "true";
  const counts = await one(
    `SELECT count(*)::int AS total, (count(*) FILTER (WHERE ${narrowed}))::int AS matched FROM ${FROM} WHERE ${scope}`,
    params);
  const pages = Math.max(1, Math.ceil(counts.matched / PAGE_SIZE));
  const page = Math.min(Number(values.page ?? 1), pages);
  const found = await rows(
    `SELECT ${COLUMNS}, a.recorded_in, a.recorded_out FROM ${FROM}
       LEFT JOIN attendance_day a ON a.person_id = r.person_id AND a.day = r.day
      WHERE ${scope} AND ${narrowed} ORDER BY ${SORTS[values.sort ?? "waiting"]}
      LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`, params);
  return {
    rows: found.map((row) => ({
      ...requestObject(row),
      recorded_in: stamp(row.recorded_in),
      recorded_out: stamp(row.recorded_out),
    })),
    matched: counts.matched,
    total: counts.total,
    page,
    pages,
  };
}

/** The people whose requests the caller may see, by name: the queue's person filter. */
export function scopePeople(caller) {
  return rows(`SELECT p.name, p.work_address FROM person p WHERE ${requestScope(caller, "p", 1)} ORDER BY p.name COLLATE "C"`,
    [caller.id]);
}

/** The trail of each request, oldest first, keyed by request id. */
export async function trails(ids) {
  const entries = await auditEntries("e.request_id = ANY($1)", [ids], "e.seq");
  return Object.groupBy(entries, (entry) => entry.request_id);
}

/** A raiser's contact on file reaches people operations' request detail and no other reader. */
async function projectContact(reader, raiserId) {
  if (reader.role !== "admin") return null;
  return one("SELECT phone, private_note FROM person WHERE id = $1", [raiserId]);
}

/**
 * `GET /api/requests/<id>`: the request, that day's attendance, the leave as the reader may see it, the trail, and
 * the raiser's contact on file for people operations only.
 */
export async function detail(caller, segment) {
  const id = pathId(segment);
  const row = id && await one(`SELECT ${COLUMNS} FROM ${FROM} WHERE r.id = $2 AND ${requestScope(caller, "p", 1)}`,
    [caller.id, id]);
  if (!row) throw noRequest();
  const [attendance, leave, audit, contact] = await Promise.all([
    one("SELECT recorded_in, recorded_out, source FROM attendance_day WHERE person_id = $1 AND day = $2",
      [row.person_id, row.day]),
    one("SELECT kind, status FROM leave_day WHERE person_id = $1 AND day = $2", [row.person_id, row.day]),
    auditEntries("e.request_id = $1", [id], "e.seq"),
    projectContact(caller, row.person_id),
  ]);
  return {
    request: requestObject(row),
    evidence: {
      recorded_in: stamp(attendance?.recorded_in),
      recorded_out: stamp(attendance?.recorded_out),
      source: attendance?.source ?? null,
    },
    leave: leave ? { kind: projectLeaveKind(leave.kind, caller, row.person_id), status: leave.status } : null,
    audit,
    ...(contact && { contact }),
  };
}

async function attendanceAround(client, personId, day) {
  const found = await rows(
    "SELECT day, recorded_in, recorded_out FROM attendance_day WHERE person_id = $1 AND day BETWEEN $2 AND $3",
    [personId, addDays(day, -1), addDays(day, 1)], client);
  return Object.fromEntries(found.map((row) => [row.day, row]));
}

/** Serialise every raise and approval for one person. */
async function lockPerson(client, personId) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('rostara.person'), $1)", [personId]);
}

function checkRaiseFields(body) {
  onlyPublished(body, RAISE_FIELDS);
  const { day, correction_type: type, reason } = body;
  if (hasNul(day)) throw nulRefusal("day");
  if (isMissing(body, "day")) throw required("day");
  if (!isRealDay(day)) throw fieldRefusal(400, "day", "day must read YYYY-MM-DD.");
  if (hasNul(type)) throw nulRefusal("correction_type");
  if (isMissing(body, "correction_type")) throw required("correction_type");
  if (!CORRECTION_TYPES.includes(type)) {
    throw fieldRefusal(400, "correction_type", `Unknown correction type: ${type}.`);
  }
  for (const field of ["claimed_in", "claimed_out"]) {
    if (hasNul(body[field])) throw nulRefusal(field);
    if (isMissing(body, field)) {
      if (requiredTimes(type).includes(field)) throw required(field);
    } else if (typeof body[field] !== "string" || !CLOCK.test(body[field])) {
      throw fieldRefusal(400, field, `${field} must read HH:MM.`);
    }
  }
  if (hasNul(reason)) throw nulRefusal("reason");
  if (isMissing(body, "reason")) throw required("reason");
  if (typeof reason !== "string") throw fieldRefusal(400, "reason", "reason must be text.");
  const length = graphemeCount(reason);
  if (length < 20) throw fieldRefusal(400, "reason", "A reason needs at least twenty characters.");
  if (length > 280) throw fieldRefusal(422, "reason", "A reason is limited to 280 characters.");
  const claim = {
    day,
    correction_type: type,
    claimed_in: body.claimed_in ?? null,
    claimed_out: body.claimed_out ?? null,
    reason,
  };
  if (claim.claimed_in && claim.claimed_out) {
    if (type === "night_shift" && !(claim.claimed_out < claim.claimed_in)) {
      throw fieldRefusal(400, "claimed_out", "A night shift must end on the following day.");
    }
    if (type !== "night_shift" && !(claim.claimed_out > claim.claimed_in)) {
      throw fieldRefusal(400, "claimed_out", "The sign-out must come after the sign-in.");
    }
  }
  return claim;
}

function sameClaim(stored, body) {
  return stored.day === body.day && stored.correction_type === body.correction_type
    && stored.claimed_in === (body.claimed_in ?? null) && stored.claimed_out === (body.claimed_out ?? null)
    && stored.reason === body.reason;
}

/** The raise cap count: the person's approved and waiting corrections in the month of `day`. */
async function waitingOrApproved(client, personId, day) {
  return (await one(
    `SELECT count(*)::int AS used FROM regularisation_request
      WHERE person_id = $1 AND state IN ('approved', 'pending') AND to_char(day, 'YYYY-MM') = $2`,
    [personId, monthOf(day)], client)).used;
}

/** The approval cap count: the person's approved corrections in the month of `day`. */
async function approvedIn(client, personId, day) {
  return (await one(
    `SELECT count(*)::int AS used FROM regularisation_request
      WHERE person_id = $1 AND state = 'approved' AND to_char(day, 'YYYY-MM') = $2`,
    [personId, monthOf(day)], client)).used;
}

/**
 * `POST /api/requests`, in the published order. Answers `{status, request, replayed}`.
 * @param {string | undefined} key the Idempotency-Key header, undefined when absent
 */
export async function raise(caller, body, key) {
  if (caller.role === "admin") throw refuse(403, "People operations does not raise corrections.");
  if (key !== undefined && !/^[\x21-\x7e]{1,64}$/.test(key)) {
    throw fieldRefusal(400, "Idempotency-Key", "Idempotency-Key must be 1 to 64 visible characters.");
  }
  const replay = async () => {
    const stored = key !== undefined
      && await one("SELECT * FROM regularisation_request WHERE person_id = $1 AND idempotency_key = $2", [caller.id, key]);
    if (!stored) return null;
    if (!sameClaim(stored, body)) throw refuse(422, "That idempotency key was already used for a different correction.");
    return { status: 200, request: await readRequest(stored.id), replayed: true };
  };
  const repeated = await replay();
  if (repeated) return repeated;
  const claim = checkRaiseFields(body);
  try {
    return await tx(async (client) => {
      await lockPerson(client, caller.id);
      const policy = await currentPolicy(client);
      if (!policy.enabled_types.includes(claim.correction_type)) {
        throw refuse(422, "That correction type is not currently accepted.");
      }
      const window = windowRefusal(claim.day, await seededOn(client), policy.lookback_days);
      if (window) throw window;
      claimAgainstRecord(claim, await attendanceAround(client, caller.id, claim.day));
      if (await one("SELECT 1 FROM leave_day WHERE person_id = $1 AND day = $2 AND status = 'approved'",
        [caller.id, claim.day], client)) {
        throw refuse(422, `You were on approved leave on ${claim.day}.`);
      }
      if (await one("SELECT 1 FROM regularisation_request WHERE person_id = $1 AND day = $2 AND state = 'pending'",
        [caller.id, claim.day], client)) {
        throw refuse(409, `You already have a correction waiting on ${claim.day}.`);
      }
      const used = await waitingOrApproved(client, caller.id, claim.day);
      if (used >= policy.monthly_cap) {
        throw refuse(422,
          `You have ${used} of ${policy.monthly_cap} corrections approved or waiting in ${monthOf(claim.day)}.`);
      }
      const { id } = await one(
        `INSERT INTO regularisation_request (person_id, day, correction_type, claimed_in, claimed_out, reason, state,
           raised_at, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', date_trunc('second', now()), $7) RETURNING id`,
        [caller.id, claim.day, claim.correction_type, claim.claimed_in, claim.claimed_out, claim.reason, key ?? null],
        client);
      return { status: 201, request: await readRequest(id, client), replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error, "regularisation_request_idempotency_key")) return replay();
    if (isUniqueViolation(error, "regularisation_request_one_pending")) {
      throw refuse(409, `You already have a correction waiting on ${claim.day}.`);
    }
    throw error;
  }
}

function checkNote(body, outcome, policy) {
  const { note } = body;
  if (hasNul(note)) throw nulRefusal("note");
  if (note !== undefined && note !== null && typeof note !== "string") {
    throw fieldRefusal(400, "note", "note must be text.");
  }
  const length = typeof note === "string" ? graphemeCount(note) : 0;
  if (length > 500) throw fieldRefusal(400, "note", "A note is limited to 500 characters.");
  if (outcome === "reject" && length < 10) {
    throw fieldRefusal(400, "note", "A rejection needs a note of at least ten characters.");
  }
  if (outcome === "approve" && policy.require_note_on_approve && length === 0) {
    throw fieldRefusal(400, "note", "This policy requires a note when approving.");
  }
  return note ?? null;
}

/** Lock one request in the caller's scope for the rest of the transaction, or answer the unknown-id 404. */
async function lockInScope(client, caller, segment) {
  const id = pathId(segment);
  const row = id && await one(
    `SELECT r.*, p.name AS raiser FROM regularisation_request r JOIN person p ON p.id = r.person_id
      WHERE r.id = $2 AND ${requestScope(caller, "p", 1)} FOR UPDATE OF r`, [caller.id, id], client);
  if (!row) throw noRequest();
  return row;
}

/** `POST /api/requests/<id>/decision`: checks, re-check, state change, attendance write and audit in one transaction. */
export function decide(caller, segment, body) {
  return tx(async (client) => {
    const row = await lockInScope(client, caller, segment);
    if (row.person_id === caller.id) throw refuse(403, "You cannot decide a request you raised.");
    if (caller.role === "admin") throw refuse(403, "People operations does not decide requests.");
    if (row.state === "approved" || row.state === "rejected") {
      const decider = await one("SELECT name FROM person WHERE id = $1", [row.decided_by], client);
      throw refuse(409, `${decider.name} already decided this on ${businessDate(row.decided_at)}.`, {
        decided_by: decider.name,
        decided_at: stamp(row.decided_at),
      });
    }
    if (row.state === "cancelled") throw refuse(409, "This request was withdrawn and can no longer be decided.");
    onlyPublished(body, ["outcome", "note"]);
    const { outcome } = body;
    if (outcome !== "approve" && outcome !== "reject") {
      throw fieldRefusal(400, "outcome", "outcome must be approve or reject.");
    }
    const policy = await currentPolicy(client);
    const note = checkNote(body, outcome, policy);
    if (outcome === "approve") {
      await lockPerson(client, row.person_id);
      const window = windowRefusal(row.day, await seededOn(client), policy.lookback_days);
      if (window) throw window;
      const used = await approvedIn(client, row.person_id, row.day);
      if (used >= policy.monthly_cap) {
        throw refuse(422, `${row.raiser} has used ${used} of ${policy.monthly_cap} corrections in ${monthOf(row.day)}.`);
      }
      const { signIn, signOut } = claimAgainstRecord(row, await attendanceAround(client, row.person_id, row.day));
      await client.query(
        `INSERT INTO attendance_day (person_id, day, recorded_in, recorded_out, source)
         VALUES ($1, $2, $3, $4, 'regularisation')
         ON CONFLICT (person_id, day) DO UPDATE SET
           recorded_in = coalesce(EXCLUDED.recorded_in, attendance_day.recorded_in),
           recorded_out = coalesce(EXCLUDED.recorded_out, attendance_day.recorded_out),
           source = 'regularisation'`,
        [row.person_id, row.day, signIn === undefined ? null : new Date(signIn),
          signOut === undefined ? null : new Date(signOut)]);
    }
    await client.query(
      `UPDATE regularisation_request SET state = $2, decided_by = $3, decided_at = date_trunc('second', now()),
         decision_note = $4 WHERE id = $1`,
      [row.id, outcome === "approve" ? "approved" : "rejected", caller.id, note]);
    await appendAudit(client, {
      requestId: row.id, actorId: caller.id, actorRole: caller.role, verb: outcome === "approve" ? "approved" : "rejected",
      subjectType: "request", subjectId: row.id, note,
    });
    return readRequest(row.id, client);
  });
}

/** `POST /api/requests/<id>/cancel`: only the raiser, only while pending. */
export function cancel(caller, segment, body) {
  return tx(async (client) => {
    const row = await lockInScope(client, caller, segment);
    if (row.person_id !== caller.id) throw refuse(403, "Only the person who raised a request can withdraw it.");
    if (row.state !== "pending") {
      throw refuse(409, `This request is already ${row.state} and can no longer be withdrawn.`);
    }
    onlyPublished(body ?? {}, []);
    await client.query("UPDATE regularisation_request SET state = 'cancelled' WHERE id = $1", [row.id]);
    return readRequest(row.id, client);
  });
}

