import { query } from '../db.js';
import { errors } from './errors.js';
import { jsonOk, requireJsonContentType, type Ctx } from './http.js';
import { resolveWorkspace } from './auth.js';
import { businessMonthInZone, firstOfNextMonthUtc, monthLabel, formatInstant } from '../domain/time.js';
import { feeLines, feeTotal } from '../domain/fees.js';
import { ensureAccount, createInvoice } from '../services/killbill.js';
import { sendMail } from '../services/smtp.js';
import { formatFiat } from '../../shared/util.js';

export async function listMonths(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  const now = new Date();
  const currentMonth = businessMonthInZone(now, ws.time_zone);
  const firstSeeded = (await query<{ month: string }>('SELECT month FROM closed_months WHERE workspace_slug = $1 ORDER BY month ASC LIMIT 1', [ws.slug])).rows[0]?.month ?? currentMonth;
  const months: Record<string, unknown>[] = [];
  let month = firstSeeded;
  while (month <= currentMonth) {
    months.push(await monthSummary(ws.slug, ws.currency, ws.time_zone, month));
    month = nextMonth(month);
  }
  return jsonOk({ months });
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + m;
  const year = Math.floor(total / 12);
  const mon = (total % 12) + 1;
  return `${year}-${mon.toString().padStart(2, '0')}`;
}

async function monthSummary(slug: string, currency: string, timeZone: string, month: string): Promise<Record<string, unknown>> {
  const recorded = await query<{ status: string; invoice_id: string | null; closed_at: Date | null; lines: FeeLineRow[]; total_cents: string }>(
    'SELECT status, invoice_id, closed_at, lines, total_cents FROM closed_months WHERE workspace_slug = $1 AND month = $2', [slug, month]);
  const count = await messageCount(slug, month, timeZone);
  const now = new Date();
  const ended = firstOfNextMonthUtc(month, timeZone).getTime() <= now.getTime();
  let status: string;
  let invoiceId: string | null = null;
  let closedAt: Date | null = null;
  let total = 0;
  if (recorded.rows.length > 0 && recorded.rows[0].status === 'invoiced') {
    status = 'invoiced';
    invoiceId = recorded.rows[0].invoice_id;
    closedAt = recorded.rows[0].closed_at;
    total = Number(recorded.rows[0].total_cents);
  } else {
    const lines = feeLines(count, currency);
    total = feeTotal(lines);
    status = count === 0 ? 'open' : ended ? 'ready' : 'open';
    if (count === 0 && ended) status = 'ready';
  }
  return { month, status, messageCount: count, totalCents: total, currency, invoiceId, closedAt: closedAt === null ? null : formatInstant(closedAt) };
}

interface FeeLineRow { tier: number; label: string; count: number; unitPrice: string; amountCents: number }

async function messageCount(slug: string, month: string, timeZone: string): Promise<number> {
  const start = await import('../domain/time.js').then((m) => m.localMidnightUtc(`${month}-01`, timeZone));
  const end = firstOfNextMonthUtc(month, timeZone);
  const r = await query<{ n: string }>('SELECT count(*) AS n FROM metered_messages WHERE workspace_slug = $1 AND at >= $2 AND at < $3', [slug, start, end]);
  return Number(r.rows[0].n);
}

export async function getMonth(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  const month = ctx.params.month;
  if (!/^\d{4}-\d{2}$/.test(month)) throw errors.notFound();
  const recorded = await query<{ status: string; invoice_id: string | null; closed_at: Date | null; lines: FeeLineRow[]; total_cents: string }>(
    'SELECT status, invoice_id, closed_at, lines, total_cents FROM closed_months WHERE workspace_slug = $1 AND month = $2', [ws.slug, month]);
  const count = await messageCount(ws.slug, month, ws.time_zone);
  const now = new Date();
  const ended = firstOfNextMonthUtc(month, ws.time_zone).getTime() <= now.getTime();
  let lines: FeeLineRow[];
  let invoiceId: string | null = null;
  let status: string;
  let closedAt: Date | null = null;
  let total: number;
  if (recorded.rows.length > 0 && recorded.rows[0].status === 'invoiced') {
    lines = recorded.rows[0].lines;
    invoiceId = recorded.rows[0].invoice_id;
    closedAt = recorded.rows[0].closed_at;
    total = Number(recorded.rows[0].total_cents);
    status = 'invoiced';
  } else {
    lines = feeLines(count, ws.currency);
    total = feeTotal(lines);
    status = count === 0 ? 'open' : ended ? 'ready' : 'open';
    if (count === 0 && ended) status = 'ready';
  }
  return jsonOk({ month: { month, status, messageCount: count, totalCents: total, currency: ws.currency, invoiceId, closedAt: closedAt === null ? null : formatInstant(closedAt), lines } });
}

async function readEmptyBody(ctx: Ctx): Promise<void> {
  await ctx.rawBody();
}

export async function closeMonth(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  requireJsonContentType(ctx, ['application/json']);
  await readEmptyBody(ctx);
  const month = ctx.params.month;
  if (!/^\d{4}-\d{2}$/.test(month)) throw errors.notFound();
  const recorded = await query<{ status: string }>('SELECT status FROM closed_months WHERE workspace_slug = $1 AND month = $2', [ws.slug, month]);
  if (recorded.rows.length > 0 && recorded.rows[0].status === 'invoiced') throw errors.conflict('month_closed', `${monthLabel(month)} is already closed.`);
  const now = new Date();
  if (firstOfNextMonthUtc(month, ws.time_zone).getTime() > now.getTime()) throw errors.conflict('month_not_ended', `${monthLabel(month)} has not ended yet.`);
  const count = await messageCount(ws.slug, month, ws.time_zone);
  if (count === 0) throw errors.conflict('month_empty', `${monthLabel(month)} has no messages to bill.`);
  const lines = feeLines(count, ws.currency);
  const total = feeTotal(lines);

  // Kill Bill first: only after the invoice returns does the server record.
  const accountId = await ensureAccount(ws.slug, ws.legal_name, ws.currency);
  if (accountId === null) throw errors.invoicingUnreachable();
  const invoice = await createInvoice(accountId, lines.map((line) => ({
    description: `${line.label}, ${line.count === 1 ? '1 message' : `${line.count} messages`}, ${monthLabel(month)}`,
    amountCents: BigInt(line.amountCents),
    currency: ws.currency,
  })));
  if (invoice === null) throw errors.invoicingUnreachable();

  const elected = await query(`INSERT INTO closed_months (workspace_slug, month, status, lines, total_cents)
    VALUES ($1,$2,'invoiced',$3,$4)
    ON CONFLICT (workspace_slug, month) DO UPDATE SET status = 'invoiced', invoice_id = EXCLUDED.invoice_id, closed_at = EXCLUDED.closed_at, lines = EXCLUDED.lines, total_cents = EXCLUDED.total_cents
    WHERE closed_months.status <> 'invoiced'
    RETURNING invoice_id, closed_at`, [ws.slug, month, JSON.stringify(lines), BigInt(total)]).catch(async () => {
    return await query(`UPDATE closed_months SET status = 'invoiced', lines = $3, total_cents = $4 WHERE workspace_slug = $1 AND month = $2 AND status <> 'invoiced' RETURNING invoice_id, closed_at`, [ws.slug, month, JSON.stringify(lines), BigInt(total)]);
  });
  if (elected.rows.length === 0) throw errors.conflict('month_closed', `${monthLabel(month)} is already closed.`);
  await query('UPDATE closed_months SET invoice_id = $3, closed_at = $4 WHERE workspace_slug = $1 AND month = $2', [ws.slug, month, invoice.invoiceId, now]);

  // The finance mail goes out only after the fee lines and invoice are recorded.
  const financeLeads = await query<{ email: string }>(`SELECT email FROM members WHERE workspace_slug = $1 AND role = 'finance_lead'`, [ws.slug]);
  for (const lead of financeLeads.rows) {
    await sendMail({
      to: lead.email,
      subject: `Lanternline: ${monthLabel(month)} closed`,
      textBody: [
        `${monthLabel(month)} closed.`,
        '',
        ...lines.map((line) => `${line.label}: ${line.count} ${line.count === 1 ? 'message' : 'messages'}, ${line.unitPrice}, ${formatFiat(ws.currency, line.amountCents)}`),
        `Total: ${formatFiat(ws.currency, total)}`,
        `Kill Bill invoice id: ${invoice.invoiceId}`,
      ].join('\n'),
    });
  }
  return jsonOk({ month: { month, status: 'invoiced', messageCount: count, totalCents: total, currency: ws.currency, invoiceId: invoice.invoiceId, closedAt: formatInstant(now), lines } }, 201);
}
