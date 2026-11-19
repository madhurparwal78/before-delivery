// The API routes. Every closed address answers 401 without a session; every department
// address answers 403 for a reader holding no role on it; a table that does not exist
// answers 404. One refusal shape carries the reason and the field everywhere.
const express = require('express');
const crypto = require('crypto');
const { pool, sha256, uid, businessDay } = require('./store');
const {
  refuse, now, iso, hashPassword, passwordProblem, emailProblem,
  SESSION_COOKIE, createSession, readSession, endSession, parseCookies,
  ROLE_ORDER, accountGrants, roleOn, roleAllows,
  tierGrantInForce, tierByName, rowContentBytes, kilobytes, tableContentBytesFor, previewContentBytes,
  ZERO_HASH, entryHash, logHead, appendLogEntry,
  OPERATORS_BY_TYPE, applyFilters, sortCompare, isEmptyValue,
  encodeCursor, decodeCursor, checkWriteBoundary,
} = require('./helpers');
const { validateValues, validateValue, normaliseValue } = require('./validation');

const router = express.Router();

// ---------- middleware ----------

// Attaches req.session and req.account when a valid session exists, without refusing.
async function attachSession(req, res, next) {
  const session = await readSession(req);
  if (session) {
    req.session = session;
    const r = await pool.query('SELECT * FROM accounts WHERE email = $1', [session.account]);
    req.account = r.rows[0] || null;
  }
  next();
}

// Refuses 401 when no session. The open addresses skip this.
function requireSession(req, res, next) {
  if (!req.session || !req.account) {
    return refuse(res, 401, 'Sign in to use this address.', 'session');
  }
  next();
}

// Loads the table named by slug. 404 when it does not exist, and a department refusal when
// the caller holds no role on its department.
async function loadTable(req, res) {
  const r = await pool.query('SELECT * FROM tables WHERE slug = $1', [req.params.slug]);
  const table = r.rows[0];
  if (!table) {
    refuse(res, 404, 'No table has this slug.', 'table');
    return null;
  }
  const role = await roleOn(req.account.email, table.department);
  if (!role) {
    refuse(res, 403, `This department is closed to you.`, 'department', { department: table.department });
    return null;
  }
  const cols = await pool.query(
    'SELECT * FROM columns WHERE table_id = $1 ORDER BY position', [table.id]);
  table.columns = cols.rows;
  return table;
}

function setSessionCookie(res, value) {
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`);
}

// ---------- health ----------

router.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ---------- auth ----------

const THROTTLE_LIMIT = 5;
const THROTTLE_WINDOW_MS = 15 * 60 * 1000;

// The throttle is keyed on the work email alone and never on the caller's address.
async function recentRefusals(email) {
  const r = await pool.query(
    'SELECT count(*) AS c FROM login_attempts WHERE email = $1 AND outcome = $2 AND attempted_at > $3',
    [email, 'refused', new Date(Date.now() - THROTTLE_WINDOW_MS)]);
  return Number(r.rows[0].c);
}

async function throttleDeadline(email) {
  const r = await pool.query(
    'SELECT min(attempted_at) AS first FROM login_attempts WHERE email = $1 AND outcome = $2 AND attempted_at > $3',
    [email, 'refused', new Date(Date.now() - THROTTLE_WINDOW_MS)]);
  const first = r.rows[0].first ? new Date(r.rows[0].first).getTime() : Date.now();
  return Math.ceil((first + THROTTLE_WINDOW_MS - Date.now()) / 1000);
}

async function recordAttempt(email, outcome) {
  await pool.query(
    'INSERT INTO login_attempts (id, email, attempted_at, outcome) VALUES ($1,$2,$3,$4)',
    [uid('la'), email, now(), outcome]);
}

// A wrong password and an email nobody holds are each refused with the same body word for word.
const LOGIN_REFUSAL = { reason: 'Email or password is wrong.', field: 'email' };

router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim()) {
    return res.status(401).json(LOGIN_REFUSAL);
  }
  const workEmail = email.trim().toLowerCase();
  if ((await recentRefusals(workEmail)) >= THROTTLE_LIMIT) {
    res.setHeader('Retry-After', String(Math.max(1, await throttleDeadline(workEmail))));
    return res.status(429).json({ reason: 'Too many attempts. Wait before trying again.', field: 'email' });
  }
  const r = await pool.query('SELECT * FROM accounts WHERE email = $1', [workEmail]);
  const account = r.rows[0];
  const ok = account && hashPassword(password) === account.password_hash;
  await recordAttempt(workEmail, ok ? 'succeeded' : 'refused');
  if (!ok) {
    return res.status(401).json(LOGIN_REFUSAL);
  }
  // A successful sign in clears the refused count for that email.
  await pool.query(
    'DELETE FROM login_attempts WHERE email = $1 AND outcome = $2', [workEmail, 'refused']);
  const session = await createSession(account.email);
  setSessionCookie(res, session.value);
  const grants = await accountGrants(account.email);
  res.json({ token: session.value, access_token: session.value, account: { email: account.email, display_name: account.display_name, department: account.department, tier: account.tier }, grants });
});

router.post('/auth/signup', async (req, res) => {
  const { email, display_name, department, password, tier } = req.body || {};
  // Tier is mandatory and accepts the four tier names and no others.
  if (!['starter', 'team', 'scale', 'regulated'].includes(tier)) {
    return refuse(res, 422, 'Choose one of the four tiers.', 'tier');
  }
  if (typeof department !== 'string' || !['claims', 'underwriting', 'actuarial'].includes(department)) {
    return refuse(res, 422, 'Choose one of the three departments.', 'department');
  }
  if (typeof display_name !== 'string' || !display_name.trim() || display_name.length > 100) {
    return refuse(res, 422, 'A display name is required.', 'display_name');
  }
  // A malformed email and an email already recorded are refused with the same body word for
  // word, so a stranger learns nothing about who holds an account.
  if (emailProblem(email)) {
    return refuse(res, 422, 'This email cannot be used.', 'email');
  }
  const workEmail = email.trim().toLowerCase();
  const problem = passwordProblem(password);
  if (problem) {
    return refuse(res, 422, problem, 'password');
  }
  const existing = await pool.query('SELECT id FROM accounts WHERE email = $1', [workEmail]);
  if (existing.rows.length > 0) {
    return refuse(res, 422, 'This email cannot be used.', 'email');
  }
  const id = uid('acct');
  await pool.query(
    'INSERT INTO accounts (id, email, display_name, department, password_hash, tier, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, workEmail, display_name.trim(), department, hashPassword(password), tier, now()]);
  // A sign up creates no role grant at all, not even on the department it names.
  res.status(201).json({ id, email: workEmail, display_name: display_name.trim(), department, tier });
});

router.post('/auth/logout', requireSession, async (req, res) => {
  await endSession(req.session.value);
  res.status(204).end();
});

// ---------- login attempts (stewards only) ----------

router.get('/login-attempts', requireSession, async (req, res) => {
  const grants = await accountGrants(req.account.email);
  const isSteward = grants.some(g => g.role === 'steward');
  if (!isSteward) {
    return refuse(res, 403, 'Only a steward reads the sign-in attempt record.', 'role');
  }
  const r = await pool.query('SELECT id, email, attempted_at, outcome FROM login_attempts ORDER BY attempted_at DESC, id DESC');
  res.json(r.rows.map(row => ({ ...row, attempted_at: iso(row.attempted_at) })));
});

// ---------- tiers ----------

router.get('/tiers', async (req, res) => {
  const r = await pool.query('SELECT * FROM tiers ORDER BY position');
  res.json(r.rows.map(t => ({
    id: t.id, name: t.name, row_allowance: t.row_allowance,
    stored_megabytes: t.stored_megabytes,
    content_allowance_kilobytes: t.content_allowance_kilobytes,
    view_allowance: t.view_allowance, retention: t.retention,
  })));
});

// ---------- departments and grants ----------

router.get('/departments/:slug/grants', requireSession, async (req, res) => {
  const role = await roleOn(req.account.email, req.params.slug);
  if (!role) {
    return refuse(res, 403, 'This department is closed to you.', 'department', { department: req.params.slug });
  }
  const r = await pool.query(
    'SELECT * FROM department_grants WHERE department = $1 ORDER BY effective_at', [req.params.slug]);
  const at = now();
  res.json(r.rows.map(g => ({
    id: g.id, department: g.department, tier: g.tier,
    effective_at: iso(g.effective_at),
    in_force: new Date(g.effective_at).getTime() <= at.getTime(),
  })));
});

// ---------- tables ----------

async function tableAnswer(table, at) {
  const countR = await pool.query('SELECT count(*) AS c FROM rows WHERE table_id = $1', [table.id]);
  const count = Number(countR.rows[0].c);
  const logR = await pool.query(
    'SELECT COALESCE(max(ordinal), 0) AS m FROM log_entries WHERE table_slug = $1', [table.slug]);
  const tier = await tierGrantInForce(table.department, at);
  const contentBytes = await tableContentBytesFor(table.id, pool);
  return {
    id: table.id,
    slug: table.slug,
    name: table.name,
    department: table.department,
    tier: tier ? tier.tier : table.tier,
    locked_period: table.locked_period,
    columns: table.columns.map(c => ({
      id: c.id, caption: c.caption, position: c.position, type: c.type, options: c.options || null,
    })),
    row_allowance: tier ? tier.row_allowance : null,
    allowance: tier ? tier.row_allowance : null,
    view_allowance: tier ? tier.view_allowance : null,
    content_allowance_kilobytes: tier ? tier.content_allowance_kilobytes : null,
    count,
    stored_kilobytes: count * 2,
    content_bytes: contentBytes,
    content_kilobytes: kilobytes(contentBytes),
    log_high_ordinal: Number(logR.rows[0].m),
    read_at: iso(at),
  };
}

router.get('/tables', requireSession, async (req, res) => {
  const grants = await accountGrants(req.account.email);
  const departments = grants.map(g => g.department);
  const r = await pool.query('SELECT * FROM tables ORDER BY name');
  const out = [];
  for (const table of r.rows) {
    if (!departments.includes(table.department)) continue;
    const cols = await pool.query('SELECT * FROM columns WHERE table_id = $1 ORDER BY position', [table.id]);
    table.columns = cols.rows;
    out.push(await tableAnswer(table, now()));
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  res.json(out);
});

router.get('/tables/:slug', requireSession, async (req, res) => {
  const table = await loadTable(req, res);
  if (!table) return;
  res.json(await tableAnswer(table, now()));
});

// ---------- rows ----------

function rowAnswer(row) {
  return { id: row.id, values: row.values, version: row.version };
}

// Reads one page of rows for a caller who may read the table. `view` narrows and orders;
// without one the rows answer in insertion order. The total travels in X-Total-Count and the
// next cursor in X-Next-Cursor.
async function readRows({ table, view, page, perPage, cursor, sortOverride }) {
  const rowsR = await pool.query(
    'SELECT * FROM rows WHERE table_id = $1 ORDER BY inserted_at ASC, id ASC', [table.id]);
  let rows = rowsR.rows.map(r => ({ id: r.id, values: r.values, version: r.version, inserted_at: r.inserted_at }));
  const filters = view ? (view.filters || []) : [];
  const sorts = sortOverride && sortOverride.column
    ? [sortOverride]
    : (view ? (view.sorts || []) : []);
  rows = rows.filter(row => applyFilters(table.columns, filters, row.values));
  if (sorts.length > 0) {
    rows = rows.slice().sort((a, b) => sortCompare(table.columns, sorts, a, b));
  }
  const total = rows.length;
  let offset;
  if (cursor) {
    offset = cursor.o;
  } else {
    offset = (page - 1) * perPage;
  }
  const slice = rows.slice(offset, offset + perPage);
  return { rows: slice, total, nextOffset: offset + slice.length };
}

router.get('/tables/:slug/rows', requireSession, async (req, res) => {
  const table = await loadTable(req, res);
  if (!table) return;
  let perPage = Number(req.query.per_page || 100);
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 500) {
    if (perPage > 500) {
      return refuse(res, 422, 'A page carries at most 500 rows.', 'per_page');
    }
    return refuse(res, 422, 'A page carries at most 500 rows.', 'per_page');
  }
  const page = Math.max(1, Number(req.query.page || 1) || 1);
  let view = null;
  if (req.query.view) {
    const v = await pool.query('SELECT * FROM views WHERE id = $1', [req.query.view]);
    const candidate = v.rows[0];
    if (candidate && candidate.table_id === table.id) {
      // A private view is read by its owner alone; a shared view by the department.
      if (candidate.visibility === 'shared' || candidate.owner === req.account.email) {
        view = candidate;
      }
    }
  }
  let cursor = null;
  if (req.query.cursor) {
    cursor = decodeCursor(req.query.cursor);
    if (!cursor || cursor.k !== 'rows' || cursor.s !== table.slug) {
      return refuse(res, 422, 'This cursor belongs to another table.', 'cursor');
    }
  }
  let sortOverride = null;
  if (req.query.sort) {
    const column = table.columns.find(c => c.caption === req.query.sort);
    if (column) sortOverride = { column: req.query.sort, direction: 'asc' };
  }
  const { rows, total, nextOffset } = await readRows({ table, view, page, perPage, cursor, sortOverride });
  res.setHeader('X-Total-Count', String(total));
  const next = nextOffset < total
    ? encodeCursor('rows', table.slug, nextOffset)
    : '';
  res.setHeader('X-Next-Cursor', next);
  res.json(rows.map(rowAnswer));
});

// A create may carry an Idempotency-Key. The server records the key against the answer and
// keeps the record for 24 hours; a replay answers the first answer byte for byte.
router.post('/tables/:slug/rows', requireSession, async (req, res) => {
  const table = await loadTable(req, res);
  if (!table) return;
  const idempotencyKey = req.headers['idempotency-key'];
  const body = req.body || {};
  const values = body.values;
  if (!values || typeof values !== 'object') {
    return refuse(res, 422, 'A row needs its values keyed by column caption.', 'values');
  }
  const bodyHash = sha256(JSON.stringify(body));
  if (idempotencyKey) {
    const existing = await pool.query('SELECT * FROM idempotency_keys WHERE key = $1', [idempotencyKey]);
    const prior = existing.rows[0];
    if (prior) {
      if (prior.table_slug !== table.slug || prior.body_hash !== bodyHash) {
        return refuse(res, 409, 'This idempotency key was used for another request.', 'idempotency_key');
      }
      if (Date.now() - new Date(prior.seen_at).getTime() > 24 * 3600 * 1000) {
        await pool.query('DELETE FROM idempotency_keys WHERE key = $1', [idempotencyKey]);
      } else {
        res.status(prior.status);
        res.setHeader('Content-Type', 'application/json');
        return res.send(prior.response_body);
      }
    }
  }
  // The write boundary: role, then lock, then allowance, then version, then type.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const refusal = await checkWriteBoundary({ table, columns: table.columns, accountEmail: req.account.email, row: null, newValues: values, client });
    if (refusal) {
      await client.query('ROLLBACK');
      if (idempotencyKey) {
        await pool.query(
          'INSERT INTO idempotency_keys (id, key, table_slug, body_hash, status, response_body, seen_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [uid('ik'), idempotencyKey, table.slug, bodyHash, refusal.status, JSON.stringify({ reason: refusal.reason, field: refusal.field, ...refusal.extra }), now()]);
      }
      return refuse(res, refusal.status, refusal.reason, refusal.field, refusal.extra);
    }
    const typeRefusals = validateValues(table.columns, values);
    if (typeRefusals.length > 0) {
      await client.query('ROLLBACK');
      const first = typeRefusals[0];
      if (idempotencyKey) {
        await pool.query(
          'INSERT INTO idempotency_keys (id, key, table_slug, body_hash, status, response_body, seen_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [uid('ik'), idempotencyKey, table.slug, bodyHash, first.status, JSON.stringify({ reason: first.reason, field: first.field }), now()]);
      }
      return refuse(res, first.status, first.reason, first.field);
    }
    const stored = {};
    for (const column of table.columns) {
      const normalised = normaliseValue(column, values[column.caption]);
      if (normalised !== undefined) stored[column.caption] = normalised;
    }
    const id = uid('row');
    const positionR = await client.query(
      'SELECT COALESCE(max(inserted_at), 0) AS m FROM rows WHERE table_id = $1', [table.id]);
    const insertedAt = Number(positionR.rows[0].m) + 1;
    await client.query(
      'INSERT INTO rows (id, table_id, values, inserted_at, version) VALUES ($1,$2,$3,$4,$5)',
      [id, table.id, JSON.stringify(stored), insertedAt, 1]);
    const recordedAt = now();
    await appendLogEntry(client, table.slug, 'create', req.account.email, null, null, stored, null, recordedAt);
    await client.query('COMMIT');
    const answer = { id, values: stored, version: 1 };
    if (idempotencyKey) {
      await pool.query(
        'INSERT INTO idempotency_keys (id, key, table_slug, body_hash, status, response_body, seen_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [uid('ik'), idempotencyKey, table.slug, bodyHash, 201, JSON.stringify(answer), now()]);
    }
    res.status(201).json(answer);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

router.get('/tables/:slug/rows/:id', requireSession, async (req, res) => {
  const table = await loadTable(req, res);
  if (!table) return;
  const r = await pool.query('SELECT * FROM rows WHERE id = $1 AND table_id = $2', [req.params.id, table.id]);
  if (!r.rows[0]) return refuse(res, 404, 'No row has this id in this table.', 'row');
  res.json(rowAnswer(r.rows[0]));
});

router.patch('/tables/:slug/rows/:id', requireSession, async (req, res) => {
  const table = await loadTable(req, res);
  if (!table) return;
  const body = req.body || {};
  const values = body.values;
  if (!values || typeof values !== 'object') {
    return refuse(res, 422, 'An amendment needs its values keyed by column caption.', 'values');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rowR = await client.query('SELECT * FROM rows WHERE id = $1 AND table_id = $2 FOR UPDATE', [req.params.id, table.id]);
    const row = rowR.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return refuse(res, 404, 'No row has this id in this table.', 'row');
    }
    // The version is read after the role, the lock and the allowance and before the column type.
    const ifMatch = req.headers['if-match-version'];
    if (ifMatch !== undefined && ifMatch !== '') {
      const stated = Number(ifMatch);
      if (!Number.isInteger(stated) || stated !== row.version) {
        await client.query('ROLLBACK');
        return refuse(res, 409, 'This row has moved on.', 'version', { current_version: row.version });
      }
    }
    const refusal = await checkWriteBoundary({ table, columns: table.columns, accountEmail: req.account.email, row, newValues: { ...row.values, ...values }, client });
    if (refusal) {
      await client.query('ROLLBACK');
      return refuse(res, refusal.status, refusal.reason, refusal.field, refusal.extra);
    }
    const typeRefusals = validateValues(table.columns, values);
    if (typeRefusals.length > 0) {
      await client.query('ROLLBACK');
      const first = typeRefusals[0];
      return refuse(res, first.status, first.reason, first.field);
    }
    const stored = { ...row.values };
    const amended = [];
    for (const column of table.columns) {
      if (!(column.caption in values)) continue;
      const normalised = normaliseValue(column, values[column.caption]);
      const before = row.values[column.caption];
      const after = normalised === undefined ? before : normalised;
      if (JSON.stringify(before) !== JSON.stringify(after) || (normalised === null && before !== null && before !== undefined) || (normalised !== null && normalised !== undefined && JSON.stringify(before) !== JSON.stringify(after))) {
        stored[column.caption] = after;
        amended.push({ column, before, after });
      }
    }
    if (amended.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ id: row.id, values: row.values, version: row.version });
    }
    const newVersion = row.version + 1;
    await client.query(
      'UPDATE rows SET values = $1, version = $2 WHERE id = $3',
      [JSON.stringify(stored), newVersion, row.id]);
    const recordedAt = now();
    for (const change of amended) {
      await appendLogEntry(client, table.slug, 'update', req.account.email, change.column.caption, change.before, change.after, null, recordedAt);
    }
    await client.query('COMMIT');
    res.json({ id: row.id, values: stored, version: newVersion });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

router.delete('/tables/:slug/rows/:id', requireSession, async (req, res) => {
  const table = await loadTable(req, res);
  if (!table) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rowR = await client.query('SELECT * FROM rows WHERE id = $1 AND table_id = $2 FOR UPDATE', [req.params.id, table.id]);
    const row = rowR.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return refuse(res, 404, 'No row has this id in this table.', 'row');
    }
    const refusal = await checkWriteBoundary({ table, columns: table.columns, accountEmail: req.account.email, row, newValues: row.values, client });
    if (refusal) {
      await client.query('ROLLBACK');
      return refuse(res, refusal.status, refusal.reason, refusal.field, refusal.extra);
    }
    await client.query('DELETE FROM rows WHERE id = $1', [row.id]);
    const recordedAt = now();
    await appendLogEntry(client, table.slug, 'delete', req.account.email, null, row.values, null, null, recordedAt);
    await client.query('COMMIT');
    res.status(204).end();
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// ---------- columns ----------

router.post('/tables/:slug/columns', requireSession, async (req, res) => {
  const table = await loadTable(req, res);
  if (!table) return;
  const role = await roleOn(req.account.email, table.department);
  if (!roleAllows('amend_rows', role)) {
    return refuse(res, 403, 'Your role does not amend rows.', 'role');
  }
  if (table.locked_period) {
    return refuse(res, 409, `This table is locked for period ${table.locked_period}.`, 'locked_period', { locked_period: table.locked_period });
  }
  const { caption, type, options } = req.body || {};
  if (typeof caption !== 'string' || !caption.trim() || caption.length > 100) {
    return refuse(res, 422, 'A column needs a caption.', 'caption');
  }
  if (!['text', 'integer', 'decimal', 'date', 'choice', 'flag'].includes(type)) {
    return refuse(res, 422, 'A column needs one of the six types.', 'type');
  }
  if (type === 'choice' && (!Array.isArray(options) || options.length === 0)) {
    return refuse(res, 422, 'A choice column needs its option list.', 'options');
  }
  const dup = await pool.query('SELECT id FROM columns WHERE table_id = $1 AND caption = $2', [table.id, caption.trim()]);
  if (dup.rows.length > 0) {
    return refuse(res, 409, 'A column of this caption already exists.', 'caption');
  }
  const positionR = await pool.query('SELECT COALESCE(max(position), 0) AS m FROM columns WHERE table_id = $1', [table.id]);
  const id = uid('col');
  await pool.query(
    'INSERT INTO columns (id, table_id, caption, position, type, options) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, table.id, caption.trim(), Number(positionR.rows[0].m) + 1, type, type === 'choice' ? JSON.stringify(options) : null]);
  res.status(201).json({ id, caption: caption.trim(), position: Number(positionR.rows[0].m) + 1, type, options: type === 'choice' ? options : null });
});

router.delete('/tables/:slug/columns/:id', requireSession, async (req, res) => {
  const table = await loadTable(req, res);
  if (!table) return;
  const role = await roleOn(req.account.email, table.department);
  if (!roleAllows('amend_rows', role)) {
    return refuse(res, 403, 'Your role does not amend rows.', 'role');
  }
  if (table.locked_period) {
    return refuse(res, 409, `This table is locked for period ${table.locked_period}.`, 'locked_period', { locked_period: table.locked_period });
  }
  const colR = await pool.query('SELECT * FROM columns WHERE id = $1 AND table_id = $2', [req.params.id, table.id]);
  const column = colR.rows[0];
  if (!column) return refuse(res, 404, 'No column has this id in this table.', 'column');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM columns WHERE id = $1', [column.id]);
    // Removing a column closes the gap it left, so positions stay contiguous.
    await client.query(
      'UPDATE columns SET position = position - 1 WHERE table_id = $1 AND position > $2',
      [table.id, column.position]);
    // The change log entries that reference the removed column survive the removal unchanged.
    await client.query('COMMIT');
    res.status(204).end();
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// ---------- views ----------

router.get('/tables/:slug/views', requireSession, async (req, res) => {
  const table = await loadTable(req, res);
  if (!table) return;
  const r = await pool.query('SELECT * FROM views WHERE table_id = $1 ORDER BY name', [table.id]);
  res.json(r.rows.filter(v => v.visibility === 'shared' || v.owner === req.account.email).map(v => ({
    id: v.id, name: v.name, owner: v.owner, visibility: v.visibility, filters: v.filters, sorts: v.sorts,
  })));
});

// Creating shared views past the tier's shared view allowance is refused naming the tier, the
// allowance and the count.
router.post('/tables/:slug/views', requireSession, async (req, res) => {
  const table = await loadTable(req, res);
  if (!table) return;
  const role = await roleOn(req.account.email, table.department);
  if (!roleAllows('manage_views', role)) {
    return refuse(res, 403, 'Your role does not manage views.', 'role');
  }
  const { name, visibility, filters, sorts } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.length > 100) {
    return refuse(res, 422, 'A view needs a name.', 'name');
  }
  if (visibility !== 'private' && visibility !== 'shared') {
    return refuse(res, 422, 'A view is private to its owner or shared with the department.', 'visibility');
  }
  const cleanFilters = [];
  for (const f of Array.isArray(filters) ? filters : []) {
    const column = table.columns.find(c => c.caption === f.column);
    if (!column) return refuse(res, 422, 'A filter names a column of this table.', 'filters');
    if (!OPERATORS_BY_TYPE[column.type].includes(f.operator)) {
      return refuse(res, 422, 'That operator is not offered for this column type.', 'filters');
    }
    if (f.operator !== 'is empty' && (f.value === undefined || f.value === null)) {
      return refuse(res, 422, 'A filter carries a value.', 'filters');
    }
    cleanFilters.push({ column: f.column, operator: f.operator, value: f.value });
  }
  const cleanSorts = [];
  for (const s of Array.isArray(sorts) ? sorts : []) {
    const column = table.columns.find(c => c.caption === s.column);
    if (!column) return refuse(res, 422, 'A sort names a column of this table.', 'sorts');
    if (s.direction !== 'asc' && s.direction !== 'desc') {
      return refuse(res, 422, 'A sort runs asc or desc.', 'sorts');
    }
    cleanSorts.push({ column: s.column, direction: s.direction });
  }
  if (visibility === 'shared') {
    const tier = await tierGrantInForce(table.department, now());
    const countR = await pool.query(
      'SELECT count(*) AS c FROM views WHERE table_id = $1 AND visibility = $2', [table.id, 'shared']);
    const count = Number(countR.rows[0].c);
    if (count >= tier.view_allowance) {
      return refuse(res, 422,
        `The ${tier.tier} tier allows ${tier.view_allowance} shared views per table and this table holds ${count}.`,
        'view_allowance', { tier: tier.tier, allowance: tier.view_allowance, count });
    }
  }
  const id = uid('view');
  await pool.query(
    'INSERT INTO views (id, table_id, name, owner, visibility, filters, sorts) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, table.id, name.trim(), req.account.email, visibility, JSON.stringify(cleanFilters), JSON.stringify(cleanSorts)]);
  res.status(201).json({ id, name: name.trim(), owner: req.account.email, visibility, filters: cleanFilters, sorts: cleanSorts });
});

router.delete('/tables/:slug/views/:id', requireSession, async (req, res) => {
  const table = await loadTable(req, res);
  if (!table) return;
  const role = await roleOn(req.account.email, table.department);
  if (!roleAllows('manage_views', role)) {
    return refuse(res, 403, 'Your role does not manage views.', 'role');
  }
  const vR = await pool.query('SELECT * FROM views WHERE id = $1 AND table_id = $2', [req.params.id, table.id]);
  const view = vR.rows[0];
  if (!view) return refuse(res, 404, 'No view has this id in this table.', 'view');
  // A private view is managed by its owner alone.
  if (view.visibility === 'private' && view.owner !== req.account.email) {
    return refuse(res, 403, 'A private view is managed by its owner.', 'visibility');
  }
  await pool.query('DELETE FROM views WHERE id = $1', [view.id]);
  res.status(204).end();
});

// ---------- the change log ----------

function logEntryAnswer(row) {
  return {
    id: row.id,
    table_slug: row.table_slug,
    ordinal: row.ordinal,
    action: row.action,
    account: row.account,
    subject: row.subject || null,
    recorded_at: iso(row.recorded_at),
    business_day: row.business_day,
    column: row.column_caption === null ? null : row.column_caption,
    before: row.before,
    after: row.after,
    previous_hash: row.previous_hash,
    entry_hash: row.entry_hash,
  };
}

// No role amends the change log, so an amend verb answers 403 rather than a method error.
router.all('/tables/:slug/log', requireSession, async (req, res, next) => {
  if (req.method !== 'GET') {
    return refuse(res, 403, 'The change log is append-only and no role amends it.', 'log');
  }
  next();
});

router.get('/tables/:slug/log', requireSession, async (req, res) => {
  const table = await loadTable(req, res);
  if (!table) return;
  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const perPage = 20;
  const params = [table.slug];
  let where = 'table_slug = $1';
  if (req.query.action) {
    params.push(req.query.action);
    where += ` AND action = $${params.length}`;
  }
  if (req.query.account) {
    params.push(req.query.account);
    where += ` AND account = $${params.length}`;
  }
  const r = await pool.query(
    `SELECT * FROM log_entries WHERE ${where} ORDER BY ordinal DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, perPage, (page - 1) * perPage]);
  res.json(r.rows.map(logEntryAnswer));
});

// ---------- locks ----------

router.post('/tables/:slug/lock', requireSession, async (req, res) => {
  const table = await loadTable(req, res);
  if (!table) return;
  const role = await roleOn(req.account.email, table.department);
  if (!roleAllows('decide', role)) {
    return refuse(res, 403, 'Only a steward locks a table.', 'role');
  }
  const { period } = req.body || {};
  if (typeof period !== 'string' || !period.trim() || period.length > 60) {
    return refuse(res, 422, 'A lock needs a reporting period.', 'period');
  }
  await pool.query('UPDATE tables SET locked_period = $1 WHERE id = $2', [period.trim(), table.id]);
  res.json({ slug: table.slug, locked_period: period.trim() });
});

router.delete('/tables/:slug/lock', requireSession, async (req, res) => {
  const table = await loadTable(req, res);
  if (!table) return;
  const role = await roleOn(req.account.email, table.department);
  if (!roleAllows('decide', role)) {
    return refuse(res, 403, 'Only a steward unlocks a table.', 'role');
  }
  await pool.query('UPDATE tables SET locked_period = NULL WHERE id = $1', [table.id]);
  res.json({ slug: table.slug, locked_period: null });
});

// ---------- snapshots ----------

// The retention count a tier's retention words name: one, four, twelve or every one.
function retentionCount(retention) {
  switch (retention) {
    case 'one period': return 1;
    case 'four periods': return 4;
    case 'twelve periods': return 12;
    default: return Infinity;
  }
}

// Ranks a table's snapshots newest first and decides whether each is inside its retention.
// Computed at the read; the store keeps no `retained` column.
async function snapshotRanks(tableSlug) {
  const r = await pool.query(
    'SELECT id, tier, published_at FROM snapshots WHERE table_slug = $1 ORDER BY published_at DESC, id DESC', [tableSlug]);
  const byId = {};
  r.rows.forEach((row, index) => { byId[row.id] = index + 1; });
  return byId;
}

async function snapshotAnswer(row) {
  const ranks = await snapshotRanks(row.table_slug);
  const rank = ranks[row.id] || 1;
  const tier = await tierByName(row.tier);
  const retained = rank <= retentionCount(tier ? tier.retention : row.retention);
  return {
    id: row.id, table: row.table_slug, table_slug: row.table_slug, period: row.period,
    account: row.account,
    published_at: iso(row.published_at), business_day: row.business_day,
    sequence: row.sequence,
    tier: row.tier, row_allowance: row.row_allowance,
    content_allowance_kilobytes: row.content_allowance_kilobytes,
    retention: row.retention,
    row_count: row.row_count, content_bytes: row.content_bytes,
    retained,
  };
}

router.get('/snapshots', requireSession, async (req, res) => {
  const grants = await accountGrants(req.account.email);
  const departments = grants.map(g => g.department);
  const r = await pool.query('SELECT * FROM snapshots ORDER BY published_at DESC');
  const out = [];
  for (const row of r.rows) {
    if (req.query.table && row.table_slug !== req.query.table) continue;
    const tableR = await pool.query('SELECT * FROM tables WHERE slug = $1', [row.table_slug]);
    const table = tableR.rows[0];
    if (!table || !departments.includes(table.department)) continue;
    const answer = await snapshotAnswer(row);
    if (answer.retained) out.push(answer);
  }
  out.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  res.json(out);
});

router.get('/snapshots/:id', requireSession, async (req, res) => {
  const r = await pool.query('SELECT * FROM snapshots WHERE id = $1', [req.params.id]);
  const row = r.rows[0];
  if (!row) return refuse(res, 404, 'No snapshot has this id.', 'snapshot');
  const tableR = await pool.query('SELECT * FROM tables WHERE slug = $1', [row.table_slug]);
  const table = tableR.rows[0];
  const role = await roleOn(req.account.email, table.department);
  if (!role) {
    return refuse(res, 403, 'This department is closed to you.', 'department', { department: table.department });
  }
  const answer = await snapshotAnswer(row);
  if (!answer.retained) {
    return res.status(410).json({ reason: 'This snapshot has fallen outside its retention.', field: 'snapshot' });
  }
  // The frozen rows travel with the snapshot answer, computed once at publication.
  res.json({ ...answer, rows: row.rows });
});

// A snapshot is read-only at its own address: no amend verb is accepted.
router.all('/snapshots/:id', requireSession, (req, res, next) => {
  if (req.method !== 'GET') {
    return refuse(res, 403, 'A snapshot is read-only and no role amends it.', 'snapshot');
  }
  next();
});

router.post('/snapshots', requireSession, async (req, res) => {
  const { table: tableSlug, period } = req.body || {};
  if (typeof tableSlug !== 'string' || !tableSlug.trim()) {
    return refuse(res, 422, 'A snapshot names its table.', 'table');
  }
  if (typeof period !== 'string' || !period.trim() || period.length > 60) {
    return refuse(res, 422, 'A snapshot names its reporting period.', 'period');
  }
  const tableR = await pool.query('SELECT * FROM tables WHERE slug = $1', [tableSlug.trim()]);
  const table = tableR.rows[0];
  if (!table) return refuse(res, 404, 'No table has this slug.', 'table');
  const role = await roleOn(req.account.email, table.department);
  if (!roleAllows('decide', role)) {
    return refuse(res, 403, 'Only a steward publishes a snapshot.', 'role');
  }
  // Publishing never requires the table to be locked and the period is never checked against
  // the table's locked_period.
  const dup = await pool.query('SELECT id FROM snapshots WHERE table_slug = $1 AND period = $2', [table.slug, period.trim()]);
  if (dup.rows.length > 0) {
    return refuse(res, 409, 'A snapshot of this table for this period is already published.', 'period');
  }
  const cols = await pool.query('SELECT * FROM columns WHERE table_id = $1 ORDER BY position', [table.id]);
  const tier = await tierGrantInForce(table.department, now());
  const rowsR = await pool.query(
    'SELECT id, values FROM rows WHERE table_id = $1 ORDER BY inserted_at ASC, id ASC', [table.id]);
  const frozen = rowsR.rows.map(r => ({ id: r.id, values: r.values }));
  const contentBytes = frozen.reduce((sum, row) =>
    sum + cols.rows.reduce((s, c) => s + (require('./store').columnContribution(c.type, row.values[c.caption])), 0), 0);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // The department snapshot sequence is gap-free even when publishes arrive together.
    const seqR = await client.query(
      `SELECT COALESCE(max(sequence), 0) AS m FROM snapshots WHERE table_slug IN (
         SELECT slug FROM tables WHERE department = $1)`, [table.department]);
    const sequence = Number(seqR.rows[0].m) + 1;
    const id = uid('snap');
    const publishedAt = now();
    await client.query(
      `INSERT INTO snapshots (id, table_slug, period, account, published_at, business_day, sequence, tier, row_allowance, content_allowance_kilobytes, retention, row_count, content_bytes, rows)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, table.slug, period.trim(), req.account.email, publishedAt, businessDay(publishedAt), sequence,
       tier.tier, tier.row_allowance, tier.content_allowance_kilobytes, tier.retention,
       frozen.length, contentBytes, JSON.stringify(frozen)]);
    await client.query('COMMIT');
    const row = (await pool.query('SELECT * FROM snapshots WHERE id = $1', [id])).rows[0];
    res.status(201).json({ ...(await snapshotAnswer(row)), rows: row.rows });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') {
      return refuse(res, 409, 'A snapshot of this table for this period is already published.', 'period');
    }
    throw e;
  } finally {
    client.release();
  }
});

// ---------- requests ----------

function requestAnswer(row) {
  return {
    id: row.id, account: row.account, department: row.department, role: row.role,
    state: row.state, reason: row.reason === null ? null : row.reason,
    raised_at: iso(row.raised_at),
    decided_by: row.decided_by || null,
    decided_at: row.decided_at ? iso(row.decided_at) : null,
  };
}

router.get('/requests', requireSession, async (req, res) => {
  const grants = await accountGrants(req.account.email);
  const departments = grants.map(g => g.department);
  const r = await pool.query('SELECT * FROM requests ORDER BY raised_at DESC');
  let rows = r.rows;
  if (req.query.state) {
    rows = rows.filter(row => row.state === req.query.state);
  }
  // A reader sees its own requests and the requests of the departments it may read.
  rows = rows.filter(row => departments.includes(row.department) || row.account === req.account.email);
  res.json(rows.map(requestAnswer));
});

router.post('/requests', requireSession, async (req, res) => {
  const { department, role } = req.body || {};
  if (!['claims', 'underwriting', 'actuarial'].includes(department)) {
    return refuse(res, 422, 'Choose one of the three departments.', 'department');
  }
  if (!['viewer', 'analyst', 'editor', 'steward'].includes(role)) {
    return refuse(res, 422, 'Choose one of the four roles.', 'role');
  }
  // An account raises a request for a department it holds no role in.
  const existingRole = await roleOn(req.account.email, department);
  if (existingRole) {
    return refuse(res, 422, 'You already hold a role on this department.', 'department');
  }
  // One open request per account per department.
  const open = await pool.query(
    'SELECT id FROM requests WHERE account = $1 AND department = $2 AND state = $3',
    [req.account.email, department, 'open']);
  if (open.rows.length > 0) {
    return refuse(res, 409, 'An open request for this department already exists.', 'state');
  }
  const id = uid('req');
  const raisedAt = now();
  await pool.query(
    'INSERT INTO requests (id, account, department, role, state, reason, raised_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, req.account.email, department, role, 'open', null, raisedAt]);
  const row = (await pool.query('SELECT * FROM requests WHERE id = $1', [id])).rows[0];
  res.status(201).json(requestAnswer(row));
});

router.post('/requests/:id/decision', requireSession, async (req, res) => {
  const { decision, reason } = req.body || {};
  if (decision !== 'approved' && decision !== 'declined') {
    return refuse(res, 422, 'A decision is approved or declined.', 'decision');
  }
  const r = await pool.query('SELECT * FROM requests WHERE id = $1', [req.params.id]);
  const request = r.rows[0];
  if (!request) return refuse(res, 404, 'No request has this id.', 'request');
  // The requesting account is refused its own decision, steward or not.
  if (request.account === req.account.email) {
    return refuse(res, 403, 'The requesting account does not decide its own request.', 'account');
  }
  const stewardRole = await roleOn(req.account.email, request.department);
  if (stewardRole !== 'steward') {
    return refuse(res, 403, `This department is not yours to govern.`, 'department', { department: request.department });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lockR = await client.query('SELECT * FROM requests WHERE id = $1 FOR UPDATE', [request.id]);
    const fresh = lockR.rows[0];
    if (fresh.state !== 'open') {
      await client.query('ROLLBACK');
      return refuse(res, 409, 'This request has already been decided.', 'state');
    }
    const decidedAt = now();
    await client.query(
      'UPDATE requests SET state = $1, reason = $2, decided_by = $3, decided_at = $4 WHERE id = $5',
      [decision, typeof reason === 'string' ? reason : null, req.account.email, decidedAt, request.id]);
    if (decision === 'approved') {
      // An approval creates the role grant and the account reaches the department on its next
      // read. The grant is unique on account and department; a decided request never repeats.
      const existing = await client.query(
        'SELECT id FROM role_grants WHERE account = $1 AND department = $2', [fresh.account, fresh.department]);
      if (existing.rows.length === 0) {
        await client.query(
          'INSERT INTO role_grants (id, account, department, role, authorises_from, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
          [uid('rg'), fresh.account, fresh.department, fresh.role, decidedAt, decidedAt]);
      }
    }
    await appendLogEntry(client, 'admin-' + fresh.department, 'request_decided', req.account.email, null, null, null, fresh.account, decidedAt);
    await client.query('COMMIT');
    const row = (await pool.query('SELECT * FROM requests WHERE id = $1', [request.id])).rows[0];
    res.json(requestAnswer(row));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// ---------- enquiries and subscribers ----------

// An interface call carries a JSON body or a bearer token and carries no form_token; a
// browser form post carries the token its page issued.
function isFormPost(req) {
  const ct = String(req.headers['content-type'] || '');
  return ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data');
}

async function checkFormToken(req, res) {
  const token = req.body ? req.body.form_token : undefined;
  if (!token) {
    refuse(res, 403, 'A form post carries its form token.', 'form_token');
    return false;
  }
  const r = await pool.query('SELECT id FROM form_tokens WHERE value = $1', [token]);
  if (r.rows.length === 0) {
    refuse(res, 403, 'A form post carries its form token.', 'form_token');
    return false;
  }
  return true;
}

router.post('/enquiries', async (req, res) => {
  if (isFormPost(req)) {
    if (!(await checkFormToken(req, res))) return;
  }
  const { full_name, work_email, phone, company, role, message } = req.body || {};
  if (typeof full_name !== 'string' || !full_name.trim()) {
    return refuse(res, 422, 'A full name is required.', 'full_name');
  }
  if (typeof work_email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(work_email.trim())) {
    return refuse(res, 422, 'A work email is required and must be a valid address.', 'work_email');
  }
  if (typeof company !== 'string' || !company.trim()) {
    return refuse(res, 422, 'A company name is required.', 'company');
  }
  if (typeof message !== 'string' || !message.trim()) {
    return refuse(res, 422, 'A message is required.', 'message');
  }
  if (message.length > 1000) {
    return refuse(res, 422, 'A message holds at most 1000 characters.', 'message');
  }
  const id = uid('enq');
  await pool.query(
    'INSERT INTO enquiries (id, full_name, work_email, phone, company, role, message, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, full_name.trim(), work_email.trim().toLowerCase(), typeof phone === 'string' ? phone.trim() : null, company.trim(), typeof role === 'string' && role.trim() ? role.trim() : null, message, now()]);
  res.status(201).json({ id, full_name: full_name.trim(), work_email: work_email.trim().toLowerCase(), recorded: true });
});

// A repeat subscribe answers success and records one row, so a reader learns nothing.
router.post('/subscribers', async (req, res) => {
  if (isFormPost(req)) {
    if (!(await checkFormToken(req, res))) return;
  }
  const { email } = req.body || {};
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return refuse(res, 422, 'An email address is required.', 'email');
  }
  const address = email.trim().toLowerCase();
  const existing = await pool.query('SELECT id FROM subscribers WHERE email = $1', [address]);
  if (existing.rows.length === 0) {
    await pool.query('INSERT INTO subscribers (id, email) VALUES ($1,$2)', [uid('sub'), address]);
  }
  res.status(201).json({ email: address, subscribed: true });
});

// ---------- department snapshots and grants for the console ----------

router.get('/departments/:slug/counts', requireSession, async (req, res) => {
  const role = await roleOn(req.account.email, req.params.slug);
  if (!role) {
    return refuse(res, 403, 'This department is closed to you.', 'department', { department: req.params.slug });
  }
  const rows = await pool.query('SELECT count(*) AS c FROM rows WHERE table_id IN (SELECT id FROM tables WHERE department = $1)', [req.params.slug]);
  res.json({ department: req.params.slug, rows: Number(rows.rows[0].c) });
});

module.exports = { router, attachSession, loadTable, tableAnswer, snapshotAnswer, logEntryAnswer, requestAnswer, retentionCount, setSessionCookie, isFormPost };
