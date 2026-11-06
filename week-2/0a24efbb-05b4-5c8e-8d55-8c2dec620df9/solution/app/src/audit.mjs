import { createHash } from "node:crypto";
import { rows } from "./db.mjs";
import { refuse } from "./http.mjs";
import { stamp } from "./time.mjs";

// The trail: appended one entry at a time, each entry hashed over its canonical string and chained to the one before.

const GENESIS = "0".repeat(64);
const SEPARATOR = "\u001f";

function auditEntry(row) {
  return {
    id: Number(row.id),
    seq: Number(row.seq),
    request_id: row.request_id === null ? null : Number(row.request_id),
    actor: row.actor,
    actor_role: row.actor_role,
    verb: row.verb,
    subject_type: row.subject_type,
    subject_id: Number(row.subject_id),
    occurred_at: stamp(row.occurred_at),
    note: row.note,
    prev_hash: row.prev_hash,
    entry_hash: row.entry_hash,
  };
}

const SELECT = `SELECT e.*, a.name AS actor FROM audit_event e JOIN person a ON a.id = e.actor_id`;

/** Audit entries matching a condition over `e`, in the given order. */
export async function auditEntries(where, params, order) {
  return (await rows(`${SELECT} WHERE ${where} ORDER BY ${order}`, params)).map(auditEntry);
}

/** The lower-case hex SHA-256 of an entry's canonical string. A null is written as the empty string. */
function entryHash({ seq, occurred_at: at, actor_id: actorId, verb, subject_type: subjectType,
  subject_id: subjectId, note, prev_hash: prevHash }) {
  const canonical = [seq, stamp(at), actorId, verb, subjectType, subjectId, note, prevHash]
    .map((value) => (value == null ? "" : String(value)))
    .join(SEPARATOR);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Append one entry inside the caller's transaction. Appends are taken one at a time, so `seq` stays contiguous and
 * every `prev_hash` names its predecessor; the hashes are stored with the entry and never recomputed on read.
 */
export async function appendAudit(client, {
  requestId = null, actorId, actorRole, verb, subjectType, subjectId, note = null, occurredAt,
}) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('rostara.audit'))");
  const [last] = (await client.query(
    `SELECT seq, entry_hash, date_trunc('second', now()) AS now FROM (SELECT 1) one
       LEFT JOIN LATERAL (SELECT seq, entry_hash FROM audit_event ORDER BY seq DESC LIMIT 1) l ON true`)).rows;
  const entry = {
    seq: Number(last.seq ?? 0) + 1,
    occurred_at: occurredAt ?? last.now,
    actor_id: actorId,
    verb,
    subject_type: subjectType,
    subject_id: subjectId,
    note,
    prev_hash: last.entry_hash ?? GENESIS,
  };
  await client.query(
    `INSERT INTO audit_event (seq, request_id, actor_id, actor_role, verb, subject_type, subject_id, occurred_at, note,
       prev_hash, entry_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [entry.seq, requestId, actorId, actorRole, verb, subjectType, subjectId, entry.occurred_at, note,
      entry.prev_hash, entryHash(entry)]);
}

function onlyPeopleOperations(caller, wording) {
  if (caller.role !== "admin") throw refuse(403, wording);
}

/** `GET /api/audit`: the whole trail, newest first. */
export async function wholeTrail(caller) {
  onlyPeopleOperations(caller, "Only people operations reads the whole trail.");
  return auditEntries("true", [], "e.seq DESC");
}

/** `GET /api/trail/verify`: recompute every entry from its stored values and name the lowest broken `seq`. */
export async function verifyTrail(caller) {
  onlyPeopleOperations(caller, "Only people operations reads the whole trail.");
  const found = await rows("SELECT * FROM audit_event ORDER BY seq");
  let prev = GENESIS;
  for (const row of found) {
    if (row.prev_hash !== prev || entryHash(row) !== row.entry_hash) {
      return { intact: false, entries: found.length, first_broken_seq: Number(row.seq) };
    }
    prev = row.entry_hash;
  }
  return { intact: true, entries: found.length, checked_through: Number(found.at(-1)?.seq ?? 0) };
}

const TRAIL_COLUMNS = ["seq", "at", "actor", "actor_role", "action", "subject_type", "subject_id", "reason", "detail",
  "prev_hash", "entry_hash"];

/** One CSV cell: a formula-leading value is neutralised first, then the cell is quoted when it needs to be. */
function csvCell(value) {
  const text = value == null ? "" : String(value);
  const neutral = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(neutral) ? `"${neutral.replaceAll('"', '""')}"` : neutral;
}

/** `GET /api/trail.csv`: every entry oldest first, every line ending CR LF, no byte-order mark. */
export async function trailCsv(caller) {
  onlyPeopleOperations(caller, "Only people operations exports the trail.");
  const found = await rows(
    `SELECT e.*, a.name AS actor, r.reason FROM audit_event e JOIN person a ON a.id = e.actor_id
       LEFT JOIN regularisation_request r ON e.subject_type = 'request' AND r.id = e.subject_id
      ORDER BY e.seq`);
  const lines = [TRAIL_COLUMNS.join(",")];
  for (const row of found) {
    lines.push([row.seq, stamp(row.occurred_at), row.actor, row.actor_role, row.verb, row.subject_type, row.subject_id,
      row.reason, row.note, row.prev_hash, row.entry_hash].map(csvCell).join(","));
  }
  return lines.map((line) => `${line}\r\n`).join("");
}
