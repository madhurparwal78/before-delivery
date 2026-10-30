import crypto from 'node:crypto';
import express from 'express';
import { ApiError } from './lib/core.js';
import { fail, noFields } from './lib/validate.js';
import { isOutage, pool, query, state, unavailable } from './db.js';
import { PgError } from './pg.js';
import { ROLE, apiAuth, need, signIn, signOut } from './auth.js';
import * as admin from './services/admin.js';
import * as intents from './services/intents.js';
import { auditPage, signedPage, verifyChain } from './services/audit.js';

const MAX_BODY = 1000000;
const requestId = () => crypto.randomUUID();

// The one envelope for every /api answer: successes, refusals and unexpected errors.
function envelope(res, status, data, error = null) {
  res.status(status).json({ success: !error, data: error ? null : data, error, meta: { request_id: requestId() } });
}

function refusal(res, err) {
  envelope(res, err.status, null, { code: err.code, message: err.message, details: err.details || {} });
}

const ok = (fn, status = 200) => async (req, res, next) => {
  try {
    envelope(res, status, await fn(req, res));
  } catch (err) {
    next(err);
  }
};
const created = (fn) => ok(fn, 201);

// A write that may carry an Idempotency-Key: its kept body is replayed as it was, with a fresh request id.
const keyedWrite = (fn) => async (req, res, next) => {
  try {
    const result = await fn(req, intents.idempotency(req));
    if (result.replayed) res.set('Idempotent-Replayed', 'true');
    res.status(result.status).type('application/json')
      .send(`${result.body.slice(0, -1)},"meta":{"request_id":"${requestId()}"}}`);
  } catch (err) {
    next(err);
  }
};

function intQuery(value, field, min, max, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value) || +value < min || +value > max) {
    fail(field, `${field} is a whole number from ${min} to ${max}.`);
  }
  return +value;
}

const pageQuery = (q) => ({ afterSeq: intQuery(q.after_seq, 'after_seq', 0, 2147483647, 0), limit: intQuery(q.limit, 'limit', 1, 500, 100) });

// Size, media type and JSON parse come first on every route.
function readBody(req, res, next) {
  const buffer = req.body;
  req.body = undefined;
  req.rawBody = '';
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return next();
  if (!req.is('application/json')) {
    return next(new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the request body as application/json.'));
  }
  req.rawBody = buffer.toString('utf8');
  try {
    req.body = JSON.parse(req.rawBody);
  } catch {
    return next(new ApiError(400, 'MALFORMED_JSON', 'The request body is not valid JSON.'));
  }
  return next();
}

export function apiRouter() {
  const api = express.Router();
  api.use(express.raw({ type: () => true, limit: MAX_BODY }), readBody);

  // The plain health answer: starting until the schema and seed are ready, unavailable while the database is down.
  api.get('/health', async (req, res) => {
    if (!state.ready) return res.status(503).json({ status: 'starting' });
    try {
      await query('SELECT 1');
      return res.json({ status: 'ok' });
    } catch {
      return res.status(503).json({ status: 'unavailable' });
    }
  });
  api.use('/v1', (req, res, next) => next(state.ready ? undefined : unavailable()));
  api.get('/v1/health', ok(async () => {
    await query('SELECT 1');
    return { status: 'ok' };
  }));
  api.post('/v1/auth/login', ok(async (req) => signIn(req.body)));
  api.post('/v1/contact', created(async (req) => admin.createContact(req.body)));

  const v1 = express.Router();
  v1.use(apiAuth);
  api.use('/v1', v1);
  const org = (req) => req.caller.org.id;

  v1.post('/auth/logout', need(ROLE.members), ok(async (req) => {
    noFields(req.body);
    await signOut(req.caller);
    return {};
  }));
  v1.get('/me', ok(async (req) => ({ member: req.caller.member, api_key: req.caller.apiKey,
    organization: { id: req.caller.org.id, name: req.caller.org.name, app_id: req.caller.org.app_id } })));

  v1.get('/wallets', need(ROLE.readers), ok(async (req) => ({ wallets: await admin.listWallets(org(req)) })));
  v1.post('/wallets', need(ROLE.owner), created(async (req) => admin.createWallet(req.caller, req.body)));
  v1.get('/wallets/:id', need(ROLE.readers), ok(async (req) => admin.getWallet(org(req), req.params.id)));
  v1.patch('/wallets/:id', need(ROLE.owner), ok(async (req) => admin.updateWallet(req.caller, req.params.id, req.body)));
  v1.post('/wallets/:id/freeze', need(ROLE.owner), ok(async (req) => admin.setFrozen(req.caller, req.params.id, true, req.body)));
  v1.post('/wallets/:id/unfreeze', need(ROLE.owner),
    ok(async (req) => admin.setFrozen(req.caller, req.params.id, false, req.body)));
  v1.post('/wallets/:id/transfers', need(ROLE.movers),
    keyedWrite((req, idem) => intents.transfer(req.caller, req.params.id, req.body, idem)));
  v1.post('/wallets/:id/batches', need(ROLE.movers),
    keyedWrite((req, idem) => intents.batch(req.caller, req.params.id, req.body, idem)));
  v1.post('/wallets/:id/deposits', need(ROLE.movers),
    keyedWrite((req, idem) => intents.deposit(req.caller, req.params.id, req.body, idem)));

  v1.get('/intents', need(ROLE.readers), ok(async (req) => intents.listIntents(req.caller, req.query)));
  v1.get('/intents/export', need(ROLE.readers), async (req, res, next) => {
    try {
      const csv = await intents.exportCsv(req.caller, req.query);
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="corvo-intents.csv"' });
      res.send(csv);
    } catch (err) {
      next(err);
    }
  });
  v1.get('/intents/:id', need(ROLE.readers), ok(async (req) => intents.getIntent(req.caller, req.params.id)));
  // The role step admits every member and every key here; the decision checks then refuse keys.
  v1.post('/intents/:id/approve', need(ROLE.readers),
    ok(async (req) => intents.decideIntent(req.caller, req.params.id, 'approve', req.body)));
  v1.post('/intents/:id/reject', need(ROLE.readers),
    ok(async (req) => intents.decideIntent(req.caller, req.params.id, 'reject', req.body)));
  v1.post('/intents/:id/cancel', need(ROLE.movers), ok(async (req) => intents.cancelIntent(req.caller, req.params.id, req.body)));
  v1.get('/approvals/inbox', need(ROLE.members), ok(async (req) => ({ items: await intents.inbox(req.caller) })));

  v1.get('/policies', need(ROLE.readers), ok(async (req) => ({ policies: await admin.listPolicies(org(req)) })));
  v1.post('/policies', need(ROLE.owner), created(async (req) => admin.createPolicy(req.caller, req.body)));
  v1.get('/policies/:id', need(ROLE.readers), ok(async (req) => admin.getPolicy(org(req), req.params.id)));
  v1.get('/policies/:id/revisions', need(ROLE.readers),
    ok(async (req) => ({ revisions: await admin.listRevisions(org(req), req.params.id) })));
  v1.patch('/policies/:id', need(ROLE.owner), ok(async (req) => admin.updatePolicy(req.caller, req.params.id, req.body)));
  v1.delete('/policies/:id', need(ROLE.owner), ok(async (req) => admin.deletePolicy(req.caller, req.params.id, req.body)));
  v1.post('/policies/:id/evaluate', need(ROLE.readers), ok(async (req) => admin.evaluatePolicy(req.caller, req.params.id, req.body)));

  v1.get('/aggregations', need(ROLE.readers), ok(async (req) => ({ aggregations: await admin.listAggregations(org(req)) })));
  v1.post('/aggregations', need(ROLE.owner), created(async (req) => admin.createAggregation(req.caller, req.body)));
  v1.get('/quorums', need(ROLE.readers), ok(async (req) => ({ quorums: await admin.listQuorums(org(req)) })));
  v1.post('/quorums', need(ROLE.owner), created(async (req) => admin.createQuorum(req.caller, req.body)));
  v1.patch('/quorums/:id', need(ROLE.owner), ok(async (req) => admin.updateQuorum(req.caller, req.params.id, req.body)));

  v1.get('/members', need(ROLE.readers), ok(async (req) => ({ members: await admin.listMembers(org(req)) })));
  v1.post('/members', need(ROLE.owner), created(async (req) => admin.createMember(req.caller, req.body)));
  v1.patch('/members/:id', need(ROLE.owner), ok(async (req) => admin.updateMember(req.caller, req.params.id, req.body)));
  v1.delete('/members/:id', need(ROLE.owner), ok(async (req) => admin.removeMember(req.caller, req.params.id, req.body)));

  v1.get('/api-keys', need(ROLE.auditors), ok(async (req) => ({ api_keys: await admin.listKeys(org(req)) })));
  v1.post('/api-keys', need(ROLE.owner), created(async (req) => admin.createKey(req.caller, req.body)));
  v1.delete('/api-keys/:id', need(ROLE.owner), ok(async (req) => admin.revokeKey(req.caller, req.params.id, req.body)));

  v1.get('/audit', need(ROLE.auditors), ok(async (req) => ({ events: await auditPage(pool, org(req), pageQuery(req.query)) })));
  v1.get('/audit/verify', need(ROLE.auditors), ok(async (req) => verifyChain(pool, org(req))));
  v1.get('/webhooks/secret', need(ROLE.owner), ok(async (req) => admin.readSecret(org(req))));
  v1.post('/webhooks/secret/rotate', need(ROLE.owner), ok(async (req) => {
    noFields(req.body);
    return admin.rotateSecret(req.caller);
  }));
  v1.get('/webhooks/events', need(ROLE.auditors),
    ok(async (req) => ({ events: await signedPage(pool, org(req), pageQuery(req.query)) })));

  api.use((req, res) => envelope(res, 404, null, { code: 'NOT_FOUND', message: 'No such endpoint.', details: {} }));
  api.use(apiErrors);
  return api;
}

function apiErrors(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ApiError) return refusal(res, err);
  if (err.type === 'entity.too.large') {
    return refusal(res, new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The request body is larger than 1,000,000 bytes.'));
  }
  if (isOutage(err)) return refusal(res, unavailable());
  if (err instanceof PgError && err.code?.startsWith('22')) {
    return refusal(res, new ApiError(422, 'VALIDATION_ERROR', 'A value in this request is not valid.'));
  }
  if (err.type) return refusal(res, new ApiError(400, 'MALFORMED_JSON', 'The request body could not be read.'));
  console.error(err);
  return refusal(res, new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong on our side. Nothing was changed.'));
}
