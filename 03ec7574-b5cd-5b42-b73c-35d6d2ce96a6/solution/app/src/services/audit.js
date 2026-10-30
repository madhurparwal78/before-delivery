import { canonicalJson, hmacBase64, iso, newId, sha256Hex, toDate } from '../lib/core.js';

const ZERO = '0'.repeat(64);
const SIGNED_TYPES = new Set(['intent.created', 'intent.approved', 'intent.rejected', 'intent.cancelled',
  'intent.executed', 'intent.expired', 'transfer.denied', 'deposit.received']);

// The organization row is the serialisation point for its audit chain, its signed log and its secret.
export async function lockOrg(client, orgId) {
  const { rows } = await client.query('SELECT * FROM organizations WHERE id = $1 FOR UPDATE', [orgId]);
  return rows[0];
}

export function actorOf(caller) {
  return caller.apiKey ? `api_key:${caller.apiKey.prefix}` : caller.member.email;
}

// The audit hash: SHA-256 of the previous hash followed by the canonical event object.
export function eventHash(prevHash, event) {
  const { seq, type, actor, subject_id: subjectId, at, data } = event;
  return sha256Hex(prevHash + canonicalJson({ seq, type, actor, subject_id: subjectId, at, data }));
}

// The event signature: v1, then the base64 HMAC-SHA256 of id.timestamp.body under the signing secret.
export function eventSignature(secret, id, timestamp, body) {
  return `v1,${hmacBase64(secret, `${id}.${timestamp}.${body}`)}`;
}

// Appends one audit event, and for payment types one signed event, inside the caller's transaction.
// at is a unix second.
export async function record(client, orgId, { type, actor, subjectId, data, at }) {
  const org = await lockOrg(client, orgId);
  const last = await client.query(
    'SELECT seq, hash FROM audit_events WHERE organization_id = $1 ORDER BY seq DESC LIMIT 1', [orgId]);
  const seq = last.rows.length ? last.rows[0].seq + 1 : 1;
  const prevHash = last.rows.length ? last.rows[0].hash : ZERO;
  const event = { seq, type, actor, subject_id: subjectId, at: iso(toDate(at)), data };
  await client.query(
    `INSERT INTO audit_events (organization_id, seq, type, actor, subject_id, at, data, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [orgId, seq, type, actor, subjectId, toDate(at), JSON.stringify(data), prevHash, eventHash(prevHash, event)]);
  if (SIGNED_TYPES.has(type)) await sign(client, org, type, data, at);
}

async function sign(client, org, type, data, at) {
  const last = await client.query(
    'SELECT seq FROM webhook_events WHERE organization_id = $1 ORDER BY seq DESC LIMIT 1', [org.id]);
  const seq = last.rows.length ? last.rows[0].seq + 1 : 1;
  const id = newId('evt');
  const body = JSON.stringify({ id, type, created_at: iso(toDate(at)), data });
  await client.query(
    `INSERT INTO webhook_events (id, organization_id, seq, type, created_at, timestamp, body, signature)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, org.id, seq, type, toDate(at), at, body, eventSignature(org.webhook_secret, id, at, body)]);
}

export function auditView(row) {
  return { seq: row.seq, type: row.type, actor: row.actor, subject_id: row.subject_id, at: iso(row.at),
    data: row.data, prev_hash: row.prev_hash, hash: row.hash };
}

export function signedView(row) {
  return { id: row.id, seq: row.seq, type: row.type, created_at: iso(row.created_at), timestamp: Number(row.timestamp),
    body: row.body, signature: row.signature };
}

// Recomputes an organization's chain and names the lowest seq that breaks it.
export async function verifyChain(db, orgId) {
  const { rows } = await db.query('SELECT * FROM audit_events WHERE organization_id = $1 ORDER BY seq', [orgId]);
  let prev = null;
  let broken = null;
  for (const row of rows) {
    const event = auditView(row);
    const expectedSeq = prev ? prev.seq + 1 : 1;
    const expectedPrev = prev ? prev.hash : ZERO;
    if (event.seq !== expectedSeq || event.prev_hash !== expectedPrev || eventHash(event.prev_hash, event) !== event.hash) {
      broken = event.seq;
      break;
    }
    prev = event;
  }
  return { valid: broken === null, events: rows.length, first_broken_seq: broken };
}

export async function auditPage(db, orgId, query) {
  const { rows } = await db.query(
    'SELECT * FROM audit_events WHERE organization_id = $1 AND seq > $2 ORDER BY seq LIMIT $3',
    [orgId, query.afterSeq, query.limit]);
  return rows.map(auditView);
}

export async function signedPage(db, orgId, query) {
  const { rows } = await db.query(
    'SELECT * FROM webhook_events WHERE organization_id = $1 AND seq > $2 ORDER BY seq LIMIT $3',
    [orgId, query.afterSeq, query.limit]);
  return rows.map(signedView);
}
