'use strict';
const express = require('express');
const db = require('./db');
const core = require('./core');
const auth = require('./auth');
const access = require('./access');
const { refusal } = core;
const { nowIso, sign, unsign } = require('./util');

const router = express.Router();

const QUEUE_PER_PAGE = 20;
const LOG_PER_PAGE = 20;
const CONFIRMATION_PHRASE = 'Revoke these grants permanently';
const FOREIGN_DEPARTMENT = () =>
  refusal(403, 'This department is not yours to govern.', 'department');

function wrap(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** The published method table for every administration address. */
const ALLOWED = [
  { test: /^\/grants\/revocations\/?$/, methods: ['POST'] },
  { test: /^\/grants\/[^/]+\/?$/, methods: ['DELETE'] },
  { test: /^\/grants\/?$/, methods: ['GET', 'POST'] },
  { test: /^\/queue\/?$/, methods: ['GET'] },
  { test: /^\/counts\/?$/, methods: ['GET'] },
  { test: /^\/log\/?$/, methods: ['GET'] },
];

/** Only the published administration surface answers. */
router.use(function (req, res, next) {
  const path = req.path;
  const match = ALLOWED.find((a) => a.test.test(path));
  if (!match) return next();
  if (!match.methods.includes(req.method) && req.method !== 'HEAD') {
    res.set('Allow', match.methods.join(', '));
    return next(refusal(405, 'That method is not allowed here.', 'method'));
  }
  next();
});

/** Every administration address needs a session holding a steward grant. */
async function requireSteward(req) {
  const a = auth.requireSession(req);
  const grant = (req.auth.grants || []).find((g) => g.role === 'steward');
  if (!grant) throw core.STEWARDS_ONLY();
  return { account: a.account, department: grant.department };
}

function requireJsonBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') return;
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (!ct.includes('application/json')) {
    throw refusal(415, 'That request body type is not supported.', 'content_type');
  }
}

function publicGrant(g, at) {
  return {
    id: String(g.id),
    account: g.account,
    department: g.department,
    role: g.role,
    authorises_from: g.authorises_from,
    authorising: new Date(g.authorises_from).getTime() <= new Date(at).getTime(),
  };
}

/* -------------------------- grants -------------------------------- */

router.get('/grants', wrap(async (req, res) => {
  const me = await requireSteward(req);
  const at = nowIso();
  const rows = await db.all(
    'SELECT id, account, department, role, authorises_from FROM role_grants WHERE department = $1 ORDER BY account ASC',
    [me.department]
  );
  res.status(200).json(rows.map((g) => publicGrant(g, at)));
}));

router.post('/grants', wrap(async (req, res) => {
  const me = await requireSteward(req);
  requireJsonBody(req);
  const body = req.body || {};
  const account = typeof body.account === 'string' ? body.account.trim().toLowerCase() : '';
  const role = typeof body.role === 'string' ? body.role.trim() : '';
  if (body.department !== undefined && body.department !== me.department) throw FOREIGN_DEPARTMENT();
  if (!account) throw refusal(422, 'A grant names its account.', 'account');
  if (!core.ROLE_NAMES.includes(role)) throw refusal(422, 'A grant names one of the four roles.', 'role');
  const held = await db.one('SELECT 1 FROM accounts WHERE email = $1', [account]);
  if (!held) throw refusal(422, 'That account is not part of Keystone Tables.', 'account');
  const authorises_from = body.authorises_from ? new Date(body.authorises_from) : new Date();
  if (Number.isNaN(authorises_from.getTime())) {
    throw refusal(422, 'A grant carries an ISO 8601 moment it authorises from.', 'authorises_from');
  }

  const out = await db.tx(async (client) => {
    const exists = await client.query(
      'SELECT 1 FROM role_grants WHERE account = $1 AND department = $2',
      [account, me.department]
    );
    if (exists.rows.length) {
      throw refusal(409, 'That account already holds a role on this department.', 'account');
    }
    const recorded_at = nowIso();
    const created = await client.query(
      `INSERT INTO role_grants (account, department, role, authorises_from, created_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, account, department, role, authorises_from`,
      [account, me.department, role, authorises_from.toISOString(), recorded_at]
    );
    await core.appendEntries(client, 'admin-' + me.department, [
      {
        action: 'grant_created',
        account: me.account.email,
        recorded_at,
        column: null,
        before: null,
        after: null,
        subject: account,
      },
    ]);
    return created.rows[0];
  });
  res.status(201).json(publicGrant(out, nowIso()));
}));

router.delete('/grants/:id', wrap(async (req, res) => {
  const me = await requireSteward(req);
  const grant = await db.one(
    'SELECT id, account, department FROM role_grants WHERE id::text = $1',
    [req.params.id]
  );
  if (!grant) throw refusal(404, 'That role grant is not part of Keystone Tables.', 'grant');
  if (grant.department !== me.department) throw FOREIGN_DEPARTMENT();
  await db.tx(async (client) => {
    await client.query('DELETE FROM role_grants WHERE id = $1', [grant.id]);
    await core.appendEntries(client, 'admin-' + me.department, [
      {
        action: 'grant_revoked',
        account: me.account.email,
        recorded_at: nowIso(),
        column: null,
        before: null,
        after: null,
        subject: grant.account,
      },
    ]);
  });
  res.status(204).end();
}));

router.post('/grants/revocations', wrap(async (req, res) => {
  const me = await requireSteward(req);
  requireJsonBody(req);
  const body = req.body || {};

  // The confirmation phrase is read before the named grants are.
  if (body.confirmation !== CONFIRMATION_PHRASE) {
    throw refusal(422, 'The confirmation phrase does not match.', 'confirmation');
  }
  const ids = Array.isArray(body.grants) ? body.grants.map(String) : [];

  const revoked = await db.tx(async (client) => {
    const found = await client.query(
      'SELECT id, account, department FROM role_grants WHERE id::text = ANY($1::text[]) FOR UPDATE',
      [ids]
    );
    const byId = new Map(found.rows.map((g) => [String(g.id), g]));
    for (const id of ids) {
      const g = byId.get(id);
      if (!g || g.department !== me.department) {
        throw refusal(422, 'One of these grants cannot be revoked.', 'grants');
      }
    }
    const recorded_at = nowIso();
    const entries = [];
    for (const id of ids) {
      const g = byId.get(id);
      await client.query('DELETE FROM role_grants WHERE id = $1', [g.id]);
      entries.push({
        action: 'grant_revoked',
        account: me.account.email,
        recorded_at,
        column: null,
        before: null,
        after: null,
        subject: g.account,
      });
    }
    if (entries.length) await core.appendEntries(client, 'admin-' + me.department, entries);
    return ids.length;
  });

  res.status(200).json({ revoked });
}));

/* -------------------------- queue --------------------------------- */

router.get('/queue', wrap(async (req, res) => {
  const me = await requireSteward(req);
  let offset = 0;
  if (req.query.cursor) {
    const decoded = unsign(String(req.query.cursor));
    if (!decoded || decoded.k !== 'queue') {
      throw refusal(422, 'This cursor belongs to another department.', 'cursor');
    }
    if (decoded.d !== me.department) {
      throw refusal(422, 'This cursor belongs to another department.', 'cursor');
    }
    offset = Number(decoded.offset) || 0;
  }
  const rows = await db.all(
    `SELECT * FROM requests WHERE department = $1
     ORDER BY (state = 'open') DESC, raised_at ASC, id ASC LIMIT $2 OFFSET $3`,
    [me.department, QUEUE_PER_PAGE, offset]
  );
  res.set('X-Queue-Cursor', sign({ k: 'queue', d: me.department, offset: offset + rows.length }));
  res.set('Access-Control-Expose-Headers', 'X-Queue-Cursor');
  res.status(200).json(
    rows.map((r) => ({
      id: String(r.id),
      account: r.account,
      department: r.department,
      role: r.role,
      state: r.state,
      reason: r.reason === undefined ? null : r.reason,
      raised_at: r.raised_at,
      decided_at: r.decided_at === undefined ? null : r.decided_at,
      decided_by: r.decided_by === undefined ? null : r.decided_by,
    }))
  );
}));

/* -------------------------- counts -------------------------------- */

router.get('/counts', wrap(async (req, res) => {
  const me = await requireSteward(req);
  const grants = await db.one(
    'SELECT count(*)::int AS n FROM role_grants WHERE department = $1',
    [me.department]
  );
  const open = await db.one(
    `SELECT count(*)::int AS n FROM requests WHERE department = $1 AND state = 'open'`,
    [me.department]
  );
  res.status(200).json({
    department: me.department,
    grants: grants.n,
    open_requests: open.n,
  });
}));

/* -------------------------- administration log -------------------- */

router.get('/log', wrap(async (req, res) => {
  const me = await requireSteward(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const stream = 'admin-' + me.department;
  const rows = await db.all(
    `SELECT * FROM log_entries WHERE table_slug = $1 ORDER BY ordinal DESC LIMIT $2 OFFSET $3`,
    [stream, LOG_PER_PAGE, (page - 1) * LOG_PER_PAGE]
  );
  res.status(200).json(rows.map(core.publicLogEntry));
}));

module.exports = { router, CONFIRMATION_PHRASE, QUEUE_PER_PAGE, publicGrant };
