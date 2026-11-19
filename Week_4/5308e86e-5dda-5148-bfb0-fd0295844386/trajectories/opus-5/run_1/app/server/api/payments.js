'use strict';

const db = require('../lib/db');
const clock = require('../lib/clock');
const nytime = require('../lib/nytime');
const errors = require('../lib/errors');
const validate = require('../lib/validate');
const domain = require('../lib/domain');
const audit = require('../lib/audit');
const settlement = require('../lib/settlement');
const holds = require('../lib/holds');
const core = require('../lib/payments_core');
const idempotency = require('../lib/idempotency');

const PAYMENT_METHODS = ['ach', 'wire', 'rtp', 'check'];
const MEMO_MAX = 140;

function readMemo(raw, fields, field = 'memo') {
  if (raw === undefined || raw === null) return null;
  const read = validate.readMultiLine(raw);
  if (!read.ok) {
    fields.add(field, 'Keep the memo to 140 characters of plain text');
    return null;
  }
  if (validate.codePointLength(read.value) > MEMO_MAX) {
    fields.add(field, 'Keep the memo to 140 characters of plain text');
    return null;
  }
  return read.value;
}

async function create(ctx) {
  const body = ctx.json();
  const readKeys = {
    source_account_id: body.source_account_id === undefined ? null : body.source_account_id,
    recipient_id: body.recipient_id === undefined ? null : body.recipient_id,
    method: body.method === undefined ? null : body.method,
    amount_cents: body.amount_cents === undefined ? null : body.amount_cents,
    memo: body.memo === undefined ? null : body.memo,
    scheduled_for: body.scheduled_for === undefined ? null : body.scheduled_for,
    fx_quote_id: body.fx_quote_id === undefined ? null : body.fx_quote_id,
  };
  const keyInfo = idempotency.meta({
    companyId: ctx.companyId,
    endpoint: 'POST /api/payments',
    key: ctx.idempotencyKey,
    readKeys,
  });

  return db.transaction(async (client) => {
    await db.lockCompany(client, ctx.companyId);
    const replayed = await idempotency.replay(client, keyInfo);
    if (replayed) return replayed;

    const fields = new validate.FieldErrors();

    // Unknown, malformed, removed or other-company ids answer 404 first.
    let account = null;
    if (body.source_account_id === undefined || body.source_account_id === null) {
      fields.add('source_account_id', 'Choose a source account');
    } else {
      account = await domain.getAccountForUpdate(client, ctx.companyId, body.source_account_id);
    }
    let recipient = null;
    if (body.recipient_id === undefined || body.recipient_id === null) {
      fields.add('recipient_id', 'Choose a recipient');
    } else {
      domain.requireWellFormedId(body.recipient_id);
      const found = await client.query(
        "SELECT * FROM recipients WHERE id = $1 AND company_id = $2 AND status <> 'removed' FOR UPDATE",
        [body.recipient_id, ctx.companyId]
      );
      if (found.rows.length === 0) throw errors.notFound();
      recipient = found.rows[0];
    }
    let quote = null;
    if (body.fx_quote_id !== undefined && body.fx_quote_id !== null) {
      domain.requireWellFormedId(body.fx_quote_id);
      const found = await client.query(
        'SELECT * FROM fx_quotes WHERE id = $1 AND company_id = $2 FOR UPDATE',
        [body.fx_quote_id, ctx.companyId]
      );
      if (found.rows.length === 0) throw errors.notFound();
      quote = found.rows[0];
    }

    if (!PAYMENT_METHODS.includes(body.method)) fields.add('method', 'Choose a method');
    if (!validate.isValidAmountCents(body.amount_cents)) {
      fields.add('amount_cents', 'Enter an amount in cents');
    }
    const memo = readMemo(body.memo, fields);
    if (recipient && recipient.status === 'pending') {
      fields.add('recipient_id', 'This recipient is not active yet');
    }

    let scheduledFor = null;
    if (body.scheduled_for !== undefined && body.scheduled_for !== null) {
      if (typeof body.scheduled_for !== 'string' || !nytime.isDateString(body.scheduled_for)) {
        fields.add('scheduled_for', 'Choose a date after today');
      } else if (body.scheduled_for <= nytime.nyDate(clock.nowMs())) {
        fields.add('scheduled_for', 'Choose a date after today');
      } else {
        scheduledFor = body.scheduled_for;
      }
    }
    if (
      scheduledFor &&
      validate.isValidAmountCents(body.amount_cents) &&
      body.amount_cents > settlement.APPROVAL_THRESHOLD_CENTS
    ) {
      fields.add('amount_cents', 'Scheduled payments can be at most $5,000.00');
    }
    if (quote) {
      if (body.method !== 'wire' || body.amount_cents !== Number(quote.amount_cents)) {
        fields.add('fx_quote_id', 'This quote does not match the payment');
      }
    }
    if (fields.any) throw errors.validation(fields.fields);

    if (quote) {
      if (quote.used_by_payment_id) throw errors.conflict('quote_used');
      if (clock.nowMs() >= new Date(quote.expires_at).getTime()) throw errors.conflict('quote_expired');
    }

    const amountCents = body.amount_cents;
    const totalDebit = quote ? Number(quote.total_debit_cents) : amountCents;
    const approvalsRequired = settlement.approvalsRequiredFor(amountCents);
    const now = clock.now();
    const nowMs = now.getTime();
    const paymentId = db.newId();

    let status;
    let effectiveDate = null;
    let expiresAt = null;
    let approveBy = null;

    if (scheduledFor) {
      status = 'scheduled';
      effectiveDate = settlement.effectiveDateForScheduled(body.method, scheduledFor);
    } else if (approvalsRequired > 0) {
      status = 'pending_approval';
      const expiry = settlement.expiryForHeldPayment(nowMs);
      expiresAt = expiry.expiresAt;
      approveBy = expiry.approveBy;
    } else {
      status = 'posted';
    }

    // Every funds check compares against the available balance.
    if (status !== 'scheduled') {
      const fresh = await domain.getAccount(client, ctx.companyId, account.id);
      if (Number(fresh.available_cents) < totalDebit) throw errors.moneyRefusal('insufficient_funds');
    }

    await client.query(
      `INSERT INTO payments
         (id, company_id, source_account_id, recipient_id, recipient_name, method, amount_cents,
          total_debit_cents, memo, status, scheduled_for, effective_date, expires_at, approve_by,
          fx_quote_id, approvals_required, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        paymentId,
        ctx.companyId,
        account.id,
        recipient.id,
        recipient.display_name,
        body.method,
        amountCents,
        totalDebit,
        memo,
        status,
        scheduledFor,
        effectiveDate,
        expiresAt,
        approveBy,
        quote ? quote.id : null,
        approvalsRequired,
        ctx.session.user.id,
        now,
      ]
    );
    await audit.writeEvent(client, {
      companyId: ctx.companyId,
      action: 'payment.created',
      paymentId,
      amountCents,
      actorEmail: ctx.session.user.email,
    });
    if (quote) {
      await client.query('UPDATE fx_quotes SET used_by_payment_id = $1 WHERE id = $2', [
        paymentId,
        quote.id,
      ]);
    }

    const stored = await domain.getPayment(client, ctx.companyId, paymentId);
    if (status === 'posted') {
      await core.postPayment(client, {
        companyId: ctx.companyId,
        payment: stored,
        actorEmail: ctx.session.user.email,
        instantMs: nowMs,
      });
    }
    const payment = await domain.getPayment(client, ctx.companyId, paymentId);
    const answer = { status: 201, body: await domain.serializePayment(client, payment) };
    await idempotency.store(client, keyInfo, answer);
    return answer;
  });
}

async function list(ctx) {
  const result = await db.query(
    'SELECT * FROM payments WHERE company_id = $1 ORDER BY created_at DESC, id DESC',
    [ctx.companyId]
  );
  const payments = [];
  for (const row of result.rows) payments.push(await domain.serializePayment(null, row));
  return { status: 200, body: { payments } };
}

async function get(ctx) {
  const payment = await domain.getPayment(null, ctx.companyId, ctx.params.payment_id);
  return { status: 200, body: await domain.serializePayment(null, payment) };
}

async function cancel(ctx) {
  return db.transaction(async (client) => {
    await db.lockCompany(client, ctx.companyId);
    const payment = await domain.getPayment(client, ctx.companyId, ctx.params.payment_id);
    const mayCancel =
      ctx.role === 'owner' || ctx.role === 'admin' || payment.created_by === ctx.session.user.id;
    if (!mayCancel) throw errors.forbidden();
    if (payment.status !== 'scheduled') throw errors.conflict('payment_not_scheduled');

    await client.query("UPDATE payments SET status = 'cancelled' WHERE id = $1", [payment.id]);
    await audit.writeEvent(client, {
      companyId: ctx.companyId,
      action: 'payment.cancelled',
      paymentId: payment.id,
      amountCents: Number(payment.amount_cents),
      actorEmail: ctx.session.user.email,
    });
    const updated = await domain.getPayment(client, ctx.companyId, payment.id);
    return { status: 200, body: await domain.serializePayment(client, updated) };
  });
}

async function approve(ctx) {
  return db.transaction(async (client) => {
    await db.lockCompany(client, ctx.companyId);
    const payment = await domain.getPayment(client, ctx.companyId, ctx.params.payment_id);

    // The role check is answered before anything about the payment's state.
    if (ctx.role !== 'owner' && ctx.role !== 'admin') throw errors.forbidden();
    if (payment.created_by === ctx.session.user.id) throw errors.forbidden();

    await holds.expireIfDue(client, ctx.companyId, payment);
    const current = await domain.getPayment(client, ctx.companyId, payment.id);
    if (current.status !== 'pending_approval') throw errors.conflict('payment_not_pending');

    const already = await client.query(
      'SELECT 1 FROM payment_approvals WHERE payment_id = $1 AND user_id = $2',
      [current.id, ctx.session.user.id]
    );
    if (already.rows.length > 0) throw errors.conflict('already_approved');

    const now = clock.now();
    await client.query(
      `INSERT INTO payment_approvals (id, payment_id, user_id, user_name, approved_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [db.newId(), current.id, ctx.session.user.id, ctx.session.user.name, now]
    );
    await audit.writeEvent(client, {
      companyId: ctx.companyId,
      action: 'payment.approved',
      paymentId: current.id,
      amountCents: Number(current.amount_cents),
      actorEmail: ctx.session.user.email,
    });

    const given = await client.query(
      'SELECT count(*)::int AS n FROM payment_approvals WHERE payment_id = $1',
      [current.id]
    );
    if (given.rows[0].n >= Number(current.approvals_required)) {
      await core.postPayment(client, {
        companyId: ctx.companyId,
        payment: current,
        actorEmail: ctx.session.user.email,
        instantMs: now.getTime(),
      });
    }
    const updated = await domain.getPayment(client, ctx.companyId, current.id);
    return { status: 200, body: await domain.serializePayment(client, updated) };
  });
}

async function reject(ctx) {
  return db.transaction(async (client) => {
    await db.lockCompany(client, ctx.companyId);
    const payment = await domain.getPayment(client, ctx.companyId, ctx.params.payment_id);
    if (ctx.role !== 'owner' && ctx.role !== 'admin') throw errors.forbidden();

    await holds.expireIfDue(client, ctx.companyId, payment);
    const current = await domain.getPayment(client, ctx.companyId, payment.id);
    if (current.status !== 'pending_approval') throw errors.conflict('payment_not_pending');

    await client.query("UPDATE payments SET status = 'rejected' WHERE id = $1", [current.id]);
    await audit.writeEvent(client, {
      companyId: ctx.companyId,
      action: 'payment.rejected',
      paymentId: current.id,
      amountCents: Number(current.amount_cents),
      actorEmail: ctx.session.user.email,
    });
    const updated = await domain.getPayment(client, ctx.companyId, current.id);
    return { status: 200, body: await domain.serializePayment(client, updated) };
  });
}

async function approvals(ctx) {
  const result = await db.query(
    `SELECT p.*, u.name AS creator_name, a.name AS source_account_name
       FROM payments p
       JOIN users u ON u.id = p.created_by
       JOIN accounts a ON a.id = p.source_account_id
      WHERE p.company_id = $1 AND p.status = 'pending_approval'
      ORDER BY p.created_at, p.id`,
    [ctx.companyId]
  );
  const list = [];
  for (const row of result.rows) {
    const payment = await domain.serializePayment(null, row);
    payment.creator_name = row.creator_name;
    payment.source_account_name = row.source_account_name;
    list.push(payment);
  }
  return { status: 200, body: { approvals: list } };
}

module.exports = { create, list, get, cancel, approve, reject, approvals };
