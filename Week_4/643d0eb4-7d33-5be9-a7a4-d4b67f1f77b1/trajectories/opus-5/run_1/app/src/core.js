'use strict';
const db = require('./db');
const { ZERO_HASH, entryHash, businessDay, nowIso } = require('./util');

/* ------------------------------------------------------------------ *
 * One refusal shape. Every refusal in the build is built right here.
 * ------------------------------------------------------------------ */

class Refusal extends Error {
  constructor(status, reason, field, extra) {
    super(reason);
    this.status = status;
    this.reason = reason;
    this.field = field;
    this.extra = extra || null;
  }
  get body() {
    return Object.assign({ reason: this.reason, field: this.field }, this.extra || {});
  }
}

function refusal(status, reason, field, extra) {
  return new Refusal(status, reason, field, extra);
}

function sendRefusal(res, status, reason, field, extra) {
  const r = refusal(status, reason, field, extra);
  res.status(r.status).json(r.body);
  return r;
}

const DEPARTMENT_CLOSED = (slug) =>
  refusal(403, `This department is closed to you: ${slug}.`, 'department');

const STEWARDS_ONLY = () => refusal(403, 'This console is for stewards only.', 'role');

/* ------------------------------------------------------------------ *
 * Roles
 * ------------------------------------------------------------------ */

const ROLE_POWERS = {
  viewer: { read: true, amend_row: false, manage_view: false, decide: false },
  analyst: { read: true, amend_row: false, manage_view: true, decide: false },
  editor: { read: true, amend_row: true, manage_view: true, decide: false },
  steward: { read: true, amend_row: true, manage_view: true, decide: true },
};

const ROLE_NAMES = ['viewer', 'analyst', 'editor', 'steward'];

function roleAllows(role, action) {
  const powers = ROLE_POWERS[role];
  return !!(powers && powers[action]);
}

/**
 * Role grants standing in the store right now. Read on every request, never
 * cached in a session, and never counted before a grant's own moment.
 */
async function grantsFor(email, at) {
  const moment = at || nowIso();
  return db.all(
    `SELECT id, account, department, role, authorises_from FROM role_grants
     WHERE account = $1 AND authorises_from <= $2
     ORDER BY department`,
    [email, moment]
  );
}

async function allGrantsFor(email) {
  return db.all(
    `SELECT id, account, department, role, authorises_from FROM role_grants
     WHERE account = $1 ORDER BY department`,
    [email]
  );
}

async function roleOn(email, department, at) {
  const moment = at || nowIso();
  const row = await db.one(
    `SELECT role FROM role_grants
     WHERE account = $1 AND department = $2 AND authorises_from <= $3`,
    [email, department, moment]
  );
  return row ? row.role : null;
}

/* ------------------------------------------------------------------ *
 * Tiers and effective-dated tier grants
 * ------------------------------------------------------------------ */

const RETENTION_COUNTS = {
  'one period': 1,
  'four periods': 4,
  'twelve periods': 12,
  'every period': Infinity,
};

function retentionCount(words) {
  const n = RETENTION_COUNTS[words];
  return n === undefined ? 1 : n;
}

async function listTiers() {
  return db.all(
    `SELECT name, grant_order, audience, row_allowance, stored_megabytes,
            content_allowance_kilobytes, view_allowance, retention, most_chosen
     FROM tiers ORDER BY grant_order`
  );
}

async function tierByName(name) {
  return db.one(
    `SELECT name, grant_order, audience, row_allowance, stored_megabytes,
            content_allowance_kilobytes, view_allowance, retention, most_chosen
     FROM tiers WHERE name = $1`,
    [name]
  );
}

/** The tier grant in force at a moment: the greatest effective_at at or before it. */
async function grantInForce(department, at, client) {
  const runner = client || db;
  const r = await runner.query(
    `SELECT department, tier, effective_at FROM department_grants
     WHERE department = $1 AND effective_at <= $2
     ORDER BY effective_at DESC LIMIT 1`,
    [department, at || nowIso()]
  );
  return r.rows[0] || null;
}

/** The tier whose grant is in force for a department at a moment. */
async function tierInForce(department, at, client) {
  const grant = await grantInForce(department, at, client);
  if (!grant) {
    const dep = await db.one('SELECT tier FROM departments WHERE slug = $1', [department]);
    return dep ? tierByName(dep.tier) : null;
  }
  const runner = client || db;
  const r = await runner.query(
    `SELECT name, grant_order, audience, row_allowance, stored_megabytes,
            content_allowance_kilobytes, view_allowance, retention, most_chosen
     FROM tiers WHERE name = $1`,
    [grant.tier]
  );
  return r.rows[0] || null;
}

async function listDepartmentGrants(department, at) {
  const rows = await db.all(
    `SELECT department, tier, effective_at FROM department_grants
     WHERE department = $1 ORDER BY effective_at ASC`,
    [department]
  );
  const force = await grantInForce(department, at);
  return rows.map((g) => ({
    department: g.department,
    tier: g.tier,
    effective_at: g.effective_at,
    in_force: !!force && force.effective_at === g.effective_at && force.tier === g.tier,
  }));
}

/* ------------------------------------------------------------------ *
 * Tables, columns and derived figures
 * ------------------------------------------------------------------ */

async function tableBySlug(slug, client) {
  const runner = client || db;
  const r = await runner.query(
    'SELECT id, slug, name, department, tier, locked_period FROM tables WHERE slug = $1',
    [slug]
  );
  return r.rows[0] || null;
}

async function columnsFor(slug, client) {
  const runner = client || db;
  const r = await runner.query(
    'SELECT id, table_slug, caption, position, type, options FROM columns WHERE table_slug = $1 ORDER BY position ASC',
    [slug]
  );
  return r.rows;
}

/** Content bytes by the published per-column recipe, summed in the store at the read. */
async function contentBytesFor(slug, cols, client) {
  const runner = client || db;
  if (!cols.length) return 0;
  const parts = [];
  const params = [slug];
  for (const col of cols) {
    params.push(col.caption);
    const p = `$${params.length}`;
    const weight =
      col.type === 'integer'
        ? '4'
        : col.type === 'decimal'
        ? '8'
        : col.type === 'flag'
        ? '1'
        : `length(values->>${p})`;
    parts.push(
      `CASE WHEN jsonb_typeof(values->${p}) IS NULL OR jsonb_typeof(values->${p}) = 'null' THEN 0 ELSE ${weight} END`
    );
  }
  const r = await runner.query(
    `SELECT COALESCE(SUM(${parts.join(' + ')}), 0)::bigint AS total FROM rows WHERE table_slug = $1`,
    params
  );
  return Number(r.rows[0].total);
}

function rowContentBytes(cols, values) {
  let total = 0;
  for (const col of cols) {
    const v = values ? values[col.caption] : undefined;
    if (v === null || v === undefined) continue;
    if (col.type === 'integer') total += 4;
    else if (col.type === 'decimal') total += 8;
    else if (col.type === 'flag') total += 1;
    else total += String(v).length;
  }
  return total;
}

async function rowCountFor(slug, client) {
  const runner = client || db;
  const r = await runner.query('SELECT count(*)::int AS n FROM rows WHERE table_slug = $1', [slug]);
  return r.rows[0].n;
}

async function logHighOrdinal(slug, client) {
  const runner = client || db;
  const r = await runner.query(
    'SELECT COALESCE(MAX(ordinal), 0)::int AS n FROM log_entries WHERE table_slug = $1',
    [slug]
  );
  return r.rows[0].n;
}

/** Everything a table answer carries, every figure computed at this read. */
async function tableAnswer(slug, client) {
  const table = await tableBySlug(slug, client);
  if (!table) return null;
  const cols = await columnsFor(slug, client);
  const read_at = nowIso();
  const tier = await tierInForce(table.department, read_at, client);
  const count = await rowCountFor(slug, client);
  const content_bytes = await contentBytesFor(slug, cols, client);
  const high = await logHighOrdinal(slug, client);
  return {
    id: String(table.id),
    slug: table.slug,
    name: table.name,
    department: table.department,
    tier: tier ? tier.name : table.tier,
    locked_period: table.locked_period,
    row_allowance: tier ? tier.row_allowance : null,
    allowance: tier ? tier.row_allowance : null,
    view_allowance: tier ? tier.view_allowance : null,
    content_allowance_kilobytes: tier ? tier.content_allowance_kilobytes : null,
    retention: tier ? tier.retention : null,
    count,
    stored_kilobytes: count * 2,
    content_bytes,
    content_kilobytes: Math.floor(content_bytes / 1024),
    log_high_ordinal: high,
    columns: cols.map(publicColumn),
    read_at,
  };
}

function publicColumn(col) {
  return {
    id: String(col.id),
    caption: col.caption,
    position: col.position,
    type: col.type,
    options: col.options || null,
  };
}

function publicRow(row) {
  return {
    id: String(row.id),
    table: row.table_slug,
    values: row.values || {},
    version: row.version,
    inserted_position: Number(row.inserted_position),
  };
}

/* ------------------------------------------------------------------ *
 * Typed values at the write boundary
 * ------------------------------------------------------------------ */

const TYPE_WORDS = {
  text: 'a text value of at most 500 characters',
  integer: 'an integer value',
  decimal: 'a decimal value with at most two decimal places',
  date: 'a date value in year month day order',
  choice: 'one of its own options',
  flag: 'a flag value of true or false',
};

const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDate(text) {
  const m = DATE_SHAPE.exec(text);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

function typeRefusal(col) {
  return refusal(
    422,
    `${col.caption} wants ${TYPE_WORDS[col.type]}.`,
    col.caption,
    { column: col.caption, caption: col.caption, wanted_type: col.type }
  );
}

/**
 * Coerce one value for one column, or raise the column's own type refusal.
 * Returns null for a cleared value.
 */
function coerceValue(col, raw) {
  if (raw === null) return null;
  switch (col.type) {
    case 'text': {
      if (typeof raw !== 'string') throw typeRefusal(col);
      if (raw.length > 500) throw typeRefusal(col);
      return raw;
    }
    case 'integer': {
      if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) throw typeRefusal(col);
      return raw;
    }
    case 'decimal': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) throw typeRefusal(col);
      const text = String(raw);
      if (text.includes('e') || text.includes('E')) throw typeRefusal(col);
      const dot = text.indexOf('.');
      if (dot !== -1 && text.length - dot - 1 > 2) throw typeRefusal(col);
      return raw;
    }
    case 'date': {
      if (typeof raw !== 'string' || !validDate(raw)) throw typeRefusal(col);
      return raw;
    }
    case 'choice': {
      const options = col.options || [];
      if (typeof raw !== 'string' || !options.includes(raw)) throw typeRefusal(col);
      return raw;
    }
    case 'flag': {
      if (raw !== true && raw !== false) throw typeRefusal(col);
      return raw;
    }
    default:
      throw typeRefusal(col);
  }
}

/** Validate a whole values map against the table's columns, all or nothing. */
function coerceValues(cols, given) {
  if (given === null || typeof given !== 'object' || Array.isArray(given)) {
    throw refusal(422, 'A row carries a values map keyed by column caption.', 'values');
  }
  const byCaption = new Map(cols.map((c) => [c.caption, c]));
  const out = {};
  for (const key of Object.keys(given)) {
    const col = byCaption.get(key);
    if (!col) {
      throw refusal(422, `${key} is not a column of this table.`, 'values');
    }
    out[key] = coerceValue(col, given[key]);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The append-only change log, as a hash chain
 * ------------------------------------------------------------------ */

async function appendEntries(client, streamSlug, entries) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['keystone-log:' + streamSlug]);
  const head = await client.query(
    'SELECT ordinal, entry_hash FROM log_entries WHERE table_slug = $1 ORDER BY ordinal DESC LIMIT 1',
    [streamSlug]
  );
  let ordinal = head.rows.length ? head.rows[0].ordinal : 0;
  let previous = head.rows.length ? head.rows[0].entry_hash : ZERO_HASH;
  const written = [];
  for (const e of entries) {
    ordinal += 1;
    const recorded_at = e.recorded_at;
    const column = e.column === undefined ? null : e.column;
    const hash = entryHash({
      previous_hash: previous,
      table_slug: streamSlug,
      ordinal,
      action: e.action,
      account: e.account,
      column,
      recorded_at,
    });
    const r = await client.query(
      `INSERT INTO log_entries (table_slug, ordinal, action, account, recorded_at, business_day,
         column_caption, before, after, subject, previous_hash, entry_hash, row_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        streamSlug,
        ordinal,
        e.action,
        e.account,
        recorded_at,
        businessDay(recorded_at),
        column,
        e.before === undefined || e.before === null ? null : JSON.stringify(e.before),
        e.after === undefined || e.after === null ? null : JSON.stringify(e.after),
        e.subject === undefined ? null : e.subject,
        previous,
        hash,
        e.row_id === undefined ? null : e.row_id,
      ]
    );
    previous = hash;
    written.push(r.rows[0]);
  }
  return written;
}

function publicLogEntry(row) {
  return {
    id: String(row.id),
    table: row.table_slug,
    ordinal: row.ordinal,
    action: row.action,
    account: row.account,
    column: row.column_caption === undefined ? null : row.column_caption,
    recorded_at: row.recorded_at,
    business_day: row.business_day,
    before: row.before === undefined ? null : row.before,
    after: row.after === undefined ? null : row.after,
    subject: row.subject === undefined ? null : row.subject,
    previous_hash: row.previous_hash,
    entry_hash: row.entry_hash,
  };
}

/* ------------------------------------------------------------------ *
 * The one write boundary: role, lock, allowance, version, type
 * ------------------------------------------------------------------ */

const STALE_VERSION_REASON = 'This row has moved on.';

/**
 * Gate one row amendment. Checks are made in the published order and the
 * first failure is the one raised, so a caller is told the one thing that
 * stopped them.
 */
async function checkWriteBoundary(client, opts) {
  const { table, role, action, at } = opts;

  // 1. Role
  if (!roleAllows(role, 'amend_row')) {
    throw refusal(403, 'This role does not amend rows.', 'role');
  }

  // 2. Lock
  if (table.locked_period) {
    throw refusal(
      409,
      `This table is locked for the ${table.locked_period} reporting period.`,
      'locked_period',
      { locked_period: table.locked_period, period: table.locked_period }
    );
  }

  const tier = await tierInForce(table.department, at, client);

  // 3a. Row allowance, on a create only: an amendment adds no row.
  if (action === 'create') {
    const count = await rowCountFor(table.slug, client);
    if (count >= tier.row_allowance) {
      throw refusal(
        422,
        `The ${tier.name} tier allows ${tier.row_allowance} rows a table and this table holds ${count}.`,
        'row_allowance',
        { tier: tier.name, allowance: tier.row_allowance, row_allowance: tier.row_allowance, count }
      );
    }
  }

  // 3b. Content allowance, on a create and on an amendment alike.
  if (action === 'create' || action === 'update') {
    const cols = await columnsFor(table.slug, client);
    const bytes = await contentBytesFor(table.slug, cols, client);
    const kilobytes = Math.floor(bytes / 1024);
    if (kilobytes >= tier.content_allowance_kilobytes) {
      throw refusal(
        422,
        `The ${tier.name} tier allows ${tier.content_allowance_kilobytes} content kilobytes a table and this table holds ${kilobytes}.`,
        'content_kilobytes',
        {
          tier: tier.name,
          allowance: tier.content_allowance_kilobytes,
          content_allowance_kilobytes: tier.content_allowance_kilobytes,
          content_kilobytes: kilobytes,
        }
      );
    }
  }

  return tier;
}

module.exports = {
  Refusal,
  refusal,
  sendRefusal,
  DEPARTMENT_CLOSED,
  STEWARDS_ONLY,
  ROLE_POWERS,
  ROLE_NAMES,
  roleAllows,
  grantsFor,
  allGrantsFor,
  roleOn,
  retentionCount,
  listTiers,
  tierByName,
  grantInForce,
  tierInForce,
  listDepartmentGrants,
  tableBySlug,
  columnsFor,
  contentBytesFor,
  rowContentBytes,
  rowCountFor,
  logHighOrdinal,
  tableAnswer,
  publicColumn,
  publicRow,
  coerceValue,
  coerceValues,
  typeRefusal,
  appendEntries,
  publicLogEntry,
  checkWriteBoundary,
  STALE_VERSION_REASON,
  TYPE_WORDS,
};
