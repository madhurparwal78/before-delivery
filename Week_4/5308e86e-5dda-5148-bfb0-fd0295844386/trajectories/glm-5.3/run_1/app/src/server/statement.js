import { query } from './db.js';
import { nyDateStr, nyMidnightUtcMs, addCalendarDays } from './calendar.js';
import { formatPlainSigned } from './money.js';

// RFC 4180 statement with formula neutralisation on counterparty and memo.

function neutralise(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
  return s;
}

function quote(s) {
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function statementCsv(companyId, account, monthDate) {
  if (monthDate) {
    const start = nyMidnightUtcMs(monthDate.y, monthDate.m, 1);
    const nextMonth = monthDate.m === 12 ? { y: monthDate.y + 1, m: 1 } : { y: monthDate.y, m: monthDate.m + 1 };
    const end = nyMidnightUtcMs(nextMonth.y, nextMonth.m, 1);
    const rows = await query(
      'SELECT * FROM transactions WHERE account_id = $1 AND created_at >= $2 AND created_at < $3 ORDER BY created_at ASC, id ASC',
      [account.id, new Date(start), new Date(end)]
    );
    const openingRes = await query(
      'SELECT COALESCE(SUM(CASE WHEN direction = $2 THEN amount_cents ELSE -amount_cents END), 0) AS bal FROM transactions WHERE account_id = $1 AND created_at < $3',
      [account.id, 'credit', new Date(start)]
    );
    let balance = Number(openingRes.rows[0].bal);
    const lines = ['date,counterparty,memo,direction,amount,balance'];
    for (const r of rows.rows) {
      const amount = r.direction === 'credit' ? Number(r.amount_cents) : -Number(r.amount_cents);
      balance += amount;
      lines.push([
        nyDateStr(new Date(r.created_at).getTime()),
        quote(neutralise(r.counterparty)),
        quote(neutralise(r.memo)),
        r.direction,
        formatPlainSigned(amount),
        formatPlainSigned(balance),
      ].join(','));
    }
    return lines.join('\r\n') + '\r\n';
  }
  const rows = await query(
    'SELECT * FROM transactions WHERE account_id = $1 ORDER BY created_at ASC, id ASC',
    [account.id]
  );
  let balance = 0;
  const lines = ['date,counterparty,memo,direction,amount,balance'];
  for (const r of rows.rows) {
    const amount = r.direction === 'credit' ? Number(r.amount_cents) : -Number(r.amount_cents);
    balance += amount;
    lines.push([
      nyDateStr(new Date(r.created_at).getTime()),
      quote(neutralise(r.counterparty)),
      quote(neutralise(r.memo)),
      r.direction,
      formatPlainSigned(amount),
      formatPlainSigned(balance),
    ].join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
