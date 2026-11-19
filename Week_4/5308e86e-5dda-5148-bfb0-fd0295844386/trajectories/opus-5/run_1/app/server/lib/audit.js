'use strict';

// The company's hash-chained audit trail. Every money movement and payment
// state change writes exactly one event, in the same transaction as the change.

const crypto = require('crypto');
const db = require('./db');
const clock = require('./clock');

const ZERO_HASH = '0'.repeat(64);
const SYSTEM_ACTOR = 'system@tallwind.invalid';

function chainHash(prevHash, seq, action, paymentId, amountCents, actorEmail) {
  const material = [prevHash, seq, action, paymentId || '', amountCents, actorEmail].join('|');
  return crypto.createHash('sha256').update(material, 'utf8').digest('hex');
}

// The caller holds the company lock, so seq counts with no gaps.
async function writeEvent(client, { companyId, action, paymentId = null, amountCents, actorEmail }) {
  const previous = await client.query(
    'SELECT seq, hash FROM audit_events WHERE company_id = $1 ORDER BY seq DESC LIMIT 1',
    [companyId]
  );
  const prevHash = previous.rows.length ? previous.rows[0].hash : ZERO_HASH;
  const seq = previous.rows.length ? Number(previous.rows[0].seq) + 1 : 1;
  const amount = Number(amountCents);
  const hash = chainHash(prevHash, seq, action, paymentId, amount, actorEmail);
  await client.query(
    `INSERT INTO audit_events
       (id, company_id, seq, action, payment_id, amount_cents, actor_email, prev_hash, hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [db.newId(), companyId, seq, action, paymentId, amount, actorEmail, prevHash, hash, clock.now()]
  );
}

module.exports = { writeEvent, chainHash, ZERO_HASH, SYSTEM_ACTOR };
