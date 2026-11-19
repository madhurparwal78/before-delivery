'use strict';

const db = require('../lib/db');
const clock = require('../lib/clock');
const nytime = require('../lib/nytime');
const errors = require('../lib/errors');
const validate = require('../lib/validate');
const auth = require('../lib/auth');
const passwords = require('../lib/passwords');
const settlement = require('../lib/settlement');
const stream = require('../lib/stream');

async function signup(ctx) {
  const body = ctx.json();
  const fields = new validate.FieldErrors();

  const name = validate.readSingleLine(body.name);
  if (!name.ok || name.value.length === 0 || validate.codePointLength(name.value) > 120) {
    fields.add('name', 'Enter your name');
  }
  const email = validate.readEmail(body.email);
  if (!email.ok) fields.add('email', 'Enter a valid email');

  const rawPassword = body.password;
  if (typeof rawPassword !== 'string' || validate.hasForbiddenEverywhere(rawPassword)) {
    fields.add('password', 'Password must be at least 8 characters');
  } else {
    const length = validate.codePointLength(rawPassword);
    if (length < 8 || length > 128) fields.add('password', 'Password must be at least 8 characters');
  }
  if (fields.any) throw errors.validation(fields.fields);

  const existing = await db.query('SELECT 1 FROM users WHERE email = $1', [email.value]);
  if (existing.rows.length > 0) throw errors.conflict('email_taken');

  const passwordHash = await passwords.hashPassword(rawPassword);

  return db.transaction(async (client) => {
    const taken = await client.query('SELECT 1 FROM users WHERE email = $1', [email.value]);
    if (taken.rows.length > 0) throw errors.conflict('email_taken');

    const now = clock.now();
    const userId = db.newId();
    const companyId = db.newId();
    await client.query(
      'INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)',
      [userId, email.value, name.value, passwordHash, now]
    );
    await client.query('INSERT INTO companies (id, name, created_at) VALUES ($1, $2, $3)', [
      companyId,
      name.value,
      now,
    ]);
    await client.query(
      'INSERT INTO memberships (id, user_id, company_id, role, created_at) VALUES ($1, $2, $3, $4, $5)',
      [db.newId(), userId, companyId, 'owner', now]
    );
    await client.query(
      `INSERT INTO accounts (id, company_id, name, kind, balance_cents, position, created_at)
       VALUES ($1, $2, 'Checking', 'checking', 0, 0, $3)`,
      [db.newId(), companyId, now]
    );
    const token = await auth.createSession(client, userId, companyId);
    return {
      status: 201,
      body: {
        token,
        user: {
          id: userId,
          email: email.value,
          name: name.value,
          role: 'owner',
          company_id: companyId,
        },
      },
    };
  });
}

async function login(ctx) {
  const body = ctx.json();
  const fields = new validate.FieldErrors();
  // Any address is a sign-in attempt, so an unknown one cannot be told apart
  // from a wrong password.
  const email = validate.readSingleLine(body.email);
  if (!email.ok) fields.add('email', 'Enter your email');
  if (typeof body.password !== 'string' || validate.hasForbiddenEverywhere(body.password)) {
    fields.add('password', 'Enter your password');
  }
  if (fields.any) throw errors.validation(fields.fields);

  const result = await auth.attemptLogin(email.value.toLowerCase(), body.password);
  if (result.outcome === 'locked') throw errors.tooManyRequests('too_many_attempts');
  if (result.outcome !== 'ok') throw new errors.ApiError(401, { error: 'invalid_credentials' });
  return { status: 200, body: { token: result.token, user: result.user } };
}

async function logout(ctx) {
  await auth.revokeSession(ctx.session.sessionId);
  stream.closeForToken(ctx.session.tokenHash);
  return { status: 204 };
}

async function me(ctx) {
  const nowMs = clock.nowMs();
  const company = await db.query('SELECT name FROM companies WHERE id = $1', [ctx.companyId]);
  return {
    status: 200,
    body: {
      user: Object.assign({}, ctx.session.user, {
        company_name: company.rows.length ? company.rows[0].name : '',
      }),
      business_date: nytime.nyDate(nowMs),
      business_now: new Date(nowMs).toISOString(),
      settlement_dates: settlement.settlementDates(nowMs),
      settlement_dates_change_at: new Date(settlement.settlementDatesChangeAt(nowMs)).toISOString(),
    },
  };
}

module.exports = { signup, login, logout, me };
