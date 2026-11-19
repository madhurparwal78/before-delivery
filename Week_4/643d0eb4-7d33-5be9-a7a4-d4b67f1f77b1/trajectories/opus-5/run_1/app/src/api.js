'use strict';
const express = require('express');
const db = require('./db');
const core = require('./core');
const views = require('./views');
const auth = require('./auth');
const access = require('./access');
const { refusal, sendRefusal } = core;
const {
  nowIso,
  businessDay,
  sign,
  unsign,
  randomToken,
  stableStringify,
  iso,
} = require('./util');

const router = express.Router();

const ROWS_DEFAULT_PER_PAGE = 100;
const ROWS_MAX_PER_PAGE = 500;
const LOG_PER_PAGE = 20;
const QUEUE_PER_PAGE = 20;

function wrap(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/* ------------------------------------------------------------------ *
 * Health, tiers and grants
 * ------------------------------------------------------------------ */

router.get('/health', wrap(async (req, res) => {
  await db.query('SELECT 1');
  res.status(200).json({ status: 'ready' });
}));

router.get('/tiers', wrap(async (req, res) => {
  const tiers = await core.listTiers();
  res.status(200).json(
    tiers.map((t) => ({
      name: t.name,
      audience: t.audience,
      row_allowance: t.row_allowance,
      stored_megabytes: t.stored_megabytes,
      content_allowance_kilobytes: t.content_allowance_kilobytes,
      view_allowance: t.view_allowance,
      retention: t.retention,
      most_chosen: t.most_chosen,
    }))
  );
}));

router.get('/departments/:slug/grants', wrap(async (req, res) => {
  auth.requireSession(req);
  const slug = req.params.slug;
  const dep = await db.one('SELECT slug FROM departments WHERE slug = $1', [slug]);
  if (!dep) throw refusal(404, 'That department is not part of Keystone Tables.', 'department');
  access.requireDepartment(req.auth, slug, 'read');
  res.status(200).json(await core.listDepartmentGrants(slug));
}));

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

router.post('/auth/login', wrap(auth.login));
router.post('/auth/signup', wrap(auth.signup));
router.post('/auth/logout', wrap(auth.logout));

router.get('/login-attempts', wrap(async (req, res) => {
  auth.requireSession(req);
  if (!(await access.isSteward(req.auth))) throw core.STEWARDS_ONLY();
  const rows = await db.all(
    'SELECT id, email, attempted_at, outcome FROM login_attempts ORDER BY attempted_at DESC, id DESC LIMIT 200'
  );
  res.status(200).json(
    rows.map((r) => ({ id: String(r.id), email: r.email, attempted_at: r.attempted_at, outcome: r.outcome }))
  );
}));

router.get('/account', wrap(async (req, res) => {
  const a = auth.requireSession(req);
  const grants = await core.allGrantsFor(a.account.email);
  res.status(200).json({
    email: a.account.email,
    display_name: a.account.display_name,
    department: a.account.department,
    tier: a.account.tier,
    role_grants: grants.map((g) => ({
      id: String(g.id),
      account: g.account,
      department: g.department,
      role: g.role,
      authorises_from: g.authorises_from,
    })),
  });
}));

/* ------------------------------------------------------------------ *
 * Tables
 * ------------------------------------------------------------------ */

router.get('/tables', wrap(async (req, res) => {
  auth.requireSession(req);
  const departments = access.departmentsFor(req.auth);
  if (!departments.length) return res.status(200).json([]);
  const tables = await db.all(
    'SELECT slug FROM tables WHERE department = ANY($1::text[]) ORDER BY name ASC',
    [departments]
  );
  const out = [];
  for (const t of tables) out.push(await core.tableAnswer(t.slug));
  res.status(200).json(out);
}));

router.get('/tables/:slug', wrap(async (req, res) => {
  auth.requireSession(req);
  const table = await access.requireTable(req.params.slug);
  access.requireDepartment(req.auth, table.department, 'read');
  res.status(200).json(await core.tableAnswer(table.slug));
}));

/* -------------------------- rows ---------------------------------- */

function parsePerPage(raw) {
  if (raw === undefined || raw === '') return ROWS_DEFAULT_PER_PAGE;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw refusal(422, 'A page carries at most 500 rows.', 'per_page');
  }
  if (n > ROWS_MAX_PER_PAGE) {
    throw refusal(422, 'A page carries at most 500 rows.', 'per_page');
  }
  return n;
}

function parsePage(raw) {
  if (raw === undefined || raw === '') return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return 1;
  return n;
}

async function resolveView(table, cols, auth_, raw) {
  if (!raw) return null;
  const row = await db.one(
    'SELECT id, table_slug, name, owner, visibility, filters, sorts FROM views WHERE table_slug = $1 AND (id::text = $2 OR name = $2)',
    [table.slug, String(raw)]
  );
  if (!row) throw refusal(404, 'That view is not part of this table.', 'view');
  if (row.visibility === 'private' && row.owner !== auth_.account.email) {
    throw refusal(403, 'That view is private to its owner.', 'view');
  }
  return row;
}

router.get('/tables/:slug/rows', wrap(async (req, res) => {
  const a = auth.requireSession(req);
  const table = await access.requireTable(req.params.slug);
  access.requireDepartment(req.auth, table.department, 'read');
  const cols = await core.columnsFor(table.slug);

  const view = await resolveView(table, cols, a, req.query.view);
  const filters = view ? view.filters || [] : [];
  let sorts = view ? view.sorts || [] : [];

  // The console's Sort picker replaces the view's own sorts.
  if (req.query.sort) {
    const col = cols.find((c) => c.caption === String(req.query.sort));
    if (!col) throw refusal(422, 'That column is not part of this table.', 'sort');
    sorts = [{ column: col.caption, direction: 'asc' }];
  }

  const perPage = parsePerPage(req.query.per_page);
  const params = [table.slug];
  const built = views.buildRowQuery(cols, filters, sorts, params);
  const whereSql = ['table_slug = $1'].concat(built.where).join(' AND ');
  const filterParams = params.slice(0, built.filterCount);

  const totalRes = await db.query(`SELECT count(*)::int AS n FROM rows WHERE ${whereSql}`, filterParams);
  const total = totalRes.rows[0].n;

  let rows;
  if (req.query.cursor) {
    const decoded = unsign(String(req.query.cursor));
    if (!decoded || decoded.k !== 'rows' || decoded.t !== table.slug) {
      throw refusal(422, 'This cursor belongs to another table.', 'cursor');
    }
    const cursorAfter = Number(decoded.after) || 0;
    const p = filterParams.slice();
    p.push(cursorAfter);
    const afterSql = `$${p.length}`;
    p.push(perPage);
    rows = await db.all(
      `SELECT id, table_slug, values, version, inserted_position FROM rows
       WHERE ${whereSql} AND inserted_position > ${afterSql}
       ORDER BY inserted_position ASC LIMIT $${p.length}`,
      p
    );
  } else {
    const page = parsePage(req.query.page);
    const p = params.slice();
    p.push(perPage);
    const limitSql = `$${p.length}`;
    p.push((page - 1) * perPage);
    rows = await db.all(
      `SELECT id, table_slug, values, version, inserted_position FROM rows
       WHERE ${whereSql} ORDER BY ${built.order.join(', ')} LIMIT ${limitSql} OFFSET $${p.length}`,
      p
    );
  }

  // Issue the cursor for the page after the one just answered.
  let nextCursor = '';
  if (rows.length) {
    const highest = rows.reduce((m, r) => Math.max(m, Number(r.inserted_position)), 0);
    const p = filterParams.slice();
    p.push(highest);
    const more = await db.one(
      `SELECT 1 FROM rows WHERE ${whereSql} AND inserted_position > $${p.length} LIMIT 1`,
      p
    );
    if (more) nextCursor = sign({ k: 'rows', t: table.slug, after: highest });
  }

  res.set('X-Total-Count', String(total));
  res.set('X-Next-Cursor', nextCursor);
  res.set('Access-Control-Expose-Headers', 'X-Total-Count, X-Next-Cursor');
  res.status(200).json(rows.map(core.publicRow));
}));

router.get('/tables/:slug/rows/:id', wrap(async (req, res) => {
  auth.requireSession(req);
  const table = await access.requireTable(req.params.slug);
  access.requireDepartment(req.auth, table.department, 'read');
  const row = await db.one(
    'SELECT id, table_slug, values, version, inserted_position FROM rows WHERE table_slug = $1 AND id::text = $2',
    [table.slug, req.params.id]
  );
  if (!row) throw refusal(404, 'That row is not part of this table.', 'row');
  res.status(200).json(core.publicRow(row));
}));

/* ---- create, with an optional idempotency key ---- */

router.post('/tables/:slug/rows', wrap(async (req, res) => {
  const a = auth.requireSession(req);
  const table = await access.requireTable(req.params.slug);
  const role = access.roleFor(req.auth, table.department);
  if (!role) throw core.DEPARTMENT_CLOSED(table.department);

  const key = req.headers['idempotency-key'];
  const requestHash = stableStringify({ slug: table.slug, body: req.body || {} });

  if (key) {
    const held = await db.one('SELECT * FROM idempotency_keys WHERE key = $1', [String(key)]);
    if (held) {
      if (held.request_hash !== requestHash) {
        throw refusal(409, 'This idempotency key was used for another request.', 'idempotency_key');
      }
      res.status(held.response_status).type('application/json').send(held.response_body);
      return;
    }
  }

  const result = await db.tx(async (client) => {
    // Hold the table's row lock across the allowance check and the insert, so
    // concurrent creates can never carry a table past its allowance.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['keystone-rows:' + table.slug]);
    const live = await core.tableBySlug(table.slug, client);
    await core.checkWriteBoundary(client, {
      table: live,
      role,
      action: 'create',
      at: nowIso(),
    });
    const cols = await core.columnsFor(table.slug, client);
    const vals = core.coerceValues(cols, (req.body || {}).values || {});
    const recorded_at = nowIso();

    const posRes = await client.query(
      'SELECT COALESCE(MAX(inserted_position), 0)::bigint AS p FROM rows WHERE table_slug = $1',
      [table.slug]
    );
    const position = Number(posRes.rows[0].p) + 1;
    const created = await client.query(
      `INSERT INTO rows (table_slug, values, inserted_position, version, created_at)
       VALUES ($1,$2,$3,1,$4) RETURNING id, table_slug, values, version, inserted_position`,
      [table.slug, JSON.stringify(vals), position, recorded_at]
    );
    const row = created.rows[0];
    await core.appendEntries(client, table.slug, [
      {
        action: 'create',
        account: a.account.email,
        recorded_at,
        column: null,
        before: null,
        after: vals,
        row_id: row.id,
      },
    ]);
    return core.publicRow(row);
  });

  const bodyText = JSON.stringify(result);
  if (key) {
    try {
      await db.query(
        `INSERT INTO idempotency_keys (key, scope, request_hash, response_status, response_body, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [String(key), 'rows:' + table.slug, requestHash, 201, bodyText, nowIso()]
      );
    } catch {
      const held = await db.one('SELECT * FROM idempotency_keys WHERE key = $1', [String(key)]);
      if (held && held.request_hash === requestHash) {
        res.status(held.response_status).type('application/json').send(held.response_body);
        return;
      }
    }
  }
  res.status(201).type('application/json').send(bodyText);
}));

/* ---- amend ---- */

router.patch('/tables/:slug/rows/:id', wrap(async (req, res) => {
  const a = auth.requireSession(req);
  const table = await access.requireTable(req.params.slug);
  const role = access.roleFor(req.auth, table.department);
  if (!role) throw core.DEPARTMENT_CLOSED(table.department);

  const ifMatch = req.headers['if-match-version'];
  let wanted = null;
  if (ifMatch !== undefined && String(ifMatch).trim() !== '') {
    if (!/^\d+$/.test(String(ifMatch).trim())) {
      throw refusal(409, core.STALE_VERSION_REASON, 'version', { current_version: null });
    }
    wanted = Number(String(ifMatch).trim());
  }

  const out = await db.tx(async (client) => {
    const live = await core.tableBySlug(table.slug, client);
    await core.checkWriteBoundary(client, { table: live, role, action: 'update', at: nowIso() });

    const locked = await client.query(
      'SELECT id, table_slug, values, version, inserted_position FROM rows WHERE table_slug = $1 AND id::text = $2 FOR UPDATE',
      [table.slug, req.params.id]
    );
    const row = locked.rows[0];
    if (!row) throw refusal(404, 'That row is not part of this table.', 'row');

    if (wanted !== null && wanted !== row.version) {
      throw refusal(409, core.STALE_VERSION_REASON, 'version', { current_version: row.version });
    }

    const cols = await core.columnsFor(table.slug, client);
    const given = (req.body || {}).values || {};
    // One unit of work: every named value is checked before anything is written.
    const vals = core.coerceValues(cols, given);

    const recorded_at = nowIso();
    const before = row.values || {};
    const next = Object.assign({}, before);
    const entries = [];
    for (const caption of Object.keys(vals)) {
      const was = before[caption] === undefined ? null : before[caption];
      const now = vals[caption];
      next[caption] = now;
      entries.push({
        action: 'update',
        account: a.account.email,
        recorded_at,
        column: caption,
        before: was,
        after: now,
        row_id: row.id,
      });
    }

    const updated = await client.query(
      `UPDATE rows SET values = $1, version = version + 1 WHERE id = $2
       RETURNING id, table_slug, values, version, inserted_position`,
      [JSON.stringify(next), row.id]
    );
    if (entries.length) await core.appendEntries(client, table.slug, entries);
    return core.publicRow(updated.rows[0]);
  });

  res.status(200).json(out);
}));

router.delete('/tables/:slug/rows/:id', wrap(async (req, res) => {
  const a = auth.requireSession(req);
  const table = await access.requireTable(req.params.slug);
  const role = access.roleFor(req.auth, table.department);
  if (!role) throw core.DEPARTMENT_CLOSED(table.department);

  await db.tx(async (client) => {
    const live = await core.tableBySlug(table.slug, client);
    await core.checkWriteBoundary(client, { table: live, role, action: 'delete', at: nowIso() });
    const locked = await client.query(
      'SELECT id, values FROM rows WHERE table_slug = $1 AND id::text = $2 FOR UPDATE',
      [table.slug, req.params.id]
    );
    const row = locked.rows[0];
    if (!row) throw refusal(404, 'That row is not part of this table.', 'row');
    const recorded_at = nowIso();
    await client.query('DELETE FROM rows WHERE id = $1', [row.id]);
    await core.appendEntries(client, table.slug, [
      {
        action: 'delete',
        account: a.account.email,
        recorded_at,
        column: null,
        before: row.values || {},
        after: null,
        row_id: row.id,
      },
    ]);
  });
  res.status(204).end();
}));

/* -------------------------- columns ------------------------------- */

const COLUMN_TYPES = ['text', 'integer', 'decimal', 'date', 'choice', 'flag'];

router.post('/tables/:slug/columns', wrap(async (req, res) => {
  auth.requireSession(req);
  const table = await access.requireTable(req.params.slug);
  access.requireDepartment(req.auth, table.department, 'amend_row');
  const body = req.body || {};
  const caption = typeof body.caption === 'string' ? body.caption.trim() : '';
  if (!caption) throw refusal(422, 'A column carries a caption.', 'caption');
  if (!COLUMN_TYPES.includes(body.type)) throw refusal(422, 'A column carries one of the six types.', 'type');
  let options = null;
  if (body.type === 'choice') {
    if (!Array.isArray(body.options) || !body.options.length) {
      throw refusal(422, 'A choice column carries its own option list.', 'options');
    }
    options = body.options.map(String);
  }
  const out = await db.tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['keystone-cols:' + table.slug]);
    const held = await client.query('SELECT 1 FROM columns WHERE table_slug = $1 AND caption = $2', [
      table.slug,
      caption,
    ]);
    if (held.rows.length) throw refusal(409, 'That caption is already a column of this table.', 'caption');
    const posRes = await client.query(
      'SELECT COALESCE(MAX(position), 0)::int AS p FROM columns WHERE table_slug = $1',
      [table.slug]
    );
    const created = await client.query(
      'INSERT INTO columns (table_slug, caption, position, type, options) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [table.slug, caption, posRes.rows[0].p + 1, body.type, options ? JSON.stringify(options) : null]
    );
    return core.publicColumn(created.rows[0]);
  });
  res.status(201).json(out);
}));

router.delete('/tables/:slug/columns/:id', wrap(async (req, res) => {
  auth.requireSession(req);
  const table = await access.requireTable(req.params.slug);
  access.requireDepartment(req.auth, table.department, 'amend_row');
  await db.tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['keystone-cols:' + table.slug]);
    const found = await client.query(
      'SELECT id, caption, position FROM columns WHERE table_slug = $1 AND id::text = $2',
      [table.slug, req.params.id]
    );
    const col = found.rows[0];
    if (!col) throw refusal(404, 'That column is not part of this table.', 'column');
    await client.query('DELETE FROM columns WHERE id = $1', [col.id]);
    // Close the gap the removal left, so positions stay contiguous from one.
    await client.query(
      'UPDATE columns SET position = position - 1 WHERE table_slug = $1 AND position > $2',
      [table.slug, col.position]
    );
    await client.query(
      `UPDATE rows SET values = values - $2 WHERE table_slug = $1`,
      [table.slug, col.caption]
    );
  });
  res.status(204).end();
}));

/* -------------------------- change log ---------------------------- */

router.get('/tables/:slug/log', wrap(async (req, res) => {
  auth.requireSession(req);
  const table = await access.requireTable(req.params.slug);
  access.requireDepartment(req.auth, table.department, 'read');
  const page = parsePage(req.query.page);
  const params = [table.slug];
  const where = ['table_slug = $1'];
  if (req.query.action) {
    params.push(String(req.query.action));
    where.push(`action = $${params.length}`);
  }
  if (req.query.account) {
    params.push(String(req.query.account));
    where.push(`account = $${params.length}`);
  }
  const totalRes = await db.query(
    `SELECT count(*)::int AS n FROM log_entries WHERE ${where.join(' AND ')}`,
    params
  );
  params.push(LOG_PER_PAGE, (page - 1) * LOG_PER_PAGE);
  const rows = await db.all(
    `SELECT * FROM log_entries WHERE ${where.join(' AND ')}
     ORDER BY ordinal DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.set('X-Total-Count', String(totalRes.rows[0].n));
  res.status(200).json(rows.map(core.publicLogEntry));
}));

// No role amends the change log.
for (const verb of ['post', 'patch', 'put', 'delete']) {
  router[verb]('/tables/:slug/log', wrap(async (req, res) => {
    auth.requireSession(req);
    const table = await access.requireTable(req.params.slug);
    access.requireDepartment(req.auth, table.department, 'read');
    throw refusal(403, 'The change log is append-only and no role amends it.', 'log');
  }));
  router[verb]('/tables/:slug/log/:id', wrap(async (req, res) => {
    auth.requireSession(req);
    const table = await access.requireTable(req.params.slug);
    access.requireDepartment(req.auth, table.department, 'read');
    throw refusal(403, 'The change log is append-only and no role amends it.', 'log');
  }));
}

/* -------------------------- views --------------------------------- */

router.get('/tables/:slug/views', wrap(async (req, res) => {
  const a = auth.requireSession(req);
  const table = await access.requireTable(req.params.slug);
  access.requireDepartment(req.auth, table.department, 'read');
  const rows = await db.all(
    `SELECT id, table_slug, name, owner, visibility, filters, sorts FROM views
     WHERE table_slug = $1 AND (visibility = 'shared' OR owner = $2) ORDER BY name ASC`,
    [table.slug, a.account.email]
  );
  res.status(200).json(rows.map(views.publicView));
}));

router.post('/tables/:slug/views', wrap(async (req, res) => {
  const a = auth.requireSession(req);
  const table = await access.requireTable(req.params.slug);
  access.requireDepartment(req.auth, table.department, 'manage_view');
  const cols = await core.columnsFor(table.slug);
  const clean = views.validateViewBody(cols, req.body || {});

  const out = await db.tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['keystone-views:' + table.slug]);
    if (clean.visibility === 'shared') {
      const tier = await core.tierInForce(table.department, nowIso(), client);
      const countRes = await client.query(
        `SELECT count(*)::int AS n FROM views WHERE table_slug = $1 AND visibility = 'shared'`,
        [table.slug]
      );
      const count = countRes.rows[0].n;
      if (count >= tier.view_allowance) {
        throw refusal(
          422,
          `The ${tier.name} tier allows ${tier.view_allowance} shared views a table and this table holds ${count}.`,
          'view_allowance',
          { tier: tier.name, allowance: tier.view_allowance, view_allowance: tier.view_allowance, count }
        );
      }
    }
    const created = await client.query(
      `INSERT INTO views (table_slug, name, owner, visibility, filters, sorts, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, table_slug, name, owner, visibility, filters, sorts`,
      [
        table.slug,
        clean.name,
        a.account.email,
        clean.visibility,
        JSON.stringify(clean.filters),
        JSON.stringify(clean.sorts),
        nowIso(),
      ]
    );
    return views.publicView(created.rows[0]);
  });
  res.status(201).json(out);
}));

router.patch('/tables/:slug/views/:id', wrap(async (req, res) => {
  const a = auth.requireSession(req);
  const table = await access.requireTable(req.params.slug);
  access.requireDepartment(req.auth, table.department, 'manage_view');
  const cols = await core.columnsFor(table.slug);
  const clean = views.validateViewBody(cols, req.body || {});
  const found = await db.one('SELECT id FROM views WHERE table_slug = $1 AND id::text = $2', [
    table.slug,
    req.params.id,
  ]);
  if (!found) throw refusal(404, 'That view is not part of this table.', 'view');
  const updated = await db.one(
    `UPDATE views SET name = $1, visibility = $2, filters = $3, sorts = $4 WHERE id = $5
     RETURNING id, table_slug, name, owner, visibility, filters, sorts`,
    [clean.name, clean.visibility, JSON.stringify(clean.filters), JSON.stringify(clean.sorts), found.id]
  );
  res.status(200).json(views.publicView(updated));
}));

router.delete('/tables/:slug/views/:id', wrap(async (req, res) => {
  auth.requireSession(req);
  const table = await access.requireTable(req.params.slug);
  access.requireDepartment(req.auth, table.department, 'manage_view');
  const found = await db.one('SELECT id FROM views WHERE table_slug = $1 AND id::text = $2', [
    table.slug,
    req.params.id,
  ]);
  if (!found) throw refusal(404, 'That view is not part of this table.', 'view');
  await db.query('DELETE FROM views WHERE id = $1', [found.id]);
  res.status(204).end();
}));

/* -------------------------- lock ---------------------------------- */

router.post('/tables/:slug/lock', wrap(async (req, res) => {
  auth.requireSession(req);
  const table = await access.requireTable(req.params.slug);
  access.requireDepartment(req.auth, table.department, 'decide');
  const period = typeof (req.body || {}).period === 'string' ? req.body.period.trim() : '';
  if (!period) throw refusal(422, 'A lock names its reporting period.', 'period');
  await db.query('UPDATE tables SET locked_period = $1 WHERE slug = $2', [period, table.slug]);
  res.status(200).json(await core.tableAnswer(table.slug));
}));

router.delete('/tables/:slug/lock', wrap(async (req, res) => {
  auth.requireSession(req);
  const table = await access.requireTable(req.params.slug);
  access.requireDepartment(req.auth, table.department, 'decide');
  // Unlocking amends no row, so it writes no change log entry.
  await db.query('UPDATE tables SET locked_period = NULL WHERE slug = $1', [table.slug]);
  res.status(200).json(await core.tableAnswer(table.slug));
}));

/* -------------------------- snapshots ----------------------------- */

function snapshotAnswer(row, rank, retention, withRows) {
  const count = core.retentionCount(retention);
  const out = {
    id: String(row.id),
    table: row.table_slug,
    department: row.department,
    period: row.period,
    account: row.account,
    published_at: row.published_at,
    business_day: row.business_day,
    sequence: row.sequence,
    tier: row.tier,
    row_allowance: row.row_allowance,
    content_allowance_kilobytes: row.content_allowance_kilobytes,
    retention: row.retention,
    row_count: row.row_count,
    content_bytes: row.content_bytes,
    retained: rank <= count,
  };
  if (withRows) out.rows = row.rows || [];
  return out;
}

/** Rank a table's snapshots by published_at, newest first, at the read. */
async function snapshotRanks(tableSlug) {
  const rows = await db.all(
    'SELECT id, published_at FROM snapshots WHERE table_slug = $1 ORDER BY published_at DESC, id DESC',
    [tableSlug]
  );
  const ranks = new Map();
  rows.forEach((r, i) => ranks.set(String(r.id), i + 1));
  return ranks;
}

router.get('/snapshots', wrap(async (req, res) => {
  auth.requireSession(req);
  const departments = access.departmentsFor(req.auth);
  if (!departments.length) return res.status(200).json([]);
  let tableFilter = null;
  if (req.query.table) {
    const table = await access.requireTable(String(req.query.table));
    access.requireDepartment(req.auth, table.department, 'read');
    tableFilter = table.slug;
  }
  const params = [departments];
  let where = 'department = ANY($1::text[])';
  if (tableFilter) {
    params.push(tableFilter);
    where += ` AND table_slug = $${params.length}`;
  }
  const rows = await db.all(
    `SELECT * FROM snapshots WHERE ${where} ORDER BY published_at DESC, id DESC`,
    params
  );
  const rankCache = new Map();
  const out = [];
  for (const r of rows) {
    if (!rankCache.has(r.table_slug)) rankCache.set(r.table_slug, await snapshotRanks(r.table_slug));
    const rank = rankCache.get(r.table_slug).get(String(r.id));
    const answer = snapshotAnswer(r, rank, r.retention, false);
    if (answer.retained) out.push(answer);
  }
  res.status(200).json(out);
}));

router.get('/snapshots/:id', wrap(async (req, res) => {
  auth.requireSession(req);
  const row = await db.one('SELECT * FROM snapshots WHERE id::text = $1', [req.params.id]);
  if (!row) throw refusal(404, 'That snapshot is not part of Keystone Tables.', 'snapshot');
  access.requireDepartment(req.auth, row.department, 'read');
  const ranks = await snapshotRanks(row.table_slug);
  const rank = ranks.get(String(row.id));
  const answer = snapshotAnswer(row, rank, row.retention, true);
  if (!answer.retained) {
    throw refusal(410, `This snapshot has fallen outside the ${row.retention} retention.`, 'retention');
  }
  res.status(200).json(answer);
}));

// A snapshot is read-only at its own address.
for (const verb of ['post', 'patch', 'put', 'delete']) {
  router[verb]('/snapshots/:id', wrap(async (req, res) => {
    auth.requireSession(req);
    const row = await db.one('SELECT department FROM snapshots WHERE id::text = $1', [req.params.id]);
    if (!row) throw refusal(404, 'That snapshot is not part of Keystone Tables.', 'snapshot');
    access.requireDepartment(req.auth, row.department, 'read');
    throw refusal(403, 'A snapshot is frozen and no role amends it.', 'snapshot');
  }));
}

router.post('/snapshots', wrap(async (req, res) => {
  const a = auth.requireSession(req);
  const body = req.body || {};
  const slug = typeof body.table === 'string' ? body.table.trim() : '';
  const period = typeof body.period === 'string' ? body.period.trim() : '';
  if (!slug) throw refusal(422, 'A snapshot names its table.', 'table');
  if (!period) throw refusal(422, 'A snapshot names its reporting period.', 'period');
  const table = await access.requireTable(slug);
  access.requireDepartment(req.auth, table.department, 'decide');

  const out = await db.tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'keystone-snapshots:' + table.department,
    ]);
    const held = await client.query('SELECT 1 FROM snapshots WHERE table_slug = $1 AND period = $2', [
      table.slug,
      period,
    ]);
    if (held.rows.length) {
      throw refusal(409, `A snapshot of this table for ${period} is already published.`, 'period');
    }
    const published_at = nowIso();
    const tier = await core.tierInForce(table.department, published_at, client);
    const cols = await core.columnsFor(table.slug, client);
    const rowsRes = await client.query(
      'SELECT id, values, version FROM rows WHERE table_slug = $1 ORDER BY inserted_position ASC',
      [table.slug]
    );
    const frozen = rowsRes.rows.map((r) => ({
      id: String(r.id),
      version: r.version,
      values: r.values || {},
    }));
    let contentBytes = 0;
    for (const r of frozen) contentBytes += core.rowContentBytes(cols, r.values);
    const seqRes = await client.query(
      'SELECT COALESCE(MAX(sequence), 0)::int AS s FROM snapshots WHERE department = $1',
      [table.department]
    );
    const sequence = seqRes.rows[0].s + 1;
    const created = await client.query(
      `INSERT INTO snapshots (table_slug, department, period, account, published_at, business_day,
         sequence, tier, row_allowance, content_allowance_kilobytes, retention, row_count,
         content_bytes, rows)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        table.slug,
        table.department,
        period,
        a.account.email,
        published_at,
        businessDay(published_at),
        sequence,
        tier.name,
        tier.row_allowance,
        tier.content_allowance_kilobytes,
        tier.retention,
        frozen.length,
        contentBytes,
        JSON.stringify(frozen),
      ]
    );
    return created.rows[0];
  });

  const ranks = await snapshotRanks(table.slug);
  res.status(201).json(snapshotAnswer(out, ranks.get(String(out.id)), out.retention, true));
}));

/* -------------------------- requests ------------------------------ */

function publicRequest(r) {
  return {
    id: String(r.id),
    account: r.account,
    department: r.department,
    role: r.role,
    state: r.state,
    reason: r.reason === undefined ? null : r.reason,
    raised_at: r.raised_at,
    decided_at: r.decided_at === undefined ? null : r.decided_at,
    decided_by: r.decided_by === undefined ? null : r.decided_by,
  };
}

router.get('/requests', wrap(async (req, res) => {
  const a = auth.requireSession(req);
  const stewardOf = await access.stewardDepartments(req.auth);
  const params = [a.account.email, stewardOf];
  const where = ['(account = $1 OR department = ANY($2::text[]))'];
  if (req.query.state) {
    params.push(String(req.query.state));
    where.push(`state = $${params.length}`);
  }
  const rows = await db.all(
    `SELECT * FROM requests WHERE ${where.join(' AND ')}
     ORDER BY (state = 'open') DESC, raised_at ASC, id ASC`,
    params
  );
  res.status(200).json(rows.map(publicRequest));
}));

router.post('/requests', wrap(async (req, res) => {
  const a = auth.requireSession(req);
  const body = req.body || {};
  const department = typeof body.department === 'string' ? body.department.trim().toLowerCase() : '';
  const role = typeof body.role === 'string' ? body.role.trim() : '';
  const dep = await db.one('SELECT slug FROM departments WHERE slug = $1', [department]);
  if (!dep) throw refusal(422, 'A request names one of the three departments.', 'department');
  if (!core.ROLE_NAMES.includes(role)) throw refusal(422, 'A request names one of the four roles.', 'role');
  const held = await core.roleOn(a.account.email, department);
  if (held) {
    throw refusal(409, `You already hold the ${held} role on ${department}.`, 'department');
  }
  try {
    const created = await db.one(
      `INSERT INTO requests (account, department, role, state, reason, raised_at)
       VALUES ($1,$2,$3,'open',NULL,$4) RETURNING *`,
      [a.account.email, department, role, nowIso()]
    );
    res.status(201).json(publicRequest(created));
  } catch (err) {
    // One open request per account per department.
    if (err && (err.code === '23505' || err.code === '23P01')) {
      throw refusal(409, `You already hold an open request for ${department}.`, 'department');
    }
    throw err;
  }
}));

router.post('/requests/:id/decision', wrap(async (req, res) => {
  const a = auth.requireSession(req);
  const body = req.body || {};
  const decision = typeof body.decision === 'string' ? body.decision.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (decision !== 'approved' && decision !== 'declined') {
    throw refusal(422, 'A decision is approved or declined.', 'decision');
  }
  if (!reason) throw refusal(422, 'A decision carries its reason.', 'reason');

  const existing = await db.one('SELECT * FROM requests WHERE id::text = $1', [req.params.id]);
  if (!existing) throw refusal(404, 'That request is not part of Keystone Tables.', 'request');

  const role = access.roleFor(req.auth, existing.department);
  if (role !== 'steward') {
    if (!role) {
      throw refusal(403, 'This department is not yours to govern.', 'department');
    }
    throw core.STEWARDS_ONLY();
  }
  // Nobody decides their own request, steward or not.
  if (existing.account === a.account.email) {
    throw refusal(403, 'Nobody decides their own access request.', 'account');
  }

  const out = await db.tx(async (client) => {
    const locked = await client.query('SELECT * FROM requests WHERE id = $1 FOR UPDATE', [existing.id]);
    const request = locked.rows[0];
    if (request.state !== 'open') {
      throw refusal(409, 'This request has already been decided.', 'state');
    }
    const decided_at = nowIso();
    const updated = await client.query(
      `UPDATE requests SET state = $1, reason = $2, decided_at = $3, decided_by = $4
       WHERE id = $5 RETURNING *`,
      [decision, reason, decided_at, a.account.email, request.id]
    );
    if (decision === 'approved') {
      await client.query(
        `INSERT INTO role_grants (account, department, role, authorises_from, created_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (account, department) DO UPDATE SET role = EXCLUDED.role,
           authorises_from = EXCLUDED.authorises_from`,
        [request.account, request.department, request.role, decided_at, decided_at]
      );
    }
    await core.appendEntries(client, 'admin-' + request.department, [
      {
        action: 'request_decided',
        account: a.account.email,
        recorded_at: decided_at,
        column: null,
        before: null,
        after: null,
        subject: request.account,
      },
    ]);
    return updated.rows[0];
  });
  res.status(200).json(publicRequest(out));
}));

/* -------------------------- enquiries, subscribers ---------------- */

const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data'];

function isFormEncoded(req) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  return FORM_TYPES.some((t) => ct.includes(t));
}

async function requireFormToken(req) {
  if (!isFormEncoded(req)) return;
  const token = (req.body || {}).form_token;
  if (!token || typeof token !== 'string') {
    throw refusal(403, 'This form post carries no form_token.', 'form_token');
  }
  const held = await db.one('SELECT 1 FROM form_tokens WHERE value = $1', [token]);
  if (!held) throw refusal(403, 'This form post carries no form_token.', 'form_token');
}

router.post('/enquiries', wrap(async (req, res) => {
  await requireFormToken(req);
  const body = req.body || {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const full_name = str(body.full_name);
  const work_email = str(body.work_email);
  const company = str(body.company);
  const message = typeof body.message === 'string' ? body.message : '';
  const phone = str(body.phone) || null;
  const role = str(body.role) || null;

  if (!full_name) throw refusal(422, 'A sales enquiry carries a full name.', 'full_name');
  if (!work_email) throw refusal(422, 'A sales enquiry carries a work email.', 'work_email');
  if (!auth.EMAIL_SHAPE.test(work_email) || work_email.length > 254) {
    throw refusal(422, 'That work email is not a work email address.', 'work_email');
  }
  if (!company) throw refusal(422, 'A sales enquiry carries a company name.', 'company');
  if (!message.trim()) throw refusal(422, 'A sales enquiry carries a message.', 'message');
  if (message.length > 1000) {
    throw refusal(422, 'A message is at most 1000 characters.', 'message');
  }

  const created = await db.one(
    `INSERT INTO enquiries (full_name, work_email, phone, company, role, message, recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, work_email`,
    [full_name, work_email, phone, company, role, message, nowIso()]
  );
  res.status(201).json({
    id: String(created.id),
    work_email: created.work_email,
    recorded: true,
    confirmation: `Enquiry recorded against ${created.work_email}.`,
  });
}));

router.post('/subscribers', wrap(async (req, res) => {
  await requireFormToken(req);
  const body = req.body || {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !auth.EMAIL_SHAPE.test(email) || email.length > 254) {
    throw refusal(422, 'That email is not an email address.', 'email');
  }
  // Idempotent by the address alone, so a repeat records no second row.
  await db.query(
    'INSERT INTO subscribers (email, created_at) VALUES ($1,$2) ON CONFLICT (email) DO NOTHING',
    [email, nowIso()]
  );
  res.status(200).json({
    email,
    subscribed: true,
    confirmation: `Thank you. ${email} is subscribed.`,
  });
}));

module.exports = { router, wrap, publicRequest, snapshotAnswer, snapshotRanks, parsePage, QUEUE_PER_PAGE };
