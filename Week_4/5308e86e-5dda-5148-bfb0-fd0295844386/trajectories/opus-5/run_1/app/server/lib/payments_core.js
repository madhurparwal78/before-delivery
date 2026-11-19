'use strict';

// Posting a payment: the debit, its feed row, its effective date, its status
// and its audit event, all in one database transaction.

const clock = require('./clock');
const domain = require('./domain');
const audit = require('./audit');
const settlement = require('./settlement');
const stream = require('./stream');

async function postPayment(client, { companyId, payment, actorEmail, effectiveDate, instantMs }) {
  const totalDebit = Number(payment.total_debit_cents);
  const date = effectiveDate || settlement.effectiveDateForPosting(payment.method, instantMs || clock.nowMs());
  await domain.writeMovement(client, {
    companyId,
    accountId: payment.source_account_id,
    direction: 'debit',
    amountCents: totalDebit,
    method: payment.method,
    counterparty: payment.recipient_name,
    memo: payment.memo === undefined ? null : payment.memo,
  });
  await client.query(
    "UPDATE payments SET status = 'posted', effective_date = $1 WHERE id = $2",
    [date, payment.id]
  );
  await audit.writeEvent(client, {
    companyId,
    action: 'payment.posted',
    paymentId: payment.id,
    amountCents: totalDebit,
    actorEmail,
  });
  stream.poke();
  return date;
}

async function failPayment(client, { companyId, payment }) {
  await client.query("UPDATE payments SET status = 'failed' WHERE id = $1", [payment.id]);
  await audit.writeEvent(client, {
    companyId,
    action: 'payment.failed',
    paymentId: payment.id,
    amountCents: Number(payment.amount_cents),
    actorEmail: audit.SYSTEM_ACTOR,
  });
}

module.exports = { postPayment, failPayment };
