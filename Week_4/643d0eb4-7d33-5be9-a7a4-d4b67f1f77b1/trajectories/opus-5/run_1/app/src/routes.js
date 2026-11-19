'use strict';
const express = require('express');
const db = require('./db');
const core = require('./core');
const views = require('./views');
const access = require('./access');
const pub = require('./pages_public');
const con = require('./pages_console');
const { randomToken, nowIso } = require('./util');

const router = express.Router();

function wrap(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

async function baseContext(req) {
  const isSteward = await access.isSteward(req.auth);
  return {
    auth: req.auth,
    path: req.path,
    isSteward,
    grants: req.auth ? req.auth.grants : [],
  };
}

async function issueFormToken() {
  const value = randomToken(18);
  await db.query('INSERT INTO form_tokens (value, created_at) VALUES ($1,$2)', [value, nowIso()]);
  return value;
}

function sendPage(res, status, html) {
  res.status(status).type('text/html; charset=utf-8').send(html);
}

/* ------------------------------ public ---------------------------- */

router.get('/', wrap(async (req, res) => {
  const ctx = await baseContext(req);
  ctx.signedOut = req.query.signed_out !== undefined;
  sendPage(res, 200, pub.landing(ctx));
}));

router.get('/plans', wrap(async (req, res) => {
  const ctx = await baseContext(req);
  ctx.tiers = await core.listTiers();
  sendPage(res, 200, pub.plans(ctx));
}));

router.get('/enquiry', wrap(async (req, res) => {
  const ctx = await baseContext(req);
  ctx.formToken = await issueFormToken();
  sendPage(res, 200, pub.enquiry(ctx));
}));

router.get('/community', wrap(async (req, res) => {
  const ctx = await baseContext(req);
  ctx.formToken = await issueFormToken();
  sendPage(res, 200, pub.community(ctx));
}));

router.get('/developers', wrap(async (req, res) => {
  const ctx = await baseContext(req);
  sendPage(res, 200, pub.developers(ctx));
}));

router.get('/login', wrap(async (req, res) => {
  const ctx = await baseContext(req);
  ctx.tier = ['starter', 'team', 'scale', 'regulated'].includes(String(req.query.tier))
    ? String(req.query.tier)
    : 'starter';
  sendPage(res, 200, pub.login(ctx));
}));

/* ------------------------------ console --------------------------- */

/** A console page with no session is a refusal page, never a redirect. */
async function consoleContext(req, res) {
  const ctx = await baseContext(req);
  if (!req.auth) {
    sendPage(res, 401, pub.sessionRefusal(ctx));
    return null;
  }
  return ctx;
}

router.get('/console', wrap(async (req, res) => {
  const ctx = await consoleContext(req, res);
  if (!ctx) return;
  sendPage(res, 200, con.consoleHome(ctx));
}));

router.get('/console/tables', wrap(async (req, res) => {
  const ctx = await consoleContext(req, res);
  if (!ctx) return;
  const departments = access.departmentsFor(req.auth);
  const slugs = departments.length
    ? await db.all('SELECT slug FROM tables WHERE department = ANY($1::text[]) ORDER BY name ASC', [departments])
    : [];
  ctx.tables = [];
  for (const s of slugs) ctx.tables.push(await core.tableAnswer(s.slug));
  sendPage(res, 200, con.tableList(ctx));
}));

async function loadTableContext(req, res, slug) {
  const ctx = await consoleContext(req, res);
  if (!ctx) return null;
  const table = await core.tableBySlug(slug);
  if (!table) {
    sendPage(res, 404, pub.notFound(ctx));
    return null;
  }
  const role = access.roleFor(req.auth, table.department);
  if (!role) {
    ctx.department = table.department;
    sendPage(res, 403, pub.departmentRefusal(ctx));
    return null;
  }
  ctx.table = await core.tableAnswer(slug);
  ctx.cols = await core.columnsFor(slug);
  ctx.role = role;
  return ctx;
}

async function renderTablePage(req, res, slug, viewName) {
  const ctx = await loadTableContext(req, res, slug);
  if (!ctx) return;
  const cols = ctx.cols;
  const viewsList = (
    await db.all(
      `SELECT id, table_slug, name, owner, visibility, filters, sorts FROM views
       WHERE table_slug = $1 AND (visibility = 'shared' OR owner = $2) ORDER BY name ASC`,
      [slug, req.auth.account.email]
    )
  ).map(views.publicView);

  const wantedView = viewName || (req.query.view ? String(req.query.view) : null);
  const appliedView = wantedView ? viewsList.find((v) => v.name === wantedView) || null : null;
  const sortColumn =
    req.query.sort && cols.some((c) => c.caption === String(req.query.sort)) ? String(req.query.sort) : null;

  const perPage = 100;
  const pageNumber = Math.max(1, Number(req.query.page) || 1);
  const filters = appliedView ? appliedView.filters : [];
  const sorts = sortColumn ? [{ column: sortColumn, direction: 'asc' }] : appliedView ? appliedView.sorts : [];

  const params = [slug];
  const built = views.buildRowQuery(cols, filters, sorts, params);
  const whereSql = ['table_slug = $1'].concat(built.where).join(' AND ');
  const totalRes = await db.query(
    `SELECT count(*)::int AS n FROM rows WHERE ${whereSql}`,
    params.slice(0, built.filterCount)
  );
  const p = params.slice();
  p.push(perPage, (pageNumber - 1) * perPage);
  const rows = await db.all(
    `SELECT id, table_slug, values, version, inserted_position FROM rows WHERE ${whereSql}
     ORDER BY ${built.order.join(', ')} LIMIT $${p.length - 1} OFFSET $${p.length}`,
    p
  );

  ctx.viewsList = viewsList;
  ctx.appliedView = appliedView;
  ctx.sortColumn = sortColumn;
  ctx.rows = rows.map(core.publicRow);
  ctx.total = totalRes.rows[0].n;
  ctx.pageNumber = pageNumber;
  ctx.perPage = perPage;
  sendPage(res, 200, con.tablePage(ctx));
}

router.get('/console/tables/:slug', wrap(async (req, res) => {
  await renderTablePage(req, res, req.params.slug, null);
}));

router.get('/console/tables/:slug/views/:view', wrap(async (req, res) => {
  await renderTablePage(req, res, req.params.slug, req.params.view);
}));

router.get('/console/tables/:slug/log', wrap(async (req, res) => {
  const ctx = await loadTableContext(req, res, req.params.slug);
  if (!ctx) return;
  const pageNumber = Math.max(1, Number(req.query.page) || 1);
  const totalRes = await db.query('SELECT count(*)::int AS n FROM log_entries WHERE table_slug = $1', [
    req.params.slug,
  ]);
  const entries = await db.all(
    'SELECT * FROM log_entries WHERE table_slug = $1 ORDER BY ordinal DESC LIMIT 20 OFFSET $2',
    [req.params.slug, (pageNumber - 1) * 20]
  );
  ctx.entries = entries.map(core.publicLogEntry);
  ctx.pageNumber = pageNumber;
  ctx.total = totalRes.rows[0].n;
  sendPage(res, 200, con.logPage(ctx));
}));

router.get('/console/snapshots', wrap(async (req, res) => {
  const ctx = await consoleContext(req, res);
  if (!ctx) return;
  const departments = access.departmentsFor(req.auth);
  const stored = departments.length
    ? await db.all(
        'SELECT * FROM snapshots WHERE department = ANY($1::text[]) ORDER BY published_at DESC, id DESC',
        [departments]
      )
    : [];
  const byTable = new Map();
  for (const s of stored) {
    if (!byTable.has(s.table_slug)) byTable.set(s.table_slug, []);
    byTable.get(s.table_slug).push(s);
  }
  const retained = new Map();
  for (const [slug, list] of byTable) {
    const sorted = list.slice().sort((a, b) => (a.published_at < b.published_at ? 1 : -1));
    sorted.forEach((s, i) => {
      retained.set(String(s.id), i + 1 <= core.retentionCount(s.retention));
    });
  }
  ctx.snapshots = stored.map((s) => ({
    id: String(s.id),
    table: s.table_slug,
    department: s.department,
    period: s.period,
    published_at: s.published_at,
    business_day: s.business_day,
    sequence: s.sequence,
    tier: s.tier,
    retention: s.retention,
    row_count: s.row_count,
    content_bytes: s.content_bytes,
    retained: !!retained.get(String(s.id)),
  }));

  const retentionRows = [];
  for (const d of departments) {
    const tier = await core.tierInForce(d);
    const held = ctx.snapshots.filter((s) => s.department === d);
    retentionRows.push({
      department: d,
      tier: tier.name,
      retention: tier.retention,
      held: held.length,
      retained: held.filter((s) => s.retained).length,
    });
  }
  ctx.retentionRows = retentionRows;
  const stewardOf = await access.stewardDepartments(req.auth);
  ctx.publishable = stewardOf.length
    ? await db.all('SELECT slug, name FROM tables WHERE department = ANY($1::text[]) ORDER BY name ASC', [stewardOf])
    : [];
  ctx.isSteward = stewardOf.length > 0;
  sendPage(res, 200, con.snapshotsPage(ctx));
}));

router.get('/console/requests', wrap(async (req, res) => {
  const ctx = await consoleContext(req, res);
  if (!ctx) return;
  const stewardOf = await access.stewardDepartments(req.auth);
  const rows = await db.all(
    `SELECT * FROM requests WHERE account = $1 OR department = ANY($2::text[])
     ORDER BY (state = 'open') DESC, raised_at ASC, id ASC`,
    [req.auth.account.email, stewardOf]
  );
  ctx.requests = rows.map((r) => ({
    id: String(r.id),
    account: r.account,
    department: r.department,
    role: r.role,
    state: r.state,
    reason: r.reason,
    raised_at: r.raised_at,
  }));
  ctx.stewardOf = stewardOf;
  ctx.isSteward = stewardOf.length > 0;
  ctx.account = req.auth.account;
  ctx.departments = (await db.all('SELECT slug FROM departments ORDER BY slug ASC')).map((d) => d.slug);
  sendPage(res, 200, con.requestsPage(ctx));
}));

router.get('/console/account', wrap(async (req, res) => {
  const ctx = await consoleContext(req, res);
  if (!ctx) return;
  ctx.account = req.auth.account;
  ctx.grants = await core.allGrantsFor(req.auth.account.email);
  sendPage(res, 200, con.accountPage(ctx));
}));

router.get('/console/administration', wrap(async (req, res) => {
  const ctx = await baseContext(req);
  if (!req.auth) {
    sendPage(res, 401, pub.stewardRefusal(ctx));
    return;
  }
  const stewardGrant = (req.auth.grants || []).find((g) => g.role === 'steward');
  if (!stewardGrant) {
    sendPage(res, 403, pub.stewardRefusal(ctx));
    return;
  }
  const department = stewardGrant.department;
  const at = nowIso();
  const grants = (
    await db.all(
      'SELECT id, account, department, role, authorises_from FROM role_grants WHERE department = $1 ORDER BY account ASC',
      [department]
    )
  ).map((g) => ({
    id: String(g.id),
    account: g.account,
    role: g.role,
    authorises_from: g.authorises_from,
    authorising: new Date(g.authorises_from).getTime() <= new Date(at).getTime(),
  }));
  const queue = (
    await db.all(
      `SELECT * FROM requests WHERE department = $1 ORDER BY (state = 'open') DESC, raised_at ASC, id ASC LIMIT 20`,
      [department]
    )
  ).map((r) => ({
    id: String(r.id),
    account: r.account,
    role: r.role,
    state: r.state,
    raised_at: r.raised_at,
  }));
  const attempts = (
    await db.all('SELECT email, attempted_at, outcome FROM login_attempts ORDER BY attempted_at DESC, id DESC LIMIT 20')
  ).map((a) => ({ email: a.email, attempted_at: a.attempted_at, outcome: a.outcome }));
  ctx.department = department;
  ctx.grants = grants;
  ctx.queue = queue;
  ctx.attempts = attempts;
  ctx.counts = {
    grants: grants.length,
    open_requests: queue.filter((r) => r.state === 'open').length,
  };
  sendPage(res, 200, con.administrationPage(ctx));
}));

module.exports = { router, sendPage, baseContext, wrap };
