import { createHash, createHmac } from 'node:crypto';
import { newId, formatTs } from './core.js';

// Canonical JSON: keys sorted at every depth, separators without spaces,
// non-ASCII written as themselves, UTF-8.
export function canonicalJson(value) {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  }
  return v;
}

export function auditHash(prevHash, event) {
  return createHash('sha256').update(prevHash + canonicalJson(event)).digest('hex');
}

export function eventSignature(secret, id, timestamp, body) {
  const mac = createHmac('sha256', secret).update(`${id}.${timestamp}.${body}`).digest('base64');
  return `v1,${mac}`;
}

const SIGNED_TYPES = new Set([
  'intent.created', 'intent.approved', 'intent.rejected', 'intent.cancelled',
  'intent.executed', 'intent.expired', 'transfer.denied', 'deposit.received',
]);

// Appends one audit event inside the caller's transaction, allocating the seq
// under the organization row lock. `signedData` overrides the signed event's
// data (used by deposit.received).
export async function auditAppend(client, orgId, type, actor, subjectId, at, data, { signed = false, signedData = null } = {}) {
  await client.query('SELECT audit_seq, webhook_seq, webhook_secret FROM organizations WHERE id = $1 FOR UPDATE', [orgId]);
  const { rows: [org] } = await client.query('SELECT audit_seq, webhook_seq, webhook_secret FROM organizations WHERE id = $1', [orgId]);
  const seq = Number(org.audit_seq) + 1;
  const atTs = new Date(Math.floor(at.getTime() / 1000) * 1000);
  const prev = await client.query(
    'SELECT hash FROM audit_events WHERE organization_id = $1 AND seq = $2', [orgId, seq - 1]);
  const prevHash = prev.rows.length ? prev.rows[0].hash : '0'.repeat(64);
  const event = { seq, type, actor, subject_id: subjectId, at: formatTs(atTs), data };
  const hash = auditHash(prevHash, event);
  await client.query(
    `INSERT INTO audit_events (organization_id, seq, type, actor, subject_id, at, data, prev_hash, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [orgId, seq, type, actor, subjectId, atTs, JSON.stringify(data), prevHash, hash]
  );
  await client.query('UPDATE organizations SET audit_seq = $1 WHERE id = $2', [seq, orgId]);

  if (signed && SIGNED_TYPES.has(type)) {
    const wSeq = Number(org.webhook_seq) + 1;
    const id = newId('evt');
    const dataObj = signedData || data;
    const created = formatTs(atTs);
    const body = JSON.stringify({ id, type, created_at: created, data: dataObj });
    const timestamp = Math.floor(atTs.getTime() / 1000);
    const signature = eventSignature(org.webhook_secret, id, timestamp, body);
    await client.query(
      `INSERT INTO webhook_events (id, organization_id, seq, type, created_at, timestamp, body, signature)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, orgId, wSeq, type, atTs, timestamp, body, signature]
    );
    await client.query('UPDATE organizations SET webhook_seq = $1 WHERE id = $2', [wSeq, orgId]);
  }
  return seq;
}

export async function verifyChain(client, orgId) {
  const { rows } = await client.query(
    'SELECT seq, type, actor, subject_id, at, data, prev_hash, hash FROM audit_events WHERE organization_id = $1 ORDER BY seq',
    [orgId]
  );
  let prevHash = '0'.repeat(64);
  let expected = 1;
  for (const r of rows) {
    let broken = false;
    if (Number(r.seq) !== expected || r.prev_hash !== prevHash) broken = true;
    else {
      const at = new Date(r.at);
      const event = {
        seq: Number(r.seq), type: r.type, actor: r.actor, subject_id: r.subject_id,
        at: `${at.toISOString().slice(0, 19)}Z`, data: r.data,
      };
      if (auditHash(r.prev_hash, event) !== r.hash) broken = true;
    }
    if (broken) {
      return { valid: false, events: rows.length, first_broken_seq: Number(r.seq) };
    }
    prevHash = r.hash;
    expected++;
  }
  return { valid: true, events: rows.length, first_broken_seq: null };
}
