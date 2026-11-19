'use strict';

const db = require('../lib/db');
const clock = require('../lib/clock');
const errors = require('../lib/errors');
const validate = require('../lib/validate');
const domain = require('../lib/domain');
const audit = require('../lib/audit');
const money = require('../lib/money');
const idempotency = require('../lib/idempotency');
const stream = require('../lib/stream');

const MEMO_MAX = 140;

const FX_RATES = {
  EUR: { numerator: 9200, denominator: 10000, rate: 0.92 },
  GBP: { numerator: 7900, denominator: 10000, rate: 0.79 },
  CAD: { numerator: 13600, denominator: 10000, rate: 1.36 },
};

function fxQuoteTtlSeconds() {
  const raw = Number(process.env.FX_QUOTE_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : 600;
}

async function listInvoices(ctx) {
  const result = await db.query(
    'SELECT * FROM invoices WHERE company_id = $1 ORDER BY position, created_at, id',
    [ctx.companyId]
  );
  return { status: 200, body: { invoices: result.rows.map(domain.serializeInvoice) } };
}

async function sendInvoice(ctx) {
  return db.transaction(async (client) => {
    await db.lockCompany(client, ctx.companyId);
    const invoice = await domain.getInvoice(client, ctx.companyId, ctx.params.invoice_id);
    if (ctx.role !== 'owner' && ctx.role !== 'admin') throw errors.forbidden();
    if (invoice.status !== 'draft') throw errors.conflict('invoice_not_draft');
    await client.query("UPDATE invoices SET status = 'sent' WHERE id = $1", [invoice.id]);
    const updated = await domain.getInvoice(client, ctx.companyId, invoice.id);
    return { status: 200, body: domain.serializeInvoice(updated) };
  });
}

async function markInvoicePaid(ctx) {
  return db.transaction(async (client) => {
    await db.lockCompany(client, ctx.companyId);
    const invoice = await domain.getInvoice(client, ctx.companyId, ctx.params.invoice_id);
    if (ctx.role !== 'owner' && ctx.role !== 'admin') throw errors.forbidden();

    const body = ctx.json();
    if (body.account_id === undefined || body.account_id === null) {
      throw errors.validation({ account_id: 'Choose an account' });
    }
    const account = await domain.getAccountForUpdate(client, ctx.companyId, body.account_id);

    if (invoice.status === 'paid') throw errors.conflict('invoice_already_paid');
    if (invoice.status !== 'sent') throw errors.conflict('invoice_not_sent');

    const total = Number(invoice.total_cents);
    await domain.writeMovement(client, {
      companyId: ctx.companyId,
      accountId: account.id,
      direction: 'credit',
      amountCents: total,
      method: 'ach',
      counterparty: invoice.customer_name,
      memo: null,
    });
    await client.query(
      "UPDATE invoices SET status = 'paid', paid_into_account_id = $1 WHERE id = $2",
      [account.id, invoice.id]
    );
    await audit.writeEvent(client, {
      companyId: ctx.companyId,
      action: 'invoice.paid',
      amountCents: total,
      actorEmail: ctx.session.user.email,
    });
    stream.poke();
    const updated = await domain.getInvoice(client, ctx.companyId, invoice.id);
    return { status: 200, body: domain.serializeInvoice(updated) };
  });
}

async function listLoans(ctx) {
  const result = await db.query(
    'SELECT * FROM loans WHERE company_id = $1 ORDER BY created_at, id',
    [ctx.companyId]
  );
  return { status: 200, body: { loans: result.rows.map(domain.serializeLoan) } };
}

async function drawLoan(ctx) {
  const rawLoanId = ctx.params.loan_id;
  const body = ctx.json();
  const keyInfo = idempotency.meta({
    companyId: ctx.companyId,
    endpoint: `POST /api/loans/${rawLoanId}/draw`,
    key: ctx.idempotencyKey,
    readKeys: { amount_cents: body.amount_cents === undefined ? null : body.amount_cents },
  });

  return db.transaction(async (client) => {
    await db.lockCompany(client, ctx.companyId);
    const replayed = await idempotency.replay(client, keyInfo);
    if (replayed) return replayed;

    const loan = await domain.getLoan(client, ctx.companyId, rawLoanId);
    if (ctx.role !== 'owner') throw errors.forbidden();
    if (!validate.isValidAmountCents(body.amount_cents)) {
      throw errors.validation({ amount_cents: 'Enter an amount in cents' });
    }

    const locked = await client.query('SELECT * FROM loans WHERE id = $1 FOR UPDATE', [loan.id]);
    const current = locked.rows[0];
    const remaining = Number(current.principal_cents) - Number(current.drawn_cents);
    if (body.amount_cents > remaining) throw errors.moneyRefusal('exceeds_available_credit');

    await domain.writeMovement(client, {
      companyId: ctx.companyId,
      accountId: current.funding_account_id,
      direction: 'credit',
      amountCents: body.amount_cents,
      method: 'wire',
      counterparty: current.name,
      memo: null,
    });
    await client.query('UPDATE loans SET drawn_cents = drawn_cents + $1 WHERE id = $2', [
      body.amount_cents,
      current.id,
    ]);
    await audit.writeEvent(client, {
      companyId: ctx.companyId,
      action: 'loan.drawn',
      amountCents: body.amount_cents,
      actorEmail: ctx.session.user.email,
    });
    stream.poke();

    const updated = await client.query('SELECT * FROM loans WHERE id = $1', [current.id]);
    const answer = { status: 200, body: domain.serializeLoan(updated.rows[0]) };
    await idempotency.store(client, keyInfo, answer);
    return answer;
  });
}

async function createTransfer(ctx) {
  const body = ctx.json();
  const keyInfo = idempotency.meta({
    companyId: ctx.companyId,
    endpoint: 'POST /api/transfers',
    key: ctx.idempotencyKey,
    readKeys: {
      from_account_id: body.from_account_id === undefined ? null : body.from_account_id,
      to_account_id: body.to_account_id === undefined ? null : body.to_account_id,
      amount_cents: body.amount_cents === undefined ? null : body.amount_cents,
      memo: body.memo === undefined ? null : body.memo,
    },
  });

  return db.transaction(async (client) => {
    await db.lockCompany(client, ctx.companyId);
    const replayed = await idempotency.replay(client, keyInfo);
    if (replayed) return replayed;

    const fields = new validate.FieldErrors();
    let from = null;
    let to = null;
    if (body.from_account_id === undefined || body.from_account_id === null) {
      fields.add('from_account_id', 'Choose an account');
    } else {
      from = await domain.getAccount(client, ctx.companyId, body.from_account_id);
    }
    if (body.to_account_id === undefined || body.to_account_id === null) {
      fields.add('to_account_id', 'Choose an account');
    } else {
      to = await domain.getAccount(client, ctx.companyId, body.to_account_id);
    }
    if (!validate.isValidAmountCents(body.amount_cents)) {
      fields.add('amount_cents', 'Enter an amount in cents');
    }
    let memo = null;
    if (body.memo !== undefined && body.memo !== null) {
      const read = validate.readMultiLine(body.memo);
      if (!read.ok || validate.codePointLength(read.value) > MEMO_MAX) {
        fields.add('memo', 'Keep the memo to 140 characters of plain text');
      } else {
        memo = read.value;
      }
    }
    if (from && to && from.id === to.id) fields.add('to_account_id', 'Choose a different account');
    if (fields.any) throw errors.validation(fields.fields);

    const fresh = await domain.getAccount(client, ctx.companyId, from.id);
    if (Number(fresh.available_cents) < body.amount_cents) {
      throw errors.moneyRefusal('insufficient_funds');
    }

    const transferId = db.newId();
    const createdAt = clock.now();
    await domain.writeMovement(client, {
      companyId: ctx.companyId,
      accountId: from.id,
      direction: 'debit',
      amountCents: body.amount_cents,
      method: 'transfer',
      counterparty: to.name,
      memo,
      transferId,
      createdAt,
    });
    await domain.writeMovement(client, {
      companyId: ctx.companyId,
      accountId: to.id,
      direction: 'credit',
      amountCents: body.amount_cents,
      method: 'transfer',
      counterparty: from.name,
      memo,
      transferId,
      createdAt,
    });
    await audit.writeEvent(client, {
      companyId: ctx.companyId,
      action: 'transfer.posted',
      amountCents: body.amount_cents,
      actorEmail: ctx.session.user.email,
    });
    stream.poke();

    const answer = {
      status: 201,
      body: {
        id: transferId,
        from_account_id: from.id,
        to_account_id: to.id,
        amount_cents: body.amount_cents,
        memo,
      },
    };
    await idempotency.store(client, keyInfo, answer);
    return answer;
  });
}

async function createQuote(ctx) {
  const body = ctx.json();
  const fields = new validate.FieldErrors();
  const currency = body.currency;
  if (typeof currency !== 'string' || !Object.prototype.hasOwnProperty.call(FX_RATES, currency)) {
    fields.add('currency', 'Choose EUR, GBP or CAD');
  }
  if (!validate.isValidAmountCents(body.amount_cents)) {
    fields.add('amount_cents', 'Enter an amount in cents');
  }
  if (fields.any) throw errors.validation(fields.fields);

  const spec = FX_RATES[currency];
  const amountCents = body.amount_cents;
  const foreign = money.multiplyRateHalfUp(amountCents, spec.numerator, spec.denominator);
  const feeCents = money.onePercentHalfUp(amountCents);
  const id = db.newId();
  const createdAt = clock.now();
  const expiresAt = new Date(createdAt.getTime() + fxQuoteTtlSeconds() * 1000);

  await db.query(
    `INSERT INTO fx_quotes
       (id, company_id, currency, amount_cents, rate, foreign_amount_minor, fee_cents,
        total_debit_cents, expires_at, used_by_payment_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10)`,
    [
      id,
      ctx.companyId,
      currency,
      amountCents,
      String(spec.rate),
      foreign,
      feeCents,
      amountCents + feeCents,
      expiresAt,
      createdAt,
    ]
  );
  return {
    status: 201,
    body: {
      id,
      currency,
      amount_cents: amountCents,
      rate: spec.rate,
      foreign_amount_minor: foreign,
      fee_cents: feeCents,
      total_debit_cents: amountCents + feeCents,
      expires_at: expiresAt.toISOString(),
    },
  };
}

async function listAudit(ctx) {
  if (ctx.role !== 'owner' && ctx.role !== 'admin') throw errors.forbidden();
  const result = await db.query(
    `SELECT seq, action, payment_id, amount_cents, actor_email, prev_hash, hash, created_at
       FROM audit_events WHERE company_id = $1 ORDER BY seq`,
    [ctx.companyId]
  );
  return {
    status: 200,
    body: {
      events: result.rows.map((row) => ({
        seq: Number(row.seq),
        action: row.action,
        payment_id: row.payment_id || null,
        amount_cents: Number(row.amount_cents),
        actor_email: row.actor_email,
        prev_hash: row.prev_hash,
        hash: row.hash,
        created_at: new Date(row.created_at).toISOString(),
      })),
    },
  };
}

async function listPlans() {
  const result = await db.query(
    'SELECT id, name, monthly_cents, annual_cents, features FROM plans ORDER BY position, name'
  );
  return {
    status: 200,
    body: {
      plans: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        monthly_cents: Number(row.monthly_cents),
        annual_cents: Number(row.annual_cents),
        features: row.features,
      })),
    },
  };
}

module.exports = {
  listInvoices,
  sendInvoice,
  markInvoicePaid,
  listLoans,
  drawLoan,
  createTransfer,
  createQuote,
  listAudit,
  listPlans,
};
