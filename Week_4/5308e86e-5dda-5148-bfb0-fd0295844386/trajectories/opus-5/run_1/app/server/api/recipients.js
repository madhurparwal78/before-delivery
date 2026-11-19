'use strict';

const db = require('../lib/db');
const clock = require('../lib/clock');
const errors = require('../lib/errors');
const validate = require('../lib/validate');
const domain = require('../lib/domain');
const audit = require('../lib/audit');
const seed = require('../lib/seed');
const holds = require('../lib/holds');

const DISPLAY_NAME_MAX = 120;
const KINDS = ['person', 'business'];
const METHODS = ['ach', 'wire', 'rtp', 'check'];

async function list(ctx) {
  const result = await db.query(
    `SELECT * FROM recipients WHERE company_id = $1 AND status <> 'removed'
      ORDER BY created_at, id`,
    [ctx.companyId]
  );
  return { status: 200, body: { recipients: result.rows.map(domain.serializeRecipient) } };
}

async function get(ctx) {
  const recipient = await domain.getRecipient(null, ctx.companyId, ctx.params.recipient_id);
  return { status: 200, body: domain.serializeRecipient(recipient) };
}

function readDisplayName(raw, fields) {
  if (typeof raw !== 'string') {
    fields.add('display_name', 'Enter a name of up to 120 characters');
    return null;
  }
  if (validate.hasForbiddenEverywhere(raw)) {
    fields.add('display_name', 'Remove control or direction characters from this name');
    return null;
  }
  const single = validate.readSingleLine(raw);
  if (!single.ok) {
    fields.add('display_name', 'Remove control or direction characters from this name');
    return null;
  }
  const length = validate.codePointLength(single.value);
  if (length < 1 || length > DISPLAY_NAME_MAX) {
    fields.add('display_name', 'Enter a name of up to 120 characters');
    return null;
  }
  return single.value;
}

async function create(ctx) {
  const body = ctx.json();
  const fields = new validate.FieldErrors();

  const displayName = readDisplayName(body.display_name, fields);
  if (!KINDS.includes(body.kind)) fields.add('kind', 'Choose a kind');
  if (!METHODS.includes(body.method)) fields.add('method', 'Choose a method');

  const accountNumber = body.account_number;
  if (!validate.isAsciiDigits(accountNumber) || accountNumber.length < 4 || accountNumber.length > 17) {
    fields.add('account_number', 'Enter 4 to 17 digits');
  }
  if (!validate.isValidRoutingNumber(body.routing_number)) {
    fields.add('routing_number', 'Enter a valid 9-digit routing number');
  }
  if (fields.any) throw errors.validation(fields.fields);

  const fingerprint = seed.accountFingerprint(body.routing_number, accountNumber);

  return db.transaction(async (client) => {
    await db.lockCompany(client, ctx.companyId);
    const duplicate = await client.query(
      `SELECT id, display_name FROM recipients
        WHERE company_id = $1 AND status = 'active' AND account_fingerprint = $2`,
      [ctx.companyId, fingerprint]
    );
    if (duplicate.rows.length > 0) {
      throw errors.conflict('duplicate_recipient', {
        recipient_id: duplicate.rows[0].id,
        display_name: duplicate.rows[0].display_name,
      });
    }
    const id = db.newId();
    await client.query(
      `INSERT INTO recipients
         (id, company_id, display_name, kind, method, status, account_last4, account_fingerprint, routing_number, email, created_at)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, NULL, $9)`,
      [
        id,
        ctx.companyId,
        displayName,
        body.kind,
        body.method,
        accountNumber.slice(-4),
        fingerprint,
        body.routing_number,
        clock.now(),
      ]
    );
    const created = await domain.getRecipient(client, ctx.companyId, id);
    return { status: 201, body: domain.serializeRecipient(created) };
  });
}

async function invite(ctx) {
  const body = ctx.json();
  const email = validate.readEmail(body.email);
  if (!email.ok) throw errors.validation({ email: 'Enter a valid email' });

  return db.transaction(async (client) => {
    await db.lockCompany(client, ctx.companyId);
    const duplicate = await client.query(
      `SELECT id, display_name FROM recipients
        WHERE company_id = $1 AND status = 'pending' AND email = $2`,
      [ctx.companyId, email.value]
    );
    if (duplicate.rows.length > 0) {
      throw errors.conflict('duplicate_recipient', {
        recipient_id: duplicate.rows[0].id,
        display_name: duplicate.rows[0].display_name,
      });
    }
    const id = db.newId();
    await client.query(
      `INSERT INTO recipients
         (id, company_id, display_name, kind, method, status, account_last4, account_fingerprint, routing_number, email, created_at)
       VALUES ($1, $2, $3, NULL, NULL, 'pending', NULL, NULL, NULL, $4, $5)`,
      [id, ctx.companyId, email.value, email.value, clock.now()]
    );
    const created = await domain.getRecipient(client, ctx.companyId, id);
    return {
      status: 201,
      body: { invite_id: id, recipient: domain.serializeRecipient(created) },
    };
  });
}

async function remove(ctx) {
  if (ctx.role !== 'owner' && ctx.role !== 'admin') throw errors.forbidden();
  const recipientId = ctx.params.recipient_id;

  return db.transaction(async (client) => {
    await db.lockCompany(client, ctx.companyId);
    const recipient = await domain.getRecipient(client, ctx.companyId, recipientId);

    // A held payment whose expiry has passed never blocks removal; its expiry
    // is recorded here, in this same transaction.
    await holds.expireDuePaymentsOfRecipient(client, ctx.companyId, recipientId);

    const blocking = await client.query(
      `SELECT 1 FROM payments
        WHERE recipient_id = $1 AND company_id = $2 AND status = 'pending_approval'`,
      [recipientId, ctx.companyId]
    );
    if (blocking.rows.length > 0) throw errors.conflict('recipient_has_pending_payments');

    const scheduled = await client.query(
      `SELECT id, amount_cents FROM payments
        WHERE recipient_id = $1 AND company_id = $2 AND status = 'scheduled'`,
      [recipientId, ctx.companyId]
    );
    for (const payment of scheduled.rows) {
      await client.query("UPDATE payments SET status = 'cancelled' WHERE id = $1", [payment.id]);
      await audit.writeEvent(client, {
        companyId: ctx.companyId,
        action: 'payment.cancelled',
        paymentId: payment.id,
        amountCents: Number(payment.amount_cents),
        actorEmail: ctx.session.user.email,
      });
    }

    await client.query(
      "UPDATE recipients SET status = 'removed', removed_at = $1 WHERE id = $2",
      [clock.now(), recipient.id]
    );
    return { status: 204 };
  });
}

module.exports = { list, get, create, invite, remove };
