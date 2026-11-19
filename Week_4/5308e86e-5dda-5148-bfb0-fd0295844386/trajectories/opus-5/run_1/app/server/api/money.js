'use strict';

const db = require('../lib/db');
const clock = require('../lib/clock');
const nytime = require('../lib/nytime');
const errors = require('../lib/errors');
const validate = require('../lib/validate');
const domain = require('../lib/domain');
const snapshot = require('../lib/snapshot');
const money = require('../lib/money');
const csv = require('../lib/csv');
const streamService = require('../lib/stream');

const TRANSACTION_METHODS = ['ach', 'wire', 'rtp', 'check', 'card', 'transfer'];
const DIRECTIONS = ['credit', 'debit'];
const DEFAULT_LIMIT = 50;
const SEARCH_MIN = 2;
const SEARCH_MAX = 100;
const SEARCH_CAP = 20;

async function listAccounts(ctx) {
  const accounts = await db.readSnapshot((client) => domain.listAccounts(client, ctx.companyId));
  return { status: 200, body: { accounts: accounts.map(domain.serializeAccount) } };
}

async function createAccount(ctx) {
  if (ctx.role !== 'owner' && ctx.role !== 'admin') throw errors.forbidden();
  const body = ctx.json();
  const fields = new validate.FieldErrors();
  const name = validate.readSingleLine(body.name);
  if (!name.ok || name.value.length === 0 || validate.codePointLength(name.value) > 60) {
    fields.add('name', 'Enter a name of up to 60 characters');
  }
  if (!['checking', 'savings', 'treasury'].includes(body.kind)) {
    fields.add('kind', 'Choose checking, savings or treasury');
  }
  if (fields.any) throw errors.validation(fields.fields);

  return db.transaction(async (client) => {
    await db.lockCompany(client, ctx.companyId);
    const position = await client.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM accounts WHERE company_id = $1',
      [ctx.companyId]
    );
    const id = db.newId();
    await client.query(
      `INSERT INTO accounts (id, company_id, name, kind, balance_cents, position, created_at)
       VALUES ($1, $2, $3, $4, 0, $5, $6)`,
      [id, ctx.companyId, name.value, body.kind, Number(position.rows[0].next), clock.now()]
    );
    const created = await domain.getAccount(client, ctx.companyId, id);
    return { status: 201, body: domain.serializeAccount(created) };
  });
}

async function getAccount(ctx) {
  const accountId = ctx.params.account_id;
  return db.readSnapshot(async (client) => {
    const account = await domain.getAccount(client, ctx.companyId, accountId);
    const recent = await client.query(
      `SELECT * FROM transactions WHERE account_id = $1
        ORDER BY created_at DESC, id DESC LIMIT 10`,
      [accountId]
    );
    return {
      status: 200,
      body: {
        account: domain.serializeAccount(account),
        recent_transactions: recent.rows.map(domain.serializeTransaction),
      },
    };
  });
}

async function getSnapshot(ctx) {
  const result = await snapshot.companySnapshot(ctx.companyId);
  return { status: 200, body: result };
}

function filterKey(filters) {
  return [filters.accountId || '', filters.method || '', filters.direction || ''].join('|');
}

function encodeCursor(position, filters) {
  const payload = JSON.stringify({
    c: position.createdAtMs,
    i: position.id,
    f: filterKey(filters),
  });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

function decodeCursor(raw, filters) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch (error) {
    throw errors.validation({ cursor: 'Unreadable cursor' });
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof parsed.c !== 'number' ||
    typeof parsed.i !== 'string' ||
    parsed.f !== filterKey(filters)
  ) {
    throw errors.validation({ cursor: 'Unreadable cursor' });
  }
  return { createdAtMs: parsed.c, id: parsed.i };
}

async function listTransactions(ctx) {
  const fields = new validate.FieldErrors();
  const query = ctx.query;

  const accountIdRaw = query.get('account_id');
  const methodRaw = query.get('method');
  const directionRaw = query.get('direction');
  const limitRaw = query.get('limit');

  if (methodRaw !== null && !TRANSACTION_METHODS.includes(methodRaw)) {
    fields.add('method', 'Unknown method');
  }
  if (directionRaw !== null && !DIRECTIONS.includes(directionRaw)) {
    fields.add('direction', 'Unknown direction');
  }
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== null) {
    if (!/^[0-9]+$/.test(limitRaw)) fields.add('limit', 'Enter a limit of 1 to 100');
    else {
      limit = Number(limitRaw);
      if (limit < 1 || limit > 100) fields.add('limit', 'Enter a limit of 1 to 100');
    }
  }

  // A foreign or malformed account_id is unknown, like any other unknown id.
  if (accountIdRaw !== null) await domain.getAccount(null, ctx.companyId, accountIdRaw);
  if (fields.any) throw errors.validation(fields.fields);

  const filters = { accountId: accountIdRaw, method: methodRaw, direction: directionRaw };
  const cursorRaw = query.get('cursor');
  const cursor = cursorRaw === null ? null : decodeCursor(cursorRaw, filters);

  const clauses = ['company_id = $1'];
  const params = [ctx.companyId];
  if (filters.accountId) {
    params.push(filters.accountId);
    clauses.push(`account_id = $${params.length}`);
  }
  if (filters.method) {
    params.push(filters.method);
    clauses.push(`method = $${params.length}`);
  }
  if (filters.direction) {
    params.push(filters.direction);
    clauses.push(`direction = $${params.length}`);
  }
  if (cursor) {
    params.push(new Date(cursor.createdAtMs), cursor.id);
    clauses.push(`(created_at, id) < ($${params.length - 1}, $${params.length})`);
  }
  params.push(limit + 1);

  const result = await db.query(
    `SELECT * FROM transactions WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
    params
  );
  const rows = result.rows.slice(0, limit);
  const hasMore = result.rows.length > limit;
  const last = rows[rows.length - 1];
  return {
    status: 200,
    body: {
      transactions: rows.map(domain.serializeTransaction),
      next_cursor: hasMore
        ? encodeCursor({ createdAtMs: new Date(last.created_at).getTime(), id: last.id }, filters)
        : null,
    },
  };
}

// Search matches its query as literal, case-insensitive text, so %, _, \ and *
// match only themselves.
async function search(ctx) {
  const raw = ctx.query.get('q');
  if (typeof raw !== 'string') throw errors.validation({ q: 'Enter 2 to 100 characters' });
  if (validate.hasForbiddenEverywhere(raw)) throw errors.validation({ q: 'Remove unsupported characters' });
  const q = raw.trim();
  const length = validate.codePointLength(q);
  if (length < SEARCH_MIN || length > SEARCH_MAX) {
    throw errors.validation({ q: 'Enter 2 to 100 characters' });
  }

  const recipients = await db.query(
    `SELECT * FROM recipients
      WHERE company_id = $1 AND status <> 'removed'
        AND position(lower($2) in lower(display_name)) > 0
      ORDER BY created_at DESC, id DESC LIMIT ${SEARCH_CAP}`,
    [ctx.companyId, q]
  );
  const transactions = await db.query(
    `SELECT * FROM transactions
      WHERE company_id = $1
        AND (position(lower($2) in lower(counterparty)) > 0
             OR position(lower($2) in lower(COALESCE(memo, ''))) > 0)
      ORDER BY created_at DESC, id DESC LIMIT ${SEARCH_CAP}`,
    [ctx.companyId, q]
  );
  return {
    status: 200,
    body: {
      recipients: recipients.rows.map(domain.serializeRecipient),
      transactions: transactions.rows.map(domain.serializeTransaction),
    },
  };
}

function asciiFallbackName(name) {
  let out = '';
  for (const codePoint of name) {
    out += codePoint.codePointAt(0) > 127 || codePoint === '"' || codePoint === '\\' ? '_' : codePoint;
  }
  return out;
}

const ATTR_CHAR = /^[A-Za-z0-9!#$&+\-.^_`|~]$/;

function rfc8187(name) {
  let out = '';
  for (const byte of Buffer.from(name, 'utf8')) {
    const char = String.fromCharCode(byte);
    out += ATTR_CHAR.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

async function statement(ctx) {
  const accountId = ctx.params.account_id;
  const monthRaw = ctx.query.get('month');
  const account = await domain.getAccount(null, ctx.companyId, accountId);

  const currentMonth = nytime.monthOf(nytime.nyDate(clock.nowMs()));
  let month = null;
  if (monthRaw !== null) {
    if (!nytime.isMonthString(monthRaw) || monthRaw > currentMonth) {
      throw errors.validation({ month: 'Choose a month up to the current month' });
    }
    month = monthRaw;
  }

  const rows = await db.readSnapshot(async (client) => {
    if (!month) {
      const all = await client.query(
        'SELECT * FROM transactions WHERE account_id = $1 ORDER BY created_at, id',
        [accountId]
      );
      return { opening: 0, transactions: all.rows };
    }
    const bounds = nytime.monthBounds(month);
    const opening = await snapshot.openingBalance(client, accountId, bounds.first);
    const inMonth = await client.query(
      `SELECT * FROM transactions
        WHERE account_id = $1 AND created_at >= $2 AND created_at < $3
        ORDER BY created_at, id`,
      [accountId, new Date(nytime.nyMidnightUtc(bounds.first)), new Date(nytime.nyMidnightUtc(bounds.nextFirst))]
    );
    return { opening, transactions: inMonth.rows };
  });

  const lines = ['date,counterparty,memo,direction,amount,balance'];
  let running = rows.opening;
  for (const row of rows.transactions) {
    const amount = Number(row.amount_cents) * (row.direction === 'credit' ? 1 : -1);
    running += amount;
    lines.push(
      [
        csv.plainCell(nytime.nyDate(new Date(row.created_at).getTime())),
        csv.textCell(row.counterparty),
        csv.textCell(row.memo === null ? '' : row.memo),
        csv.plainCell(row.direction),
        csv.plainCell(money.centsToPlainDollars(amount)),
        csv.plainCell(money.centsToPlainDollars(running)),
      ].join(',')
    );
  }

  const fileName = `${account.name}-statement-${month || 'all'}.csv`;
  return {
    status: 200,
    raw: `${lines.join('\n')}\n`,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${asciiFallbackName(fileName)}"; filename*=UTF-8''${rfc8187(fileName)}`,
    },
  };
}

async function openStream(ctx) {
  const lastEventId = ctx.req.headers['last-event-id'] || ctx.query.get('last_event_id');
  await streamService.open(ctx.res, {
    companyId: ctx.companyId,
    tokenHash: ctx.session.tokenHash,
    lastEventId: typeof lastEventId === 'string' ? lastEventId : null,
  });
  return { handled: true };
}

module.exports = {
  listAccounts,
  createAccount,
  getAccount,
  getSnapshot,
  listTransactions,
  search,
  statement,
  openStream,
};
