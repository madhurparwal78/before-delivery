import { query, withTransaction, isUnreachable } from './db.js';
import { now, nowIso, isoAt } from './clock.js';
import {
  nyDateStr, nyParts, nyMidnightUtcMs, dateFromStr, dateStr, addCalendarDays,
  endOfDayNy, firstBusinessDayOnOrAfter,
} from './calendar.js';
import { issueId, isWellFormedId, token, sha256Hex } from './ids.js';
import { readAmountCents, roundHalfUp, formatPlainSigned } from './money.js';
import { baseStringRefusal, singleLineRefusal, multiLineRefusal, codePoints, normalizeNfc } from './text.js';
import { effectiveDateForPost, effectiveDateForSchedule, approvalExpiry, approvalsRequiredFor, APPROVAL_THRESHOLD_CENTS, settlementPreview } from './domain.js';
import {
  ApiError, errUnauthorized, errForbidden, errNotFound, errValidation, errInvalidJson,
  errServiceUnavailable, errInternal, errMethodNotAllowed, sendJson,
} from './http.js';
import { hashPassword, verifyPassword } from './password.js';
import { ready } from './bootstrap.js';
import {
  LOCKOUT_MAX_FAILURES, LOGIN_LOCKOUT_WINDOW_SECONDS, INQUIRY_RATE_WINDOW_SECONDS,
  INQUIRY_MAX_IN_WINDOW, FX_QUOTE_TTL_SECONDS, MAX_BODY_BYTES,
} from './config.js';
import {
  requireSession, findSessionByToken, writeAudit, accountOut, transactionOut,
  recipientOut, loadPayment, loadPaymentFromPool, approvalsForPaymentFromPool,
  paymentOut, accountWithAvailable, accountWithAvailableFor, applyDebit,
  applyCredit, emitTransaction, isOwnerOrAdmin,
} from './store.js';
import { statementCsv } from './statement.js';
import { runIdempotentWrite } from './idempotency.js';

const SYSTEM_ACTOR = 'system@tallwind.invalid';
const FX_RATES = { EUR: '0.9200', GBP: '0.7900', CAD: '1.3600' };

export const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, pattern, handler });
}

// ---------- auth ----------

route('GET', '/api/health', async (ctx) => {
  if (!ready) throw errServiceUnavailable();
  try {
    await query('SELECT 1');
  } catch {
    throw errServiceUnavailable();
  }
  sendJson(ctx.res, 200, { status: 'ok' });
});

route('POST', '/api/auth/signup', async (ctx) => {
  const b = ctx.body;
  const fields = {};
  const name = readSingleLine(b, 'name', fields, { min: 1, max: 120, label: 'name' });
  const email = readEmail(b, 'email', fields, { required: true });
  const password = readPassword(b, 'password', fields);
  if (Object.keys(fields).length) throw errValidation(fields);
  const at = now();
  try {
    const created = await withTransaction(async (client) => {
      const dup = await client.query('SELECT 1 FROM users WHERE email = $1', [email]);
      if (dup.rowCount > 0) throw new ApiError(409, 'email_taken');
      const userId = issueId('user');
      const companyId = issueId('comp');
      const company = name;
      await client.query('INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1,$2,$3,$4,$5)', [userId, email, name, hashPassword(password), new Date(at)]);
      await client.query('INSERT INTO companies (id, name, created_at) VALUES ($1,$2,$3)', [companyId, company, new Date(at)]);
      await client.query('INSERT INTO memberships (user_id, company_id, role) VALUES ($1,$2,$3)', [userId, companyId, 'owner']);
      await client.query('INSERT INTO accounts (id, company_id, name, kind, balance_cents, created_at, seq) VALUES ($1,$2,$3,$4,0,$5,1)', [issueId('acct'), companyId, 'Checking', 'checking', new Date(at)]);
      return { userId, companyId };
    });
    const tok = token();
    await query('INSERT INTO sessions (token, user_id, created_at) VALUES ($1,$2,$3)', [tok, created.userId, new Date(at)]);
    sendJson(ctx.res, 201, {
      token: tok,
      user: { id: created.userId, email, name, role: 'owner', company_id: created.companyId },
    });
  } catch (e) {
    if (e instanceof ApiError && e.code === 'email_taken') throw e;
    throw e;
  }
});

route('POST', '/api/auth/login', async (ctx) => {
  const b = ctx.body;
  const fields = {};
  const email = readEmail(b, 'email', fields, { required: true });
  const password = readPassword(b, 'password', fields, { required: true });
  if (Object.keys(fields).length) {
    await burnPasswordWork();
    throw errValidation(fields);
  }
  const at = now();
  const winStart = at - LOGIN_LOCKOUT_WINDOW_SECONDS * 1000;
  // One transaction per attempt, holding the email's lock from the count
  // through the insert, so concurrent arrivals count one at a time.
  const outcome = await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`login|${email}`]);
    const c = await client.query('SELECT COUNT(*) AS n FROM sign_in_failures WHERE email = $1 AND at >= $2', [email, new Date(winStart)]);
    const locked = Number(c.rows[0].n) >= LOCKOUT_MAX_FAILURES;
    if (locked) return { kind: 'locked' };
    const found = await client.query('SELECT * FROM users WHERE email = $1', [email]);
    const row = found.rowCount > 0 ? found.rows[0] : null;
    let ok = false;
    if (row) {
      ok = verifyPassword(password, row.password_hash);
    } else {
      await burnPasswordWork();
    }
    if (!ok) {
      await client.query('INSERT INTO sign_in_failures (email, at) VALUES ($1,$2)', [email, new Date(at)]);
      return { kind: 'invalid' };
    }
    await client.query('DELETE FROM sign_in_failures WHERE email = $1', [email]);
    return { kind: 'ok', row };
  });
  if (outcome.kind === 'locked') throw new ApiError(429, 'too_many_attempts');
  if (outcome.kind === 'invalid') throw new ApiError(401, 'invalid_credentials');
  const row = outcome.row;
  const tok = token();
  await query('INSERT INTO sessions (token, user_id, created_at) VALUES ($1,$2,$3)', [tok, row.id, new Date(at)]);
  const mem = await query('SELECT company_id, role FROM memberships WHERE user_id = $1', [row.id]);
  sendJson(ctx.res, 200, {
    token: tok,
    user: { id: row.id, email: row.email, name: row.name, role: mem.rows[0].role, company_id: mem.rows[0].company_id },
  });
});

async function burnPasswordWork() {
  verifyPassword('burn', hashPassword('burn'));
}

route('POST', '/api/auth/logout', async (ctx) => {
  const sess = await requireSession(ctx.req);
  await query('DELETE FROM sessions WHERE token = $1', [sess.token]);
  ctx.onLogout(sess.token);
  ctx.res.writeHead(204, { 'Cache-Control': 'no-store' });
  ctx.res.end();
});

route('GET', '/api/me', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const preview = settlementPreview();
  sendJson(ctx.res, 200, {
    user: {
      id: sess.id,
      email: sess.email,
      name: sess.name,
      role: sess.role,
      company_id: sess.company_id,
    },
    business_date: nyDateStr(now()),
    business_now: nowIso(),
    settlement_dates: preview.dates,
    settlement_dates_change_at: isoAt(preview.changeAtMs),
  });
});

// ---------- field readers ----------

function isMissing(v) {
  return v === undefined || v === null || v === '';
}

function readString(b, key) {
  const v = b[key];
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return null;
  return v;
}

function readSingleLine(b, key, fields, opts = {}) {
  const label = opts.label || key;
  const v = readString(b, key);
  if (v === undefined) {
    if (opts.required) fields[label] = requiredMessage(opts.label || key);
    return undefined;
  }
  if (v === null) { fields[label] = requiredMessage(label); return null; }
  const trimmed = v.trim();
  if (trimmed === '') { fields[label] = requiredMessage(label); return ''; }
  const refusal = singleLineRefusal(trimmed);
  if (refusal) { fields[label] = refusalMessage(refusal); return trimmed; }
  const n = codePoints(trimmed);
  if (n < (opts.min || 1) || (opts.max && n > opts.max)) { fields[label] = lengthMessage(label, opts); return trimmed; }
  return trimmed;
}

function requiredMessage(label) {
  return `Enter ${label}`;
}

function refusalMessage(kind) {
  if (kind === 'control' || kind === 'direction') return 'Remove control or direction characters';
  return 'Text contains invalid characters';
}

function lengthMessage(label, opts) {
  if (opts.max === 120 && (opts.min || 1) === 1) return `Keep this to 120 characters or fewer`;
  return `Enter a valid ${label}`;
}

function readEmail(b, key, fields, opts = {}) {
  const v = readString(b, key);
  if (v === undefined || v === null) { fields[key] = 'Enter a valid email'; return undefined; }
  const trimmed = String(v).trim().toLowerCase();
  if (trimmed === '') { fields[key] = 'Enter a valid email'; return ''; }
  const refusal = baseStringRefusal(trimmed);
  if (refusal) { fields[key] = 'Enter a valid email'; return trimmed; }
  if (singleLineRefusal(trimmed)) { fields[key] = 'Enter a valid email'; return trimmed; }
  if (codePoints(trimmed) > 254) { fields[key] = 'Enter a valid email'; return trimmed; }
  const at = trimmed.indexOf('@');
  if (at <= 0 || at !== trimmed.lastIndexOf('@')) { fields[key] = 'Enter a valid email'; return trimmed; }
  const domain = trimmed.slice(at + 1);
  if (!domain.includes('.') || domain.includes(' ')) { fields[key] = 'Enter a valid email'; return trimmed; }
  return trimmed;
}

function readPassword(b, key, fields, opts = {}) {
  const v = readString(b, key);
  if (v === undefined || v === null) { fields[key] = 'Password must be at least 8 characters'; return undefined; }
  if (typeof v !== 'string') { fields[key] = 'Password must be at least 8 characters'; return null; }
  const refusal = baseStringRefusal(v);
  if (refusal) { fields[key] = 'Text contains invalid characters'; return v; }
  const n = codePoints(v);
  if (n < 8 || n > 128) { fields[key] = 'Password must be at least 8 characters'; return v; }
  return v;
}

function readMemo(b, key, fields, opts = {}) {
  const v = readString(b, key);
  if (v === undefined || v === null) return null;
  const refusal = multiLineRefusal(v);
  if (refusal) { fields[key] = 'Keep the memo to 140 characters of plain text'; return v; }
  const n = codePoints(v);
  if (n > 140) { fields[key] = 'Keep the memo to 140 characters of plain text'; return v; }
  return v;
}

function readAmount(b, key, fields) {
  const v = b[key];
  if (v === undefined || v === null) { fields[key] = 'Enter an amount'; return undefined; }
  const cents = readAmountCents(v);
  if (cents === null) { fields[key] = 'Enter a valid amount'; return undefined; }
  return cents;
}

function readDate(b, key, fields, afterDate) {
  const v = b[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !dateFromStr(v)) { fields[key] = 'Choose a valid date'; return undefined; }
  if (afterDate && v <= afterDate) { fields[key] = `Choose a date after ${afterDate}`; return v; }
  return v;
}

// ---------- accounts ----------

route('GET', '/api/accounts', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const res = await query(
    `SELECT a.*, COALESCE((SELECT SUM(p.total_debit_cents) FROM payments p
       WHERE p.source_account_id = a.id AND p.status = 'pending_approval'), 0) AS held_cents
     FROM accounts a WHERE a.company_id = $1 ORDER BY a.seq, a.id`,
    [sess.company_id]
  );
  sendJson(ctx.res, 200, { accounts: res.rows.map(accountOut) });
});

route('POST', '/api/accounts', async (ctx) => {
  const sess = await requireSession(ctx.req);
  if (!isOwnerOrAdmin(sess)) throw errForbidden();
  const fields = {};
  const name = readAccountName(ctx.body, fields);
  const kind = ctx.body.kind;
  if (kind !== 'checking' && kind !== 'savings' && kind !== 'treasury') fields.kind = 'Choose an account kind';
  if (Object.keys(fields).length) throw errValidation(fields);
  const at = now();
  const id = issueId('acct');
  const seqRes = await query('SELECT COALESCE(MAX(seq),0)+1 AS s FROM accounts WHERE company_id = $1', [sess.company_id]);
  await query(
    'INSERT INTO accounts (id, company_id, name, kind, balance_cents, created_at, seq) VALUES ($1,$2,$3,$4,0,$5,$6)',
    [id, sess.company_id, name, kind, new Date(at), seqRes.rows[0].s]
  );
  sendJson(ctx.res, 201, {
    id, name, kind, balance_cents: 0, available_cents: 0, currency: 'USD',
  });
});

function readAccountName(b, fields) {
  const v = b.name;
  if (typeof v !== 'string') { fields.name = 'Enter a name of 1 to 60 characters'; return undefined; }
  const trimmed = v.trim();
  if (trimmed === '') { fields.name = 'Enter a name of 1 to 60 characters'; return ''; }
  const refusal = singleLineRefusal(trimmed);
  if (refusal) { fields.name = 'Remove control or direction characters'; return trimmed; }
  const n = codePoints(trimmed);
  if (n < 1 || n > 60) { fields.name = 'Enter a name of 1 to 60 characters'; return trimmed; }
  return trimmed;
}

route('GET', '/api/accounts/:account_id', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const acct = await accountWithAvailableFor(query, sess.company_id, ctx.params.account_id);
  if (!acct) throw errNotFound();
  const recent = await query(
    'SELECT * FROM transactions WHERE account_id = $1 ORDER BY created_at DESC, id DESC LIMIT 10',
    [acct.id]
  );
  sendJson(ctx.res, 200, {
    account: accountOut(acct),
    recent_transactions: recent.rows.map(transactionOut),
  });
});

route('GET', '/api/snapshot', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const accounts = await query(
    `SELECT a.*, COALESCE((SELECT SUM(p.total_debit_cents) FROM payments p
       WHERE p.source_account_id = a.id AND p.status = 'pending_approval'), 0) AS held_cents
     FROM accounts a WHERE a.company_id = $1 ORDER BY a.seq, a.id`,
    [sess.company_id]
  );
  const perAccount = [];
  let totalCash = 0;
  let totalAvailable = 0;
  for (const row of accounts.rows) {
    const available = Number(row.balance_cents) - Number(row.held_cents);
    totalCash += Number(row.balance_cents);
    totalAvailable += available;
    perAccount.push({
      account_id: row.id,
      balance_cents: Number(row.balance_cents),
      available_cents: available,
      sparkline: await sparklineFor(row.id, row.balance_cents),
    });
  }
  sendJson(ctx.res, 200, {
    total_cash_cents: totalCash,
    total_available_cents: totalAvailable,
    per_account: perAccount,
  });
});

async function sparklineFor(accountId, currentBalance) {
  // Thirty New York calendar dates ending today. Index i is the date 29-i days
  // before today; each entry is the balance at 23:59:59.999 New York on that
  // date, and index 29 is the current balance.
  const today = nyDateStr(now());
  const { y, m, d } = dateFromStr(today);
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const t = new Date(Date.UTC(y, m - 1, d - i));
    days.push(dateStr(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()));
  }
  // Fold the window's transactions once: each entry is the running sum of
  // every transaction created before that date's next New York midnight.
  const firstDate = days[0];
  const firstParts = dateFromStr(firstDate);
  const firstCutoff = nyMidnightUtcMs(firstParts.y, firstParts.m, firstParts.d);
  const rows = await query(
    `SELECT created_at, amount_cents, direction FROM transactions
     WHERE account_id = $1 AND created_at >= $2 ORDER BY created_at ASC, id ASC`,
    [accountId, new Date(firstCutoff)]
  );
  const events = rows.rows.map((r) => ({
    at: new Date(r.created_at).getTime(),
    delta: r.direction === 'credit' ? Number(r.amount_cents) : -Number(r.amount_cents),
  }));
  const out = [];
  let idx = 0;
  let running = 0;
  for (let i = 0; i < 30; i++) {
    const date = days[i];
    const { y: dy, m: dm, d: dd } = dateFromStr(date);
    const cutoff = nyMidnightUtcMs(dy, dm, dd + 1); // 00:00 next NY day
    while (idx < events.length && events[idx].at < cutoff) {
      running += events[idx].delta;
      idx++;
    }
    out.push(running);
  }
  out[29] = Number(currentBalance);
  return out;
}

// ---------- transactions feed ----------

const METHODS = ['ach', 'wire', 'rtp', 'check', 'card', 'transfer'];

route('GET', '/api/transactions', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const q = ctx.query;
  const fields = {};
  const limitRaw = q.get('limit');
  let limit = 50;
  if (limitRaw !== null && limitRaw !== '') {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1 || n > 100) fields.limit = 'Limit must be 1 to 100';
    else limit = n;
  }
  const accountFilter = q.get('account_id');
  if (accountFilter !== null && accountFilter !== '') {
    if (!isWellFormedId(accountFilter)) fields.account_id = 'Unknown account';
    else {
      const own = await query('SELECT 1 FROM accounts WHERE id = $1 AND company_id = $2', [accountFilter, sess.company_id]);
      if (own.rowCount === 0) fields.account_id = 'Unknown account';
    }
  }
  const method = q.get('method');
  if (method !== null && method !== '' && !METHODS.includes(method)) fields.method = 'Unknown method';
  const direction = q.get('direction');
  if (direction !== null && direction !== '' && direction !== 'credit' && direction !== 'debit') fields.direction = 'Unknown direction';
  const cursorRaw = q.get('cursor');
  let cursorAt = null;
  let cursorId = null;
  let cursorFilters = null;
  if (cursorRaw !== null && cursorRaw !== '') {
    const parsed = parseCursor(cursorRaw);
    if (!parsed) fields.cursor = 'Invalid cursor';
    else {
      cursorAt = parsed.at;
      cursorId = parsed.id;
      cursorFilters = parsed.filters;
    }
  }
  if (Object.keys(fields).length) throw errValidation(fields);
  const wantFilters = {
    account_id: accountFilter || '',
    method: method || '',
    direction: direction || '',
  };
  if (cursorFilters && JSON.stringify(cursorFilters) !== JSON.stringify(wantFilters)) {
    throw errValidation({ cursor: 'Cursor does not match these filters' });
  }
  const params = [];
  let where = 't.account_id IN (SELECT id FROM accounts WHERE company_id = $1)';
  params.push(sess.company_id);
  if (accountFilter) { params.push(accountFilter); where += ` AND t.account_id = $${params.length}`; }
  if (method) { params.push(method); where += ` AND t.method = $${params.length}`; }
  if (direction) { params.push(direction); where += ` AND t.direction = $${params.length}`; }
  if (cursorAt !== null) {
    params.push(new Date(cursorAt));
    where += ` AND (t.created_at, t.id) < ($${params.length},`;
    params.push(cursorId);
    where += ` $${params.length})`;
  }
  params.push(limit + 1);
  const res = await query(
    `SELECT t.* FROM transactions t WHERE ${where}
     ORDER BY t.created_at DESC, t.id DESC LIMIT $${params.length}`,
    params
  );
  const rows = res.rows.slice(0, limit);
  let nextCursor = null;
  if (res.rows.length > limit) {
    const last = rows[rows.length - 1];
    nextCursor = makeCursor(new Date(last.created_at).getTime(), last.id, wantFilters);
  }
  sendJson(ctx.res, 200, { transactions: rows.map(transactionOut), next_cursor: nextCursor });
});

function makeCursor(at, id, filters) {
  const payload = { at: at, id, f: filters };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function parseCursor(raw) {
  if (typeof raw !== 'string' || raw.length > 512) return null;
  let json;
  try {
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!json || typeof json !== 'object') return null;
  if (typeof json.at !== 'number' || !Number.isFinite(json.at) || typeof json.id !== 'string' || !isWellFormedId(json.id)) return null;
  if (!json.f || typeof json.f !== 'object') return null;
  for (const k of ['account_id', 'method', 'direction']) {
    if (typeof json.f[k] !== 'string') return null;
  }
  return { at: json.at, id: json.id, filters: { account_id: json.f.account_id, method: json.f.method, direction: json.f.direction } };
}

// ---------- search ----------

route('GET', '/api/search', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const qRaw = ctx.query.get('q');
  if (qRaw === null || qRaw === undefined) throw errValidation({ q: 'Enter at least 2 characters' });
  const refusal = baseStringRefusal(qRaw);
  if (refusal) throw errValidation({ q: 'Text contains invalid characters' });
  const trimmed = qRaw.trim();
  if (trimmed.length < 2 || codePoints(trimmed) > 100) throw errValidation({ q: 'Enter between 2 and 100 characters' });
  // Literal substring match: escape LIKE's own metacharacters so %, _ and \
  // match only themselves.
  const like = `%${escapeLike(trimmed.toLowerCase())}%`;
  const recipients = await query(
    `SELECT * FROM recipients WHERE company_id = $1 AND status != 'removed'
       AND lower(display_name) LIKE $2 ESCAPE '\\' ORDER BY display_name LIMIT 20`,
    [sess.company_id, like]
  );
  const transactions = await query(
    `SELECT t.* FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE a.company_id = $1 AND (lower(t.counterparty) LIKE $2 ESCAPE '\\' OR lower(COALESCE(t.memo,'')) LIKE $2 ESCAPE '\\')
     ORDER BY t.created_at DESC, t.id DESC LIMIT 20`,
    [sess.company_id, like]
  );
  sendJson(ctx.res, 200, {
    recipients: recipients.rows.map(recipientOut),
    transactions: transactions.rows.map(transactionOut),
  });
});

function escapeLike(s) {
  return s.replace(/([%_\\])/g, '\\$1');
}

// ---------- statements ----------

route('GET', '/api/accounts/:account_id/statement.csv', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const acct = await accountWithAvailableFor(query, sess.company_id, ctx.params.account_id);
  if (!acct) throw errNotFound();
  const month = ctx.query.get('month');
  let monthDate = null;
  if (month !== null && month !== '') {
    if (!/^\d{4}-\d{2}$/.test(month)) throw errValidation({ month: 'Choose a valid month' });
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7));
    if (m < 1 || m > 12 || y < 1900) throw errValidation({ month: 'Choose a valid month' });
    const todayNy = nyDateStr(now());
    if (`${month}` > todayNy.slice(0, 7)) throw errValidation({ month: 'Choose a month that has ended or the current month' });
    monthDate = { y, m };
  }
  const csv = await statementCsv(sess.company_id, acct, monthDate);
  const nameBase = month ? `${acct.name}-statement-${month}` : `${acct.name}-statement-all`;
  const ascii = nameBase.replace(/[^ -~]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(nameBase).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  ctx.res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
  });
  ctx.res.end(csv);
});

// ---------- recipients ----------

function abaChecksumOk(routing) {
  if (!/^[0-9]{9}$/.test(routing)) return false;
  const d = routing.split('').map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

function readBankNumber(b, key, fields, opts) {
  const v = b[key];
  if (v === undefined || v === null || v === '') { fields[key] = opts.message; return undefined; }
  if (typeof v !== 'string' || !/^[0-9]+$/.test(v)) { fields[key] = opts.message; return undefined; }
  if (v.length < opts.min || v.length > opts.max) { fields[key] = opts.message; return undefined; }
  return v;
}

route('GET', '/api/recipients', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const res = await query(
    "SELECT * FROM recipients WHERE company_id = $1 AND status != 'removed' ORDER BY created_at, id",
    [sess.company_id]
  );
  sendJson(ctx.res, 200, { recipients: res.rows.map(recipientOut) });
});

route('POST', '/api/recipients', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const b = ctx.body;
  const fields = {};
  const displayName = readRecipientName(b, fields);
  const kind = b.kind;
  if (kind !== 'person' && kind !== 'business') fields.kind = 'Choose a kind';
  const method = b.method;
  if (!['ach', 'wire', 'rtp', 'check'].includes(method)) fields.method = 'Choose a method';
  const accountNumber = readBankNumber(b, 'account_number', fields, { min: 4, max: 17, message: 'Enter 4 to 17 digits' });
  const routingNumber = readBankNumber(b, 'routing_number', fields, { min: 9, max: 9, message: 'Enter a valid 9-digit routing number' });
  if (routingNumber && !abaChecksumOk(routingNumber)) fields.routing_number = 'Enter a valid 9-digit routing number';
  if (Object.keys(fields).length) throw errValidation(fields);
  const at = now();
  const id = issueId('rcpt');
  const enc = Buffer.from(accountNumber, 'utf8');
  try {
    await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [sess.company_id]);
      const dup = await client.query(
        "SELECT id, display_name FROM recipients WHERE company_id = $1 AND status = 'active' AND routing_number = $2 AND account_number_enc = $3",
        [sess.company_id, routingNumber, enc]
      );
      if (dup.rowCount > 0) {
        throw new ApiError(409, 'duplicate_recipient', { recipient_id: dup.rows[0].id, display_name: dup.rows[0].display_name });
      }
      await client.query(
        'INSERT INTO recipients (id, company_id, display_name, kind, method, status, account_last4, routing_number, account_number_enc, email, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10)',
        [id, sess.company_id, displayName, kind, method, 'active', accountNumber.slice(-4), routingNumber, enc, new Date(at)]
      );
    });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // The unique index also answers duplicates when requests race.
    if (e && e.__db && String(e.message).includes('unique')) {
      const dup = await query(
        "SELECT id, display_name FROM recipients WHERE company_id = $1 AND status = 'active' AND routing_number = $2 AND account_number_enc = $3",
        [sess.company_id, routingNumber, enc]
      );
      if (dup.rowCount > 0) {
        throw new ApiError(409, 'duplicate_recipient', { recipient_id: dup.rows[0].id, display_name: dup.rows[0].display_name });
      }
    }
    throw e;
  }
  const saved = await query('SELECT * FROM recipients WHERE id = $1', [id]);
  sendJson(ctx.res, 201, recipientOut(saved.rows[0]));
});

function readRecipientName(b, fields) {
  const v = b.display_name;
  if (typeof v !== 'string') { fields.display_name = 'Enter a name of up to 120 characters'; return undefined; }
  const trimmed = v.trim();
  if (trimmed === '') { fields.display_name = 'Enter a name of up to 120 characters'; return ''; }
  const refusal = singleLineRefusal(trimmed);
  if (refusal) {
    fields.display_name = refusal === 'direction' ? 'Remove control or direction characters from this name' : 'Text contains invalid characters';
    return trimmed;
  }
  const n = codePoints(trimmed);
  if (n > 120) { fields.display_name = 'Enter a name of up to 120 characters'; return trimmed; }
  return trimmed;
}

route('POST', '/api/recipients/invite', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const fields = {};
  const email = readEmail(ctx.body, 'email', fields);
  if (Object.keys(fields).length) throw errValidation(fields);
  const at = now();
  const inviteId = issueId('invc');
  const rcptId = issueId('rcpt');
  try {
    await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [sess.company_id]);
      const dup = await client.query(
        "SELECT id FROM recipients WHERE company_id = $1 AND status = 'pending' AND lower(email) = $2",
        [sess.company_id, email]
      );
      if (dup.rowCount > 0) {
        throw new ApiError(409, 'duplicate_recipient', { recipient_id: dup.rows[0].id, display_name: email });
      }
      await client.query(
        "INSERT INTO recipients (id, company_id, display_name, kind, method, status, account_last4, routing_number, account_number_enc, email, created_at) VALUES ($1,$2,$3,NULL,NULL,'pending',NULL,NULL,NULL,$4,$5)",
        [rcptId, sess.company_id, email, email, new Date(at)]
      );
    });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e && e.__db && String(e.message).includes('unique')) {
      const dup = await query(
        "SELECT id FROM recipients WHERE company_id = $1 AND status = 'pending' AND lower(email) = $2",
        [sess.company_id, email]
      );
      if (dup.rowCount > 0) throw new ApiError(409, 'duplicate_recipient', { recipient_id: dup.rows[0].id, display_name: email });
    }
    throw e;
  }
  const saved = await query('SELECT * FROM recipients WHERE id = $1', [rcptId]);
  sendJson(ctx.res, 201, { invite_id: inviteId, recipient: recipientOut(saved.rows[0]) });
});

route('GET', '/api/recipients/:recipient_id', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const id = ctx.params.recipient_id;
  if (!isWellFormedId(id)) throw errNotFound();
  const res = await query(
    "SELECT * FROM recipients WHERE id = $1 AND company_id = $2 AND status != 'removed'",
    [id, sess.company_id]
  );
  if (res.rowCount === 0) throw errNotFound();
  sendJson(ctx.res, 200, recipientOut(res.rows[0]));
});

route('DELETE', '/api/recipients/:recipient_id', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const id = ctx.params.recipient_id;
  if (!isWellFormedId(id)) throw errNotFound();
  if (!isOwnerOrAdmin(sess)) throw errForbidden();
  const at = now();
  const result = await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [sess.company_id]);
    const found = await client.query(
      "SELECT * FROM recipients WHERE id = $1 AND company_id = $2 AND status != 'removed'",
      [id, sess.company_id]
    );
    if (found.rowCount === 0) throw errNotFound();
    // Expire held payments whose expiry has passed, inside this transaction.
    await expireDueForRecipient(client, sess.company_id, id, at);
    const pending = await client.query(
      "SELECT 1 FROM payments WHERE recipient_id = $1 AND company_id = $2 AND status = 'pending_approval'",
      [id, sess.company_id]
    );
    if (pending.rowCount > 0) {
      throw new ApiError(409, 'recipient_has_pending_payments');
    }
    await client.query("UPDATE recipients SET status = 'removed' WHERE id = $1", [id]);
    // Cancel scheduled payments of this recipient.
    const scheduled = await client.query(
      "SELECT * FROM payments WHERE recipient_id = $1 AND company_id = $2 AND status = 'scheduled' FOR UPDATE",
      [id, sess.company_id]
    );
    for (const p of scheduled.rows) {
      await client.query("UPDATE payments SET status = 'cancelled' WHERE id = $1", [p.id]);
      await writeAudit(client, sess.company_id, 'payment.cancelled', p.id, Number(p.amount_cents), sess.email, at);
    }
    return true;
  });
  if (result) {
    ctx.res.writeHead(204, { 'Cache-Control': 'no-store' });
    ctx.res.end();
  }
});

async function expireDueForRecipient(client, companyId, recipientId, atMs) {
  const due = await client.query(
    "SELECT * FROM payments WHERE company_id = $1 AND recipient_id = $2 AND status = 'pending_approval' AND expires_at <= $3 FOR UPDATE",
    [companyId, recipientId, new Date(atMs)]
  );
  for (const p of due.rows) {
    await client.query("UPDATE payments SET status = 'expired' WHERE id = $1", [p.id]);
    await writeAudit(client, companyId, 'payment.expired', p.id, Number(p.amount_cents), SYSTEM_ACTOR, atMs);
  }
}

// ---------- payments ----------

const PAYMENT_METHODS = ['ach', 'wire', 'rtp', 'check'];

route('POST', '/api/payments', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const b = ctx.body;
  const fields = {};
  if (b.source_account_id === undefined || b.source_account_id === null || b.source_account_id === '') {
    fields.source_account_id = 'Choose a source account';
  }
  if (b.recipient_id === undefined || b.recipient_id === null || b.recipient_id === '') {
    fields.recipient_id = 'Choose a recipient';
  }
  const method = b.method;
  if (!PAYMENT_METHODS.includes(method)) fields.method = 'Choose a method';
  const amountCents = readAmount(b, 'amount_cents', fields);
  const memo = readMemo(b, 'memo', fields);
  const todayNy = nyDateStr(now());
  let scheduledFor = null;
  if (b.scheduled_for !== undefined && b.scheduled_for !== null && b.scheduled_for !== '') {
    if (typeof b.scheduled_for !== 'string' || !dateFromStr(b.scheduled_for)) {
      fields.scheduled_for = 'Choose a valid date';
    } else if (b.scheduled_for <= todayNy) {
      fields.scheduled_for = 'Choose a date after today';
    } else {
      scheduledFor = b.scheduled_for;
      if (amountCents !== undefined && amountCents > APPROVAL_THRESHOLD_CENTS) {
        fields.amount_cents = 'Scheduled payments can be at most $5,000.00';
      }
    }
  }
  let fxQuoteId = null;
  if (b.fx_quote_id !== undefined && b.fx_quote_id !== null && b.fx_quote_id !== '') {
    fxQuoteId = b.fx_quote_id;
    if (method !== 'wire') fields.fx_quote_id = 'Quotes are for wires only';
  }
  if (Object.keys(fields).length) throw errValidation(fields);

  const at = now();
  const result = await runIdempotentWrite(ctx, sess, 'POST /api/payments', b, async (client) => {
    const account = await accountWithAvailable(client, sess.company_id, b.source_account_id);
    if (!account) throw errNotFound();
    // The recipient lock serialises removal and send.
    if (!isWellFormedId(b.recipient_id)) throw errNotFound();
    const recipientRes = await client.query(
      "SELECT * FROM recipients WHERE id = $1 AND company_id = $2 AND status != 'removed' FOR UPDATE",
      [b.recipient_id, sess.company_id]
    );
    if (recipientRes.rowCount === 0) throw errNotFound();
    const recipient = recipientRes.rows[0];
    if (recipient.status === 'pending') throw errValidation({ recipient_id: 'This recipient has not accepted yet' });

    let quote = null;
    if (fxQuoteId) {
      if (!isWellFormedId(fxQuoteId)) throw errNotFound();
      const qRes = await client.query(
        'SELECT * FROM fx_quotes WHERE id = $1 AND company_id = $2 FOR UPDATE',
        [fxQuoteId, sess.company_id]
      );
      if (qRes.rowCount === 0) throw errNotFound();
      quote = qRes.rows[0];
      if (quote.amount_cents !== amountCents) {
        throw errValidation({ fx_quote_id: 'The quote is for a different amount' });
      }
      if (new Date(quote.expires_at).getTime() <= at) {
        throw new ApiError(409, 'quote_expired');
      }
    }

    const totalDebit = quote ? Number(quote.total_debit_cents) : amountCents;
    const required = scheduledFor ? 0 : approvalsRequiredFor(amountCents);
    const paymentId = issueId('paym');

    if (scheduledFor) {
      const effective = effectiveDateForSchedule(method, scheduledFor);
      await client.query(
        `INSERT INTO payments (id, company_id, source_account_id, recipient_id, recipient_name, method, amount_cents, memo, status, scheduled_for, effective_date, expires_at, approve_by, fx_quote_id, total_debit_cents, approvals_required, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled',$9,$10,NULL,NULL,$11,$12,0,$13,$14)`,
        [paymentId, sess.company_id, account.id, recipient.id, recipient.display_name, method, amountCents, memo, scheduledFor, effective, fxQuoteId, totalDebit, sess.id, new Date(at)]
      );
      await writeAudit(client, sess.company_id, 'payment.created', paymentId, amountCents, sess.email, at);
      if (quote) await client.query('UPDATE fx_quotes SET used_by_payment_id = $1 WHERE id = $2', [paymentId, quote.id]);
      return { status: 201, body: { __internalPaymentId: paymentId, __status: 'scheduled', __txId: null, __companyId: sess.company_id } };
    }

    if (required > 0) {
      const expiry = approvalExpiry(at);
      if (account.available_cents < totalDebit) throw new ApiError(400, 'insufficient_funds');
      await client.query(
        `INSERT INTO payments (id, company_id, source_account_id, recipient_id, recipient_name, method, amount_cents, memo, status, scheduled_for, effective_date, expires_at, approve_by, fx_quote_id, total_debit_cents, approvals_required, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending_approval',NULL,NULL,$9,$10,$11,$12,$13,$14,$15)`,
        [paymentId, sess.company_id, account.id, recipient.id, recipient.display_name, method, amountCents, memo, expiry.expires_at, expiry.approve_by, fxQuoteId, totalDebit, required, sess.id, new Date(at)]
      );
      await writeAudit(client, sess.company_id, 'payment.created', paymentId, amountCents, sess.email, at);
      if (quote) await client.query('UPDATE fx_quotes SET used_by_payment_id = $1 WHERE id = $2', [paymentId, quote.id]);
      return { status: 201, body: { __internalPaymentId: paymentId, __status: 'pending_approval', __txId: null, __companyId: sess.company_id } };
    }

    if (account.available_cents < totalDebit) throw new ApiError(400, 'insufficient_funds');
    const effective = effectiveDateForPost(method, at);
    await client.query(
      `INSERT INTO payments (id, company_id, source_account_id, recipient_id, recipient_name, method, amount_cents, memo, status, scheduled_for, effective_date, expires_at, approve_by, fx_quote_id, total_debit_cents, approvals_required, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'posted',NULL,$9,NULL,NULL,$10,$11,0,$12,$13)`,
      [paymentId, sess.company_id, account.id, recipient.id, recipient.display_name, method, amountCents, memo, effective, fxQuoteId, totalDebit, sess.id, new Date(at)]
    );
    await writeAudit(client, sess.company_id, 'payment.created', paymentId, amountCents, sess.email, at);
    const txId = issueId('txn');
    await applyDebit(client, account.id, totalDebit, recipient.display_name, method, memo, null, at, txId);
    await writeAudit(client, sess.company_id, 'payment.posted', paymentId, totalDebit, sess.email, at);
    if (quote) await client.query('UPDATE fx_quotes SET used_by_payment_id = $1 WHERE id = $2', [paymentId, quote.id]);
    return { status: 201, body: { __internalPaymentId: paymentId, __status: 'posted', __txId: txId, __companyId: sess.company_id } };
  });

  if (result.replay) {
    ctx.res.writeHead(result.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    ctx.res.end(result.bodyText);
    return;
  }
  const created = result.body;
  if (created.__txId) {
    const txRow = await query('SELECT * FROM transactions WHERE id = $1', [created.__txId]);
    if (txRow.rowCount > 0) emitTransaction(created.__companyId, transactionOut(txRow.rows[0]));
  }
  const payment = await query('SELECT * FROM payments WHERE id = $1', [created.__internalPaymentId]);
  const approvals = await approvalsForPaymentFromPool(query, created.__internalPaymentId);
  sendJson(ctx.res, 201, paymentOut(payment.rows[0], approvals));
});

route('GET', '/api/payments', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const res = await query(
    'SELECT * FROM payments WHERE company_id = $1 ORDER BY created_at DESC, id DESC',
    [sess.company_id]
  );
  const out = [];
  for (const row of res.rows) {
    const approvals = await approvalsForPaymentFromPool(query, row.id);
    out.push(paymentOut(row, approvals));
  }
  sendJson(ctx.res, 200, { payments: out });
});

route('GET', '/api/payments/:payment_id', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const payment = await loadPaymentFromPool(query, sess.company_id, ctx.params.payment_id);
  if (!payment) throw errNotFound();
  const approvals = await approvalsForPaymentFromPool(query, payment.id);
  sendJson(ctx.res, 200, paymentOut(payment, approvals));
});

route('POST', '/api/payments/:payment_id/cancel', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const id = ctx.params.payment_id;
  if (!isWellFormedId(id)) throw errNotFound();
  const at = now();
  const updated = await withTransaction(async (client) => {
    const payment = await loadPayment(client, sess.company_id, id);
    if (!payment) throw errNotFound();
    const mayCancel = sess.role === 'owner' || sess.role === 'admin' || payment.created_by === sess.id;
    if (!mayCancel) throw errForbidden();
    if (payment.status !== 'scheduled') throw new ApiError(409, 'payment_not_scheduled');
    await client.query("UPDATE payments SET status = 'cancelled' WHERE id = $1", [payment.id]);
    await writeAudit(client, sess.company_id, 'payment.cancelled', payment.id, Number(payment.amount_cents), sess.email, at);
    return payment.id;
  });
  const payment = await query('SELECT * FROM payments WHERE id = $1', [updated]);
  sendJson(ctx.res, 200, paymentOut(payment.rows[0], []));
});

route('GET', '/api/approvals', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const res = await query(
    "SELECT p.*, u.name AS creator_name, a.name AS source_account_name FROM payments p JOIN users u ON u.id = p.created_by JOIN accounts a ON a.id = p.source_account_id WHERE p.company_id = $1 AND p.status = 'pending_approval' ORDER BY p.created_at ASC, p.id ASC",
    [sess.company_id]
  );
  const out = [];
  for (const row of res.rows) {
    const approvals = await approvalsForPaymentFromPool(query, row.id);
    out.push({ ...paymentOut(row, approvals), creator_name: row.creator_name, source_account_name: row.source_account_name });
  }
  sendJson(ctx.res, 200, { approvals: out });
});

route('POST', '/api/payments/:payment_id/approve', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const id = ctx.params.payment_id;
  if (!isWellFormedId(id)) throw errNotFound();
  const at = now();
  const result = await withTransaction(async (client) => {
    const payment = await loadPayment(client, sess.company_id, id);
    if (!payment) throw errNotFound();
    const eligible = (sess.role === 'owner' || sess.role === 'admin') && payment.created_by !== sess.id;
    if (!eligible) throw errForbidden();
    // A decision at or after expires_at answers payment_not_pending, and if
    // the expiry has not been processed yet this transaction records it.
    if (payment.status === 'pending_approval' && payment.expires_at && new Date(payment.expires_at).getTime() <= at) {
      await client.query("UPDATE payments SET status = 'expired' WHERE id = $1", [payment.id]);
      await writeAudit(client, sess.company_id, 'payment.expired', payment.id, Number(payment.amount_cents), SYSTEM_ACTOR, at);
      throw new ApiError(409, 'payment_not_pending');
    }
    if (payment.status !== 'pending_approval') throw new ApiError(409, 'payment_not_pending');
    const already = await client.query('SELECT 1 FROM payment_approvals WHERE payment_id = $1 AND user_id = $2', [payment.id, sess.id]);
    if (already.rowCount > 0) throw new ApiError(409, 'already_approved');
    const current = await client.query('SELECT COUNT(*) AS n FROM payment_approvals WHERE payment_id = $1', [payment.id]);
    const given = Number(current.rows[0].n);
    await client.query('INSERT INTO payment_approvals (payment_id, user_id, at) VALUES ($1,$2,$3)', [payment.id, sess.id, new Date(at)]);
    await writeAudit(client, sess.company_id, 'payment.approved', payment.id, Number(payment.amount_cents), sess.email, at);
    if (given + 1 >= payment.approvals_required) {
      const account = await client.query('SELECT * FROM accounts WHERE id = $1 FOR UPDATE', [payment.source_account_id]);
      const effective = effectiveDateForPost(payment.method, at);
      await client.query("UPDATE payments SET status = 'posted', effective_date = $2 WHERE id = $1", [payment.id, effective]);
      const txId = issueId('txn');
      await applyDebit(client, payment.source_account_id, Number(payment.total_debit_cents), payment.recipient_name, payment.method, payment.memo, null, at, txId);
      await writeAudit(client, sess.company_id, 'payment.posted', payment.id, Number(payment.total_debit_cents), sess.email, at);
      return { posted: true, txId, accountId: payment.source_account_id, companyId: sess.company_id };
    }
    return { posted: false };
  });
  if (result.posted && result.txId) {
    const txRow = await query('SELECT * FROM transactions WHERE id = $1', [result.txId]);
    if (txRow.rowCount > 0) emitTransaction(result.companyId, transactionOut(txRow.rows[0]));
  }
  const payment = await query('SELECT * FROM payments WHERE id = $1', [id]);
  const approvals = await approvalsForPaymentFromPool(query, id);
  sendJson(ctx.res, 200, paymentOut(payment.rows[0], approvals));
});

route('POST', '/api/payments/:payment_id/reject', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const id = ctx.params.payment_id;
  if (!isWellFormedId(id)) throw errNotFound();
  const at = now();
  await withTransaction(async (client) => {
    const payment = await loadPayment(client, sess.company_id, id);
    if (!payment) throw errNotFound();
    const eligible = sess.role === 'owner' || sess.role === 'admin';
    if (!eligible) throw errForbidden();
    if (payment.status === 'pending_approval' && payment.expires_at && new Date(payment.expires_at).getTime() <= at) {
      await client.query("UPDATE payments SET status = 'expired' WHERE id = $1", [payment.id]);
      await writeAudit(client, sess.company_id, 'payment.expired', payment.id, Number(payment.amount_cents), SYSTEM_ACTOR, at);
      throw new ApiError(409, 'payment_not_pending');
    }
    if (payment.status !== 'pending_approval') throw new ApiError(409, 'payment_not_pending');
    await client.query("UPDATE payments SET status = 'rejected' WHERE id = $1", [payment.id]);
    await writeAudit(client, sess.company_id, 'payment.rejected', payment.id, Number(payment.amount_cents), sess.email, at);
  });
  const payment = await query('SELECT * FROM payments WHERE id = $1', [id]);
  const approvals = await approvalsForPaymentFromPool(query, id);
  sendJson(ctx.res, 200, paymentOut(payment.rows[0], approvals));
});

// ---------- fx quotes ----------

route('POST', '/api/fx/quotes', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const b = ctx.body;
  const fields = {};
  const currency = b.currency;
  if (typeof currency !== 'string' || !FX_RATES[currency]) fields.currency = 'Choose EUR, GBP or CAD';
  const amountCents = readAmount(b, 'amount_cents', fields);
  if (Object.keys(fields).length) throw errValidation(fields);
  const rate = FX_RATES[currency];
  // foreign_amount_minor = amount_cents * rate, rounded half up, via exact
  // integer arithmetic on the four-decimal rate.
  const rateUnits = Number(rate.replace('.', '')); // e.g. 9200 for 0.9200
  const foreignMinor = roundHalfUp(amountCents * rateUnits, 10000);
  const feeCents = roundHalfUp(amountCents, 100);
  const totalDebit = amountCents + feeCents;
  const at = now();
  const expiresAt = at + FX_QUOTE_TTL_SECONDS * 1000;
  const id = issueId('fxq_');
  await query(
    'INSERT INTO fx_quotes (id, company_id, currency, amount_cents, rate, foreign_amount_minor, fee_cents, total_debit_cents, expires_at, used_by_payment_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10)',
    [id, sess.company_id, currency, amountCents, rate, foreignMinor, feeCents, totalDebit, new Date(expiresAt), new Date(at)]
  );
  sendJson(ctx.res, 201, {
    id, currency, amount_cents: amountCents, rate,
    foreign_amount_minor: foreignMinor, fee_cents: feeCents,
    total_debit_cents: totalDebit, expires_at: isoAt(expiresAt),
  });
});

// ---------- invoices ----------

route('GET', '/api/invoices', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const res = await query(
    'SELECT * FROM invoices WHERE company_id = $1 ORDER BY created_at, id',
    [sess.company_id]
  );
  sendJson(ctx.res, 200, {
    invoices: res.rows.map((r) => ({
      id: r.id, number: r.number, customer_name: r.customer_name,
      total_cents: Number(r.total_cents), status: r.status,
      paid_into_account_id: r.paid_into_account_id,
    })),
  });
});

route('POST', '/api/invoices/:invoice_id/send', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const id = ctx.params.invoice_id;
  if (!isWellFormedId(id)) throw errNotFound();
  if (!isOwnerOrAdmin(sess)) throw errForbidden();
  const at = now();
  await withTransaction(async (client) => {
    const res = await client.query('SELECT * FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE', [id, sess.company_id]);
    if (res.rowCount === 0) throw errNotFound();
    if (res.rows[0].status !== 'draft') throw new ApiError(409, 'invoice_not_draft');
    await client.query("UPDATE invoices SET status = 'sent' WHERE id = $1", [id]);
  });
  const invoice = await query('SELECT * FROM invoices WHERE id = $1', [id]);
  const r = invoice.rows[0];
  sendJson(ctx.res, 200, {
    id: r.id, number: r.number, customer_name: r.customer_name,
    total_cents: Number(r.total_cents), status: r.status,
    paid_into_account_id: r.paid_into_account_id,
  });
});

route('POST', '/api/invoices/:invoice_id/mark-paid', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const id = ctx.params.invoice_id;
  if (!isWellFormedId(id)) throw errNotFound();
  if (!isOwnerOrAdmin(sess)) throw errForbidden();
  const accountId = ctx.body.account_id;
  if (typeof accountId !== 'string' || accountId === '') throw errValidation({ account_id: 'Choose an account' });
  const at = now();
  const result = await withTransaction(async (client) => {
    const inv = await client.query('SELECT * FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE', [id, sess.company_id]);
    if (inv.rowCount === 0) throw errNotFound();
    const invoice = inv.rows[0];
    const account = await client.query('SELECT * FROM accounts WHERE id = $1 AND company_id = $2 FOR UPDATE', [accountId, sess.company_id]);
    if (account.rowCount === 0) throw errNotFound();
    if (invoice.status === 'draft') throw new ApiError(409, 'invoice_not_sent');
    if (invoice.status === 'paid') throw new ApiError(409, 'invoice_already_paid');
    const txId = issueId('txn');
    await applyCredit(client, accountId, Number(invoice.total_cents), invoice.customer_name, 'ach', null, null, at, txId);
    await client.query("UPDATE invoices SET status = 'paid', paid_into_account_id = $2 WHERE id = $1", [id, accountId]);
    await writeAudit(client, sess.company_id, 'invoice.paid', null, Number(invoice.total_cents), sess.email, at);
    return { txId, companyId: sess.company_id };
  });
  if (result && result.txId) {
    const txRow = await query('SELECT * FROM transactions WHERE id = $1', [result.txId]);
    if (txRow.rowCount > 0) emitTransaction(result.companyId, transactionOut(txRow.rows[0]));
  }
  const invoice = await query('SELECT * FROM invoices WHERE id = $1', [id]);
  const r = invoice.rows[0];
  sendJson(ctx.res, 200, {
    id: r.id, number: r.number, customer_name: r.customer_name,
    total_cents: Number(r.total_cents), status: r.status,
    paid_into_account_id: r.paid_into_account_id,
  });
});

// ---------- loans ----------

route('GET', '/api/loans', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const res = await query('SELECT * FROM loans WHERE company_id = $1 ORDER BY created_at, id', [sess.company_id]);
  sendJson(ctx.res, 200, {
    loans: res.rows.map((r) => ({
      id: r.id, name: r.name, principal_cents: Number(r.principal_cents),
      drawn_cents: Number(r.drawn_cents),
      remaining_cents: Number(r.principal_cents) - Number(r.drawn_cents),
      funding_account_id: r.funding_account_id,
    })),
  });
});

route('POST', '/api/loans/:loan_id/draw', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const id = ctx.params.loan_id;
  if (!isWellFormedId(id)) throw errNotFound();
  if (sess.role !== 'owner') throw errForbidden();
  const fields = {};
  const amountCents = readAmount(ctx.body, 'amount_cents', fields);
  if (Object.keys(fields).length) throw errValidation(fields);
  const at = now();
  const result = await runIdempotentWrite(ctx, sess, `POST /api/loans/${id}/draw`, ctx.body, async (client) => {
    const loanRes = await client.query('SELECT * FROM loans WHERE id = $1 AND company_id = $2 FOR UPDATE', [id, sess.company_id]);
    if (loanRes.rowCount === 0) throw errNotFound();
    const loan = loanRes.rows[0];
    const remaining = Number(loan.principal_cents) - Number(loan.drawn_cents);
    if (amountCents > remaining) throw new ApiError(400, 'exceeds_available_credit');
    await client.query('UPDATE loans SET drawn_cents = drawn_cents + $1 WHERE id = $2', [amountCents, loan.id]);
    const txId = issueId('txn');
    await applyCredit(client, loan.funding_account_id, amountCents, loan.name, 'wire', null, null, at, txId);
    await writeAudit(client, sess.company_id, 'loan.drawn', null, amountCents, sess.email, at);
    return {
      status: 200,
      body: {
        id: loan.id, name: loan.name,
        principal_cents: Number(loan.principal_cents),
        drawn_cents: Number(loan.drawn_cents) + amountCents,
        remaining_cents: remaining - amountCents,
        funding_account_id: loan.funding_account_id,
      },
    };
  });
  if (result.replay) {
    ctx.res.writeHead(result.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    ctx.res.end(result.bodyText);
    return;
  }
  const body = result.body;
  const txRow = await query("SELECT * FROM transactions WHERE account_id = $1 AND counterparty = $2 AND amount_cents = $3 ORDER BY created_at DESC LIMIT 1", [body.funding_account_id, body.name, ctx.body.amount_cents]);
  if (txRow.rowCount > 0 && body.drawn_cents > 0) {
    emitTransaction(sess.company_id, transactionOut(txRow.rows[0]));
  }
  sendJson(ctx.res, 200, body);
});

// ---------- transfers ----------

route('POST', '/api/transfers', async (ctx) => {
  const sess = await requireSession(ctx.req);
  const b = ctx.body;
  const fields = {};
  if (typeof b.from_account_id !== 'string' || b.from_account_id === '') fields.from_account_id = 'Choose a source account';
  if (typeof b.to_account_id !== 'string' || b.to_account_id === '') fields.to_account_id = 'Choose a destination account';
  const amountCents = readAmount(b, 'amount_cents', fields);
  const memo = readMemo(b, 'memo', fields);
  if (Object.keys(fields).length) throw errValidation(fields);
  const at = now();
  const result = await runIdempotentWrite(ctx, sess, 'POST /api/transfers', b, async (client) => {
    if (!isWellFormedId(b.from_account_id)) throw errNotFound();
    if (!isWellFormedId(b.to_account_id)) throw errNotFound();
    // Lock both accounts in id order to avoid deadlocks between opposite transfers.
    const lockIds = [b.from_account_id, b.to_account_id].sort();
    for (const lockId of lockIds) {
      const r = await client.query('SELECT id FROM accounts WHERE id = $1 AND company_id = $2 FOR UPDATE', [lockId, sess.company_id]);
      if (r.rowCount === 0) throw errNotFound();
    }
    if (b.from_account_id === b.to_account_id) throw errValidation({ to_account_id: 'Choose a different account' });
    const source = await accountWithAvailable(client, sess.company_id, b.from_account_id);
    const destRes = await client.query('SELECT * FROM accounts WHERE id = $1 AND company_id = $2', [b.to_account_id, sess.company_id]);
    if (!source || destRes.rowCount === 0) throw errNotFound();
    if (source.available_cents < amountCents) throw new ApiError(400, 'insufficient_funds');
    const transferId = issueId('xfer');
    const dest = destRes.rows[0];
    await applyDebit(client, source.id, amountCents, dest.name, 'transfer', memo, transferId, at, issueId('txn'));
    await applyCredit(client, dest.id, amountCents, source.name, 'transfer', memo, transferId, at, issueId('txn'));
    await writeAudit(client, sess.company_id, 'transfer.posted', null, amountCents, sess.email, at);
    return {
      status: 201,
      body: {
        id: transferId, from_account_id: source.id, to_account_id: dest.id,
        amount_cents: amountCents, memo: memo ?? null,
      },
    };
  });
  if (result.replay) {
    ctx.res.writeHead(result.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    ctx.res.end(result.bodyText);
    return;
  }
  const txRows = await query('SELECT * FROM transactions WHERE transfer_id = $1', [result.body.id]);
  for (const row of txRows.rows) emitTransaction(sess.company_id, transactionOut(row));
  sendJson(ctx.res, 201, result.body);
});

// ---------- audit ----------

route('GET', '/api/audit', async (ctx) => {
  const sess = await requireSession(ctx.req);
  if (!isOwnerOrAdmin(sess)) throw errForbidden();
  const res = await query(
    'SELECT * FROM audit_events WHERE company_id = $1 ORDER BY seq ASC',
    [sess.company_id]
  );
  sendJson(ctx.res, 200, {
    events: res.rows.map((r) => ({
      seq: Number(r.seq), action: r.action, payment_id: r.payment_id,
      amount_cents: Number(r.amount_cents), actor_email: r.actor_email,
      prev_hash: r.prev_hash, hash: r.hash, created_at: isoAt(new Date(r.created_at).getTime()),
    })),
  });
});

// ---------- plans ----------

route('GET', '/api/plans', async (ctx) => {
  const res = await query('SELECT * FROM plans ORDER BY monthly_cents ASC');
  sendJson(ctx.res, 200, {
    plans: res.rows.map((r) => ({
      id: r.id, name: r.name, monthly_cents: Number(r.monthly_cents),
      annual_cents: Number(r.annual_cents), features: r.features,
    })),
  });
});

// ---------- inquiries ----------

route('POST', '/api/inquiries', async (ctx) => {
  const b = ctx.body;
  // The honeypot check comes before validation and rate counting.
  const website = b.website;
  const honeypotFilled = !(website === undefined || website === null || (typeof website === 'string' && website.trim() === ''));
  const fields = {};
  const email = readInquiryEmail(b, fields);
  const firstName = readInquiryText(b, 'first_name', fields, 120);
  const lastName = readInquiryText(b, 'last_name', fields, 120);
  const company = readInquiryText(b, 'company', fields, 120);
  const message = readInquiryMessage(b, fields);
  const source = b.source;
  if (source !== 'contact' && source !== 'sales') fields.source = 'Choose a source';
  if (honeypotFilled) {
    const id = issueId('inqy');
    sendJson(ctx.res, 201, { id, created_at: nowIso() });
    return;
  }
  if (Object.keys(fields).length) throw errValidation(fields);
  const at = now();
  const windowStart = at - INQUIRY_RATE_WINDOW_SECONDS * 1000;
  const stored = await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [email]);
    const recent = await client.query(
      'SELECT COUNT(*) AS n FROM inquiries WHERE email = $1 AND created_at >= $2',
      [email, new Date(windowStart)]
    );
    if (Number(recent.rows[0].n) >= INQUIRY_MAX_IN_WINDOW) {
      throw new ApiError(429, 'rate_limited');
    }
    const id = issueId('inqy');
    await client.query(
      'INSERT INTO inquiries (id, email, first_name, last_name, company, message, source, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, email, firstName, lastName, company, message, source, new Date(at)]
    );
    return id;
  });
  sendJson(ctx.res, 201, { id: stored, created_at: isoAt(at) });
});

function readInquiryEmail(b, fields) {
  const v = b.email;
  if (typeof v !== 'string') { fields.email = 'Enter a valid email'; return undefined; }
  const trimmed = v.trim().toLowerCase();
  if (trimmed === '') { fields.email = 'Enter a valid email'; return ''; }
  const refusal = baseStringRefusal(trimmed);
  if (refusal) { fields.email = 'Enter a valid email'; return trimmed; }
  if (singleLineRefusal(trimmed)) { fields.email = 'Enter a valid email'; return trimmed; }
  if (codePoints(trimmed) > 254) { fields.email = 'Enter a valid email'; return trimmed; }
  const at = trimmed.indexOf('@');
  if (at <= 0 || at !== trimmed.lastIndexOf('@')) { fields.email = 'Enter a valid email'; return trimmed; }
  const domain = trimmed.slice(at + 1);
  if (!domain.includes('.') || domain.includes(' ')) { fields.email = 'Enter a valid email'; return trimmed; }
  return trimmed;
}

function readInquiryText(b, key, fields, max) {
  const v = b[key];
  if (typeof v !== 'string') { fields[key] = `Enter your ${key.replace('_', ' ')}`; return undefined; }
  const trimmed = v.trim();
  if (trimmed === '') { fields[key] = `Enter your ${key.replace('_', ' ')}`; return ''; }
  if (baseStringRefusal(trimmed) || singleLineRefusal(trimmed)) {
    fields[key] = 'Remove control or direction characters';
    return trimmed;
  }
  const normalised = normalizeNfc(trimmed);
  const n = codePoints(normalised);
  if (n > max) { fields[key] = max === 5000 ? 'Keep your message to 5,000 characters or fewer' : 'Keep this to 120 characters or fewer'; return normalised; }
  return normalised;
}

function readInquiryMessage(b, fields) {
  const v = b.message;
  if (typeof v !== 'string') { fields.message = 'Enter a message'; return undefined; }
  const trimmed = v.trim();
  if (trimmed === '') { fields.message = 'Enter a message'; return ''; }
  if (baseStringRefusal(trimmed)) { fields.message = 'Remove control characters'; return trimmed; }
  const normalised = normalizeNfc(trimmed);
  const n = codePoints(normalised);
  if (n > 5000) { fields.message = 'Keep your message to 5,000 characters or fewer'; return normalised; }
  return normalised;
}






