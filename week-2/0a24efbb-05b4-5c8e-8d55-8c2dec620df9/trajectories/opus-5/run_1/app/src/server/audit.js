import { createHash } from 'node:crypto';
import { utcSeconds } from '../shared/businessTime.js';
import { GENESIS_HASH } from '../shared/constants.js';
import { LOCKS, lock } from './db.js';

const UNIT_SEPARATOR = '\u001F';

function decimal(value) {
  return String(Number(value));
}

function nullable(value) {
  return value === null || value === undefined ? '' : String(value);
}

/** The eight values of a trail entry, joined with the unit separator. */
export function canonicalString(entry) {
  return [
    decimal(entry.seq),
    utcSeconds(entry.occurred_at),
    decimal(entry.actor_id),
    entry.verb,
    entry.subject_type,
    decimal(entry.subject_id),
    nullable(entry.note),
    entry.prev_hash,
  ].join(UNIT_SEPARATOR);
}

export function entryHash(entry) {
  return createHash('sha256').update(canonicalString(entry), 'utf8').digest('hex');
}

/**
 * Appends one attributed trail entry inside the caller's transaction.
 * Appends are taken one at a time, so every seq stays contiguous.
 */
export async function appendAuditEntry(client, entry) {
  await lock(client, LOCKS.audit);
  const head = await client.query('SELECT seq, entry_hash FROM audit_event ORDER BY seq DESC LIMIT 1');
  const previous = head.rows[0];
  const seq = previous ? previous.seq + 1 : 1;
  const prevHash = previous ? previous.entry_hash : GENESIS_HASH;
  const full = {
    seq,
    occurred_at: entry.occurred_at,
    actor_id: entry.actor_id,
    verb: entry.verb,
    subject_type: entry.subject_type,
    subject_id: entry.subject_id,
    note: entry.note ?? null,
    prev_hash: prevHash,
  };
  const hash = entryHash(full);
  await client.query(
    `INSERT INTO audit_event (id, seq, request_id, actor_id, actor_role, verb, subject_type, subject_id, occurred_at, note, prev_hash, entry_hash)
     VALUES ($1::bigint, $12::integer, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      seq,
      entry.request_id ?? null,
      entry.actor_id,
      entry.actor_role,
      entry.verb,
      entry.subject_type,
      entry.subject_id,
      entry.occurred_at,
      entry.note ?? null,
      prevHash,
      hash,
      seq,
    ],
  );
  return { ...full, id: seq, request_id: entry.request_id ?? null, actor_role: entry.actor_role, entry_hash: hash };
}

export function auditEntryObject(row, actorName) {
  return {
    id: row.id,
    seq: row.seq,
    request_id: row.request_id,
    actor: actorName,
    actor_role: row.actor_role,
    verb: row.verb,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    occurred_at: utcSeconds(row.occurred_at),
    note: row.note,
    prev_hash: row.prev_hash,
    entry_hash: row.entry_hash,
  };
}

/** Recomputes every entry's canonical string and compares it with the stored hashes. */
export function verifyChain(entries) {
  let expectedPrev = GENESIS_HASH;
  for (const row of entries) {
    const recomputed = entryHash({ ...row, prev_hash: row.prev_hash });
    if (row.prev_hash !== expectedPrev || recomputed !== row.entry_hash) {
      return { intact: false, entries: entries.length, first_broken_seq: row.seq };
    }
    expectedPrev = row.entry_hash;
  }
  return {
    intact: true,
    entries: entries.length,
    checked_through: entries.length === 0 ? 0 : entries[entries.length - 1].seq,
  };
}
