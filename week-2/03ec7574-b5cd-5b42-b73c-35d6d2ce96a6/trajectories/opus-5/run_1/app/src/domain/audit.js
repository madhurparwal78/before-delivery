import { createHash, createHmac } from 'node:crypto';
import { newId } from './ids.js';
import { formatTimestamp, unixSeconds } from './time.js';

export const ZERO_HASH = '0'.repeat(64);

const SIGNED_TYPES = new Set([
  'intent.created',
  'intent.approved',
  'intent.rejected',
  'intent.cancelled',
  'intent.executed',
  'intent.expired',
  'transfer.denied',
  'deposit.received'
]);

export function canonicalJson(value) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function auditEventHash(prevHash, event) {
  return createHash('sha256').update(`${prevHash}${canonicalJson(event)}`, 'utf8').digest('hex');
}

export function signedEventBody({ id, type, createdAt, data }) {
  return `{"id":${JSON.stringify(id)},"type":${JSON.stringify(type)},"created_at":${JSON.stringify(formatTimestamp(createdAt))},"data":${canonicalJson(data)}}`;
}

export function signEventBody({ id, timestamp, body, secret }) {
  const signature = createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(`${id}.${timestamp}.${body}`, 'utf8')
    .digest('base64');
  return `v1,${signature}`;
}

/**
 * Appends one audit event, and the matching signed event for payment types.
 * The caller holds the organization lock, so seq allocation stays gapless.
 */
export async function appendEvent(client, { organizationId, webhookSecret, type, actor, subjectId, at, data }) {
  const previous = await client.query(
    'SELECT seq, hash FROM audit_events WHERE organization_id = $1 ORDER BY seq DESC LIMIT 1',
    [organizationId]
  );
  const seq = previous.rows.length ? Number(previous.rows[0].seq) + 1 : 1;
  const prevHash = previous.rows.length ? previous.rows[0].hash : ZERO_HASH;
  const event = { seq, type, actor, subject_id: subjectId ?? null, at: formatTimestamp(at), data };
  const hash = auditEventHash(prevHash, event);
  await client.query(
    `INSERT INTO audit_events (organization_id, seq, type, actor, subject_id, at, data, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [organizationId, seq, type, actor, subjectId ?? null, at, JSON.stringify(data), prevHash, hash]
  );

  if (SIGNED_TYPES.has(type)) {
    const signedPrevious = await client.query(
      'SELECT seq FROM webhook_events WHERE organization_id = $1 ORDER BY seq DESC LIMIT 1',
      [organizationId]
    );
    const signedSeq = signedPrevious.rows.length ? Number(signedPrevious.rows[0].seq) + 1 : 1;
    const id = newId('evt_');
    const body = signedEventBody({ id, type, createdAt: at, data });
    const timestamp = unixSeconds(at);
    const signature = signEventBody({ id, timestamp, body, secret: webhookSecret });
    await client.query(
      `INSERT INTO webhook_events (id, organization_id, seq, type, created_at, timestamp, body, signature)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, organizationId, signedSeq, type, at, timestamp, body, signature]
    );
  }

  return { seq, hash };
}

export function verifyChain(events) {
  let prevHash = ZERO_HASH;
  let expectedSeq = 1;
  let firstBrokenSeq = null;
  for (const row of events) {
    const seq = Number(row.seq);
    const event = {
      seq,
      type: row.type,
      actor: row.actor,
      subject_id: row.subject_id ?? null,
      at: formatTimestamp(row.at),
      data: row.data
    };
    const broken = seq !== expectedSeq || row.prev_hash !== prevHash || auditEventHash(prevHash, event) !== row.hash;
    if (broken) {
      firstBrokenSeq = seq;
      break;
    }
    prevHash = row.hash;
    expectedSeq = seq + 1;
  }
  return { valid: firstBrokenSeq === null, events: events.length, first_broken_seq: firstBrokenSeq };
}
