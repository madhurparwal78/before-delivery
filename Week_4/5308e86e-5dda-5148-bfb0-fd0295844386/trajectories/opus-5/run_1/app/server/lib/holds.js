'use strict';

// Approval expiry. A hold is released exactly once, by the decision or expiry
// that ends it. Every caller runs inside a transaction holding the company
// lock, so a payment is expired exactly once.

const clock = require('./clock');
const audit = require('./audit');

async function expirePayment(client, companyId, payment) {
  const updated = await client.query(
    `UPDATE payments SET status = 'expired'
      WHERE id = $1 AND status = 'pending_approval'
      RETURNING id`,
    [payment.id]
  );
  if (updated.rows.length === 0) return false;
  await audit.writeEvent(client, {
    companyId,
    action: 'payment.expired',
    paymentId: payment.id,
    amountCents: Number(payment.amount_cents),
    actorEmail: audit.SYSTEM_ACTOR,
  });
  return true;
}

function isDue(payment, nowMs = clock.nowMs()) {
  return (
    payment.status === 'pending_approval' &&
    payment.expires_at !== null &&
    new Date(payment.expires_at).getTime() <= nowMs
  );
}

// A decision arriving at or after the expiry instant records the expiry first.
async function expireIfDue(client, companyId, payment) {
  if (!isDue(payment)) return false;
  await expirePayment(client, companyId, payment);
  return true;
}

async function expireDuePaymentsOfRecipient(client, companyId, recipientId) {
  const due = await client.query(
    `SELECT id, amount_cents, status, expires_at FROM payments
      WHERE company_id = $1 AND recipient_id = $2 AND status = 'pending_approval'
        AND expires_at <= $3
      FOR UPDATE`,
    [companyId, recipientId, clock.now()]
  );
  for (const payment of due.rows) await expirePayment(client, companyId, payment);
  return due.rows.length;
}

module.exports = { expirePayment, expireIfDue, expireDuePaymentsOfRecipient, isDue };
