// The steward administration interface under /api/admin. Only a steward reaches it; every
// request reads the role grants standing in the store at the moment it is answered; a refused
// administration request records nothing at all.
const express = require('express');
const { pool, uid, businessDay } = require('./store');
const {
  refuse, now, iso, accountGrants, roleOn,
  appendLogEntry, encodeCursor, decodeCursor,
} = require('./helpers');

const router = express.Router();

const ALLOWED = {
  '/api/admin/grants': ['GET', 'POST', 'DELETE'],
  '/api/admin/grants/revocations': ['POST'],
  '/api/admin/queue': ['GET'],
  '/api/admin/counts': ['GET'],
  '/api/admin/log': ['GET'],
};

const CONFIRMATION_PHRASE = 'Revoke these grants permanently';

// The acting steward's own department: the department its steward grant names.
async function stewardDepartment(email) {
  const grants = await accountGrants(email);
  const stewardGrant = grants.find(g => g.role === 'steward');
  return stewardGrant ? stewardGrant.department : null;
}

// Attaches the caller and refuses 401 without a session, 403 without a steward role, and
// handles the 405/415 rules. A refused administration request records nothing.
// The published path of a request: a grants/{id} path reads as /api/admin/grants.
function normalizeAdminPath(req) {
  let p = (req.baseUrl || '') + (req.path || '');
  // A specific grant id reads as the grants address: both accept GET/POST on the collection
  // and DELETE on the id, and the Allow header names the union.
  if (p === '/api/admin/grants/revocations') return p;
  if (p.startsWith('/api/admin/grants/')) return '/api/admin/grants';
  return p.replace(/\/$/, '');
}

// A request to a published administration path whose method is not accepted answers 405 with
// an Allow header, whatever the session holds, because the address exists and the verb does
// not. Every other request passes to the steward check.
router.use((req, res, next) => {
  const key = normalizeAdminPath(req);
  const allowed = ALLOWED[key];
  if (allowed && !allowed.includes(req.method)) {
    res.setHeader('Allow', allowed.join(', '));
    return refuse(res, 405, 'That method is not allowed here.', 'method');
  }
  next();
});

// Only a steward reaches anything else on the administration surface, and the check reads the
// role grants standing in the store at the moment the request is answered.
router.use((req, res, next) => {
  if (!req.session || !req.account) {
    return refuse(res, 401, 'Sign in to use this address.', 'session');
  }
  stewardDepartment(req.account.email).then((department) => {
    if (!department) {
      return refuse(res, 403, 'This console is for stewards only.', 'role');
    }
    req.stewardDepartment = department;
    next();
  }).catch(next);
});

router.get('/grants', async (req, res) => {
  const r = await pool.query(
    'SELECT * FROM role_grants WHERE department = $1 ORDER BY account', [req.stewardDepartment]);
  const at = now().getTime();
  res.json(r.rows.map(g => ({
    id: g.id, account: g.account, department: g.department, role: g.role,
    authorises_from: iso(g.authorises_from),
    authorising: at >= new Date(g.authorises_from).getTime(),
  })));
});

router.post('/grants', async (req, res) => {
  const { account, role, authorises_from } = req.body || {};
  if (typeof account !== 'string' || !account.trim()) {
    return refuse(res, 422, 'A grant names its account.', 'account');
  }
  if (!['viewer', 'analyst', 'editor', 'steward'].includes(role)) {
    return refuse(res, 422, 'A grant names one of the four roles.', 'role');
  }
  let from = now();
  if (authorises_from !== undefined && authorises_from !== null) {
    const parsed = new Date(authorises_from);
    if (isNaN(parsed.getTime())) {
      return refuse(res, 422, 'A grant carries its authorising moment as an ISO 8601 timestamp.', 'authorises_from');
    }
    from = parsed;
  }
  const accountRow = await pool.query('SELECT id FROM accounts WHERE email = $1', [account.trim().toLowerCase()]);
  if (accountRow.rows.length === 0) {
    return refuse(res, 422, 'No account holds this email.', 'account');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT id FROM role_grants WHERE account = $1 AND department = $2',
      [account.trim().toLowerCase(), req.stewardDepartment]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return refuse(res, 409, 'This account already holds a role on this department.', 'account');
    }
    const id = uid('rg');
    await client.query(
      'INSERT INTO role_grants (id, account, department, role, authorises_from, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, account.trim().toLowerCase(), req.stewardDepartment, role, from, now()]);
    await appendLogEntry(client, 'admin-' + req.stewardDepartment, 'grant_created', req.account.email, null, null, null, account.trim().toLowerCase(), now());
    await client.query('COMMIT');
    const at = now().getTime();
    res.status(201).json({
      id, account: account.trim().toLowerCase(), department: req.stewardDepartment, role,
      authorises_from: iso(from), authorising: at >= from.getTime(),
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

router.delete('/grants/:id', async (req, res) => {
  const r = await pool.query('SELECT * FROM role_grants WHERE id = $1', [req.params.id]);
  const grant = r.rows[0];
  if (!grant) return refuse(res, 404, 'No role grant has this id.', 'grant');
  if (grant.department !== req.stewardDepartment) {
    return refuse(res, 403, 'This department is not yours to govern.', 'department');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM role_grants WHERE id = $1', [grant.id]);
    await appendLogEntry(client, 'admin-' + grant.department, 'grant_revoked', req.account.email, null, null, null, grant.account, now());
    await client.query('COMMIT');
    res.status(204).end();
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// Bulk revoke is all or nothing behind its phrase. The phrase is read before the named
// grants are, so a mismatch is refused whichever grants the call named and even when it
// named none.
router.post('/grants/revocations', async (req, res) => {
  const { grants, confirmation } = req.body || {};
  if (confirmation !== CONFIRMATION_PHRASE) {
    return refuse(res, 422, 'The confirmation phrase does not match.', 'confirmation');
  }
  if (!Array.isArray(grants)) {
    return refuse(res, 422, 'A bulk revoke names its grants.', 'grants');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = [];
    for (const id of grants) {
      const r = await client.query('SELECT * FROM role_grants WHERE id = $1', [id]);
      const grant = r.rows[0];
      if (!grant || grant.department !== req.stewardDepartment) {
        await client.query('ROLLBACK');
        return refuse(res, 422, 'One of these grants cannot be revoked.', 'grants');
      }
      found.push(grant);
    }
    for (const grant of found) {
      await client.query('DELETE FROM role_grants WHERE id = $1', [grant.id]);
      await appendLogEntry(client, 'admin-' + grant.department, 'grant_revoked', req.account.email, null, null, null, grant.account, now());
    }
    await client.query('COMMIT');
    res.json({ revoked: found.length });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// The queue answers open requests ahead of decided ones by raised_at oldest first, twenty to
// a page, and always carries a non-empty cursor for that one department's queue.
router.get('/queue', async (req, res) => {
  const department = req.stewardDepartment;
  let offset = 0;
  if (req.query.cursor) {
    const parsed = decodeCursor(req.query.cursor);
    if (!parsed || parsed.k !== 'queue' || parsed.s !== department) {
      return refuse(res, 422, 'This cursor belongs to another department.', 'cursor');
    }
    offset = parsed.o;
  }
  const r = await pool.query(
    `SELECT * FROM requests WHERE department = $1
     ORDER BY (state = 'open') DESC, raised_at ASC, id ASC
     LIMIT $2 OFFSET $3`,
    [department, 20, offset]);
  const cursor = encodeCursor('queue', department, offset + r.rows.length);
  res.setHeader('X-Queue-Cursor', cursor);
  res.json(r.rows.map(row => ({
    id: row.id, account: row.account, department: row.department, role: row.role,
    state: row.state, reason: row.reason, raised_at: iso(row.raised_at),
    decided_by: row.decided_by || null, decided_at: row.decided_at ? iso(row.decided_at) : null,
  })));
});

router.get('/counts', async (req, res) => {
  const department = req.stewardDepartment;
  const g = await pool.query('SELECT count(*) AS c FROM role_grants WHERE department = $1', [department]);
  const o = await pool.query("SELECT count(*) AS c FROM requests WHERE department = $1 AND state = 'open'", [department]);
  res.json({
    department,
    grants: Number(g.rows[0].c),
    open_requests: Number(o.rows[0].c),
  });
});

router.get('/log', async (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const r = await pool.query(
    'SELECT * FROM log_entries WHERE table_slug = $1 ORDER BY ordinal DESC LIMIT $2 OFFSET $3',
    ['admin-' + req.stewardDepartment, 20, (page - 1) * 20]);
  res.json(r.rows.map(row => ({
    id: row.id, table_slug: row.table_slug, ordinal: row.ordinal, action: row.action,
    account: row.account, subject: row.subject, recorded_at: iso(row.recorded_at),
    business_day: row.business_day, column: null, before: null, after: null,
    previous_hash: row.previous_hash, entry_hash: row.entry_hash,
  })));
});

module.exports = { router, ALLOWED, CONFIRMATION_PHRASE, stewardDepartment };
