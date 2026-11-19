// Core helpers: the one refusal builder, session auth, throttling, tier grants in force,
// content bytes, the hash chain, view evaluation and cursors. Every rule the brief states
// once lives here once.
const crypto = require('crypto');
const { pool, sha256, uid, businessDay, columnContribution } = require('./store');

const PASSWORD_SALT = 'keystone-password:';

// ---------- one refusal shape ----------

function refuse(res, status, reason, field, extra = {}) {
  const body = { reason, field, ...extra };
  return res.status(status).json(body);
}

// ---------- time ----------

function now() {
  return new Date();
}

function iso(moment) {
  return new Date(moment).toISOString();
}

// ---------- passwords ----------

function hashPassword(password) {
  return sha256(PASSWORD_SALT + password);
}

const OBVIOUS_PASSWORDS = ['keystonetables', 'northbankmutual', 'passwordpassword', 'claimsworkspace'];

function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 12) {
    return 'A password must be at least 12 characters long.';
  }
  if (OBVIOUS_PASSWORDS.includes(password.toLowerCase())) {
    return 'That password is too obvious to use.';
  }
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function emailProblem(email) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email) || email.length > 254) {
    return 'This email cannot be used.';
  }
  return null;
}

// ---------- sessions ----------

const SESSION_COOKIE = 'keystone_session';
const SESSION_HOURS = 12;

async function createSession(accountEmail) {
  const value = crypto.randomBytes(32).toString('hex');
  const created = now();
  const expires = new Date(created.getTime() + SESSION_HOURS * 3600 * 1000);
  await pool.query(
    'INSERT INTO sessions (id, value, account, created_at, expires_at) VALUES ($1,$2,$3,$4,$5)',
    [uid('sess'), value, accountEmail, created, expires]);
  return { value, created, expires };
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

// Reads the session from the cookie or the bearer token. A stale session answers null and its
// row stays in the store; nothing is pruned. Permission is read again from role_grants on
// every request, so a session carries the account and nothing a grant decides.
async function readSession(req) {
  let value = null;
  const auth = req.headers.authorization;
  if (auth && /^Bearer\s+/i.test(auth)) {
    value = auth.replace(/^Bearer\s+/i, '').trim();
  }
  if (!value) {
    value = parseCookies(req)[SESSION_COOKIE] || null;
  }
  if (!value) return null;
  const r = await pool.query('SELECT * FROM sessions WHERE value = $1', [value]);
  const row = r.rows[0];
  if (!row) return null;
  // The boundary is exclusive: refused at and after expires_at, accepted strictly before it.
  if (now().getTime() >= new Date(row.expires_at).getTime()) return null;
  return row;
}

async function endSession(value) {
  await pool.query('DELETE FROM sessions WHERE value = $1', [value]);
}

// ---------- roles and permissions ----------

const ROLE_ORDER = { viewer: 1, analyst: 2, editor: 3, steward: 4 };

async function accountGrants(email) {
  const r = await pool.query(
    'SELECT * FROM role_grants WHERE account = $1 ORDER BY department', [email]);
  const grants = [];
  for (const g of r.rows) {
    if (now().getTime() >= new Date(g.authorises_from).getTime()) {
      grants.push({ id: g.id, account: g.account, department: g.department, role: g.role, authorises_from: iso(g.authorises_from) });
    }
  }
  return grants;
}

async function roleOn(accountEmail, department) {
  const r = await pool.query(
    'SELECT * FROM role_grants WHERE account = $1 AND department = $2', [accountEmail, department]);
  for (const g of r.rows) {
    if (now().getTime() >= new Date(g.authorises_from).getTime()) return g.role;
  }
  return null;
}

function roleAllows(action, role) {
  if (!role) return false;
  switch (action) {
    case 'read': return true;
    case 'manage_views': return role === 'analyst' || role === 'editor' || role === 'steward';
    case 'amend_rows': return role === 'editor' || role === 'steward';
    case 'decide': return role === 'steward';
    case 'admin': return role === 'steward';
    default: return false;
  }
}

// ---------- tier grants ----------

// The grant in force at a moment is the one with the greatest effective_at at or before it.
// The boundary moment counts as inside.
async function tierGrantInForce(department, at) {
  const r = await pool.query(
    'SELECT dg.*, t.row_allowance, t.stored_megabytes, t.content_allowance_kilobytes, t.view_allowance, t.retention, t.position ' +
    'FROM department_grants dg JOIN tiers t ON t.name = dg.tier ' +
    'WHERE dg.department = $1 AND dg.effective_at <= $2 ORDER BY dg.effective_at DESC LIMIT 1',
    [department, at]);
  return r.rows[0] || null;
}

async function tierByName(name) {
  const r = await pool.query('SELECT * FROM tiers WHERE name = $1', [name]);
  return r.rows[0] || null;
}

// ---------- content bytes ----------

// A row contributes the sum over the table's columns of what that column holds in that row.
function rowContentBytes(columns, values) {
  let bytes = 0;
  for (const col of columns) {
    bytes += columnContribution(col.type, values[col.caption]);
  }
  return bytes;
}

function kilobytes(bytes) {
  return Math.floor(bytes / 1024);
}

// ---------- the change log hash chain ----------

const ZERO_HASH = '0'.repeat(64);

// The digest of exactly these seven parts joined by a single `|`: previous_hash, table_slug,
// ordinal, action, account, column (empty when none), recorded_at. Nothing else enters.
function entryHash(previousHash, tableSlug, ordinal, action, account, column, recordedAt) {
  const text = [previousHash, tableSlug, String(ordinal), action, account, column || '', recordedAt].join('|');
  return sha256(text);
}

// Reads the head of a stream (the entry one below the next ordinal) inside the caller's
// transaction, so concurrent amendments fork nothing.
async function logHead(client, tableSlug) {
  const r = await client.query(
    'SELECT ordinal, entry_hash FROM log_entries WHERE table_slug = $1 ORDER BY ordinal DESC LIMIT 1',
    [tableSlug]);
  if (r.rows.length === 0) return { ordinal: 0, entry_hash: ZERO_HASH };
  return { ordinal: r.rows[0].ordinal, entry_hash: r.rows[0].entry_hash };
}

// A JSONB parameter is a valid JSON document: a scalar is quoted, an object passes as is.
function jsonValue(value) {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

// Appends one entry with the ordinal, the chain link and the digest built inside.
async function appendLogEntry(client, tableSlug, action, account, columnCaption, before, after, subject, recordedAt) {
  const head = await logHead(client, tableSlug);
  const ordinal = head.ordinal + 1;
  const previousHash = head.entry_hash;
  const recorded = iso(recordedAt);
  const digest = entryHash(previousHash, tableSlug, ordinal, action, account, columnCaption, recorded);
  const id = uid('log');
  await client.query(
    `INSERT INTO log_entries (id, table_slug, ordinal, action, account, subject, recorded_at, business_day, column_caption, before, after, previous_hash, entry_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, tableSlug, ordinal, action, account, subject || null, recordedAt, businessDay(recordedAt),
     columnCaption || null, jsonValue(before), jsonValue(after),
     previousHash, digest]);
  return { id, ordinal, previousHash, entryHash };
}

// ---------- views: filters, sorts, ordering ----------

const OPERATORS_BY_TYPE = {
  text: ['equals', 'not equals', 'contains', 'greater than', 'less than', 'is empty'],
  integer: ['equals', 'not equals', 'greater than', 'less than', 'is empty'],
  decimal: ['equals', 'not equals', 'greater than', 'less than', 'is empty'],
  date: ['equals', 'not equals', 'greater than', 'less than', 'is empty'],
  choice: ['equals', 'not equals', 'greater than', 'less than', 'is empty'],
  flag: ['equals', 'not equals', 'is empty'],
};

function fold(text) {
  return String(text).toLowerCase();
}

function isEmptyValue(value) {
  return value === undefined || value === null || value === '';
}

// One filter's comparison. Greater than and less than are never offered for a flag column,
// and an empty value satisfies neither of them, so an empty value answers false for both.
function filterHolds(column, filter, values) {
  const value = values[filter.column];
  const op = filter.operator;
  if (op === 'is empty') return isEmptyValue(value);
  if (isEmptyValue(value)) {
    // equals and not equals against an empty stored value: equals matches empty, not equals
    // matches nothing else an empty value could be asked to equal.
    if (op === 'equals') return isEmptyValue(filter.value);
    if (op === 'not equals') return !isEmptyValue(filter.value);
    return false;
  }
  const type = column.type;
  switch (op) {
    case 'equals': return compareEquals(type, value, filter.value);
    case 'not equals': return !compareEquals(type, value, filter.value);
    case 'contains': return type === 'text' && fold(value).includes(fold(filter.value));
    case 'greater than': return compareOrder(type, value, filter.value) > 0;
    case 'less than': return compareOrder(type, value, filter.value) < 0;
    default: return false;
  }
}

function compareEquals(type, a, b) {
  if (isEmptyValue(a) && isEmptyValue(b)) return true;
  if (type === 'integer' || type === 'decimal') return Number(a) === Number(b);
  if (type === 'flag') return Boolean(a) === Boolean(b);
  return fold(a) === fold(b);
}

// Numbers by value, dates by calendar order, text and choice by the sort ordering with case
// folded away and digits ahead of letters.
function compareOrder(type, a, b) {
  if (isEmptyValue(a) || isEmptyValue(b)) return 0;
  if (type === 'integer' || type === 'decimal') {
    const x = Number(a), y = Number(b);
    return x < y ? -1 : (x > y ? 1 : 0);
  }
  if (type === 'date') return String(a) < String(b) ? -1 : (String(a) > String(b) ? 1 : 0);
  return fold(a) < fold(b) ? -1 : (fold(a) > fold(b) ? 1 : 0);
}

// Every filter on a view has to hold; a view carrying no filter answers every row.
function applyFilters(columns, filters, rowValues) {
  for (const filter of filters || []) {
    const column = columns.find(c => c.caption === filter.column);
    if (!column) return false;
    if (!filterHolds(column, filter, rowValues)) return false;
  }
  return true;
}

// The sort list is applied in its own order; ties keep insertion order; an empty value sorts
// after every valued row under asc and ahead of them under desc.
function sortCompare(columns, sorts, a, b) {
  for (const sort of sorts || []) {
    const column = columns.find(c => c.caption === sort.column);
    if (!column) continue;
    const av = a.values[sort.column];
    const bv = b.values[sort.column];
    const aEmpty = isEmptyValue(av);
    const bEmpty = isEmptyValue(bv);
    if (aEmpty && bEmpty) continue;
    if (aEmpty) return sort.direction === 'desc' ? -1 : 1;
    if (bEmpty) return sort.direction === 'desc' ? 1 : -1;
    const cmp = compareOrder(column.type, av, bv);
    if (cmp !== 0) return sort.direction === 'desc' ? -cmp : cmp;
  }
  return 0;
}

// ---------- opaque cursors ----------

// A cursor names the table (or the department queue) and the offset it was issued for.
// A caller passes one back unchanged and never builds one.
function encodeCursor(kind, scope, offset) {
  const payload = JSON.stringify({ k: kind, s: scope, o: offset });
  return Buffer.from('ks1.' + payload, 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  try {
    const text = Buffer.from(cursor, 'base64url').toString('utf8');
    if (!text.startsWith('ks1.')) return null;
    const parsed = JSON.parse(text.slice(4));
    if (typeof parsed.k !== 'string' || typeof parsed.s !== 'string' || typeof parsed.o !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

// ---------- the write boundary, shared by every row write ----------

// Checks role, then lock, then allowance, then version, then type — in that order — and
// reports the first failure. Returns a refusal descriptor or null.
async function checkWriteBoundary({ table, columns, accountEmail, row, newValues, client }) {
  const role = await roleOn(accountEmail, table.department);
  if (!roleAllows('amend_rows', role)) {
    return { status: 403, reason: 'Your role does not amend rows.', field: 'role' };
  }
  if (table.locked_period) {
    return { status: 409, reason: `This table is locked for period ${table.locked_period}.`, field: 'locked_period', extra: { locked_period: table.locked_period } };
  }
  const tier = await tierGrantInForce(table.department, now());
  if (!tier) {
    return { status: 422, reason: 'This department holds no tier grant in force.', field: 'tier' };
  }
  // The row allowance and the content allowance are read together, after the lock and before
  // the version; when both are exhausted the row allowance is the one reported.
  const count = Number((await client.query('SELECT count(*) AS c FROM rows WHERE table_id = $1', [table.id])).rows[0].c);
  if (!row && count >= tier.row_allowance) {
    return { status: 422, reason: `The ${tier.tier} tier allows ${tier.row_allowance} rows per table and this table holds ${count}.`, field: 'allowance', extra: { tier: tier.tier, allowance: tier.row_allowance, count } };
  }
  const baseBytes = await tableContentBytesFor(table.id, client);
  const previewBytes = previewContentBytes(baseBytes, columns, row, newValues, !row);
  const previewKb = kilobytes(previewBytes);
  if (previewKb >= tier.content_allowance_kilobytes) {
    const currentKb = kilobytes(baseBytes);
    return { status: 422, reason: `The ${tier.tier} tier allows ${tier.content_allowance_kilobytes} kilobytes per table and this table holds ${currentKb}.`, field: 'content_kilobytes', extra: { tier: tier.tier, content_allowance_kilobytes: tier.content_allowance_kilobytes, content_kilobytes: currentKb } };
  }
  return null;
}

// The table's content bytes over its stored rows, computed at the read from the per-column
// contributions. SQL carries the per-type contribution so thousands of rows stay fast.
const CONTENT_BYTES_SQL = `
SELECT COALESCE(SUM(
  CASE c.type
    WHEN 'integer' THEN 4
    WHEN 'decimal' THEN 8
    WHEN 'flag' THEN 1
    ELSE COALESCE(CHAR_LENGTH(COALESCE(r.values->>c.caption, '')), 0)
  END
), 0) AS bytes
FROM rows r
CROSS JOIN columns c
WHERE r.table_id = $1 AND c.table_id = $1
`;

async function tableContentBytesFor(tableId, client) {
  const r = await client.query(CONTENT_BYTES_SQL, [tableId]);
  return Number(r.rows[0].bytes);
}

// The content bytes the table would hold with one row replaced by newValues (amendment) or
// with one row added (create), decided without writing anything.
function previewContentBytes(baseBytes, columns, row, newValues, isCreate) {
  if (isCreate) return baseBytes + rowContentBytes(columns, newValues);
  return baseBytes - rowContentBytes(columns, row.values) + rowContentBytes(columns, newValues);
}


// The retention count a tier's retention words name: one, four, twelve or every one.
function retentionCount(retention) {
  switch (retention) {
    case 'one period': return 1;
    case 'four periods': return 4;
    case 'twelve periods': return 12;
    default: return Infinity;
  }
}

module.exports = {
  refuse, now, iso, hashPassword, passwordProblem, emailProblem,
  SESSION_COOKIE, SESSION_HOURS, createSession, parseCookies, readSession, endSession,
  ROLE_ORDER, accountGrants, roleOn, roleAllows,
  tierGrantInForce, tierByName,
  rowContentBytes, kilobytes, tableContentBytesFor, previewContentBytes,
  ZERO_HASH, entryHash, logHead, appendLogEntry,
  OPERATORS_BY_TYPE, fold, isEmptyValue, filterHolds, applyFilters, sortCompare,
  encodeCursor, decodeCursor, checkWriteBoundary, retentionCount,
};
