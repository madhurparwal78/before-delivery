import {
  businessMonth,
  monthLabel,
  nextBusinessMonth,
  startOfBusinessMonth,
  toInstant,
} from '../../shared/businesstime';
import { monthClosedCopy, monthEmptyCopy, monthNotEndedCopy } from '../../shared/copy';
import { moneyLabel } from '../../shared/format';
import { inTransaction, query, queryOne } from '../db/pool';
import { newId } from '../db/seed';
import { feeLinesFor, FeeLine, totalCents } from '../domain/fees';
import { ApiError, failure } from '../http/errors';
import { define, Registered, Role, WorkspaceRecord } from '../http/runtime';
import { createMonthInvoice, InvoicingUnreachable } from '../services/killbill';
import { sendMail } from '../services/mail';

const OFFICER_FINANCE: readonly Role[] = ['compliance_officer', 'finance_lead'];
const FINANCE: readonly Role[] = ['finance_lead'];

interface ClosedMonthRow {
  month: string;
  status: string;
  invoice_id: string | null;
  closed_at: Date | null;
  message_count: number | null;
  total_cents: string | null;
}

interface FeeLineRow {
  tier: number;
  label: string;
  message_count: number;
  unit_price: string;
  amount_cents: string;
}

export interface MonthView {
  readonly month: string;
  readonly status: 'open' | 'ready' | 'invoiced';
  readonly messageCount: number;
  readonly totalCents: bigint;
  readonly currency: string;
  readonly invoiceId: string | null;
  readonly closedAt: string | null;
  readonly lines: readonly FeeLine[];
}

export async function firstMeteredMonth(workspace: WorkspaceRecord, now: Date): Promise<string> {
  const row = await queryOne<{ month: string }>(
    'SELECT min(business_month) AS month FROM metered_messages WHERE workspace_slug = $1',
    [workspace.slug],
  );
  const current = businessMonth(now, workspace.timeZone);
  return row === null || row.month === null ? current : row.month;
}

export async function monthsFromStart(workspace: WorkspaceRecord, now: Date): Promise<string[]> {
  const current = businessMonth(now, workspace.timeZone);
  const months: string[] = [];
  let month = await firstMeteredMonth(workspace, now);
  while (month <= current && months.length < 600) {
    months.push(month);
    month = nextBusinessMonth(month);
  }
  return months;
}

export function monthHasEnded(month: string, workspace: WorkspaceRecord, now: Date): boolean {
  return startOfBusinessMonth(nextBusinessMonth(month), workspace.timeZone).getTime() <= now.getTime();
}

export async function monthView(
  month: string,
  workspace: WorkspaceRecord,
  now: Date,
): Promise<MonthView> {
  const closed = await queryOne<ClosedMonthRow>(
    'SELECT * FROM business_months WHERE workspace_slug = $1 AND month = $2',
    [workspace.slug, month],
  );
  if (closed !== null && closed.status === 'invoiced') {
    const rows = await query<FeeLineRow>(
      'SELECT * FROM fee_lines WHERE workspace_slug = $1 AND month = $2 ORDER BY tier',
      [workspace.slug, month],
    );
    const lines = rows.map((row) => ({
      tier: row.tier as 1 | 2 | 3,
      label: row.label,
      count: row.message_count,
      unitPrice: row.unit_price,
      amountCents: BigInt(row.amount_cents),
    }));
    return {
      month,
      status: 'invoiced',
      messageCount: closed.message_count ?? 0,
      totalCents: closed.total_cents === null ? totalCents(lines) : BigInt(closed.total_cents),
      currency: workspace.currency,
      invoiceId: closed.invoice_id,
      closedAt: closed.closed_at === null ? null : toInstant(closed.closed_at),
      lines,
    };
  }
  const counted = await queryOne<{ count: string }>(
    'SELECT count(*) AS count FROM metered_messages WHERE workspace_slug = $1 AND business_month = $2',
    [workspace.slug, month],
  );
  const messageCount = counted === null ? 0 : Number.parseInt(counted.count, 10);
  const lines = feeLinesFor(messageCount, workspace.currency);
  return {
    month,
    status: monthHasEnded(month, workspace, now) ? 'ready' : 'open',
    messageCount,
    totalCents: totalCents(lines),
    currency: workspace.currency,
    invoiceId: null,
    closedAt: null,
    lines,
  };
}

function monthBody(view: MonthView): Record<string, unknown> {
  return {
    month: view.month,
    status: view.status,
    messageCount: view.messageCount,
    totalCents: view.totalCents,
    currency: view.currency,
    invoiceId: view.invoiceId,
    closedAt: view.closedAt,
  };
}

function lineBody(line: FeeLine): Record<string, unknown> {
  return {
    tier: line.tier,
    label: line.label,
    count: line.count,
    unitPrice: line.unitPrice,
    amountCents: line.amountCents,
  };
}

export const monthRoutes: readonly Registered[] = [
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/months',
    roles: OFFICER_FINANCE,
    handler: async (context) => {
      const months = await monthsFromStart(context.workspace, context.now);
      const views = await Promise.all(
        months.map((month) => monthView(month, context.workspace, context.now)),
      );
      return { status: 200, json: { months: views.reverse().map(monthBody) } };
    },
  }),
  define({
    kind: 'staff',
    method: 'GET',
    path: '/api/w/:slug/months/:month',
    roles: OFFICER_FINANCE,
    load: async (context) => {
      const months = await monthsFromStart(context.workspace, context.now);
      if (!months.includes(context.params.month)) throw failure('not_found');
      return context.params.month;
    },
    handler: async (context) => {
      const view = await monthView(context.loaded, context.workspace, context.now);
      return {
        status: 200,
        json: { month: { ...monthBody(view), lines: view.lines.map(lineBody) } },
      };
    },
  }),
  define({
    kind: 'staff',
    method: 'POST',
    path: '/api/w/:slug/months/:month/close',
    roles: FINANCE,
    content: 'json',
    load: async (context) => {
      const months = await monthsFromStart(context.workspace, context.now);
      if (!months.includes(context.params.month)) throw failure('not_found');
      return context.params.month;
    },
    handler: async (context) => {
      const month = context.loaded;
      const workspace = context.workspace;
      const label = monthLabel(month);
      const view = await monthView(month, workspace, context.now);
      if (view.status === 'invoiced') throw new ApiError(409, 'month_closed', monthClosedCopy(label));
      if (!monthHasEnded(month, workspace, context.now)) {
        throw new ApiError(409, 'month_not_ended', monthNotEndedCopy(label));
      }
      if (view.messageCount === 0) {
        throw new ApiError(409, 'month_empty', monthEmptyCopy(label));
      }
      const recorded = await inTransaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `${workspace.slug}:${month}`,
        ]);
        const already = await client.query<{ month: string }>(
          "SELECT month FROM business_months WHERE workspace_slug = $1 AND month = $2 AND status = 'invoiced'",
          [workspace.slug, month],
        );
        if (already.rows.length > 0) {
          throw new ApiError(409, 'month_closed', monthClosedCopy(label));
        }
        let invoiceId: string;
        try {
          invoiceId = await createMonthInvoice(
            workspace.slug,
            workspace.legalName,
            workspace.currency,
            view.lines.map((line) => ({
              description: `${line.label}, ${line.count === 1 ? '1 message' : `${line.count} messages`}, ${label}`,
              amountCents: line.amountCents,
            })),
          );
        } catch (error) {
          if (error instanceof InvoicingUnreachable) throw failure('invoicing_unreachable');
          throw error;
        }
        for (const line of view.lines) {
          await client.query(
            `INSERT INTO fee_lines (id, workspace_slug, month, tier, label, message_count, unit_price, amount_cents)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              newId('fl'),
              workspace.slug,
              month,
              line.tier,
              line.label,
              line.count,
              line.unitPrice,
              line.amountCents.toString(),
            ],
          );
        }
        await client.query(
          `INSERT INTO business_months (workspace_slug, month, status, invoice_id, closed_at, message_count, total_cents)
           VALUES ($1,$2,'invoiced',$3,$4,$5,$6)`,
          [
            workspace.slug,
            month,
            invoiceId,
            context.now,
            view.messageCount,
            totalCents(view.lines).toString(),
          ],
        );
        return invoiceId;
      });
      const financeLeads = await query<{ email: string }>(
        "SELECT email FROM members WHERE workspace_slug = $1 AND role = 'finance_lead'",
        [workspace.slug],
      );
      if (financeLeads.length > 0) {
        await sendMail({
          to: financeLeads.map((row) => row.email),
          subject: `Lanternline: ${label} closed`,
          text: [
            `${label} is closed.`,
            '',
            ...view.lines.map(
              (line) =>
                `${line.label}: ${line.count === 1 ? '1 message' : `${line.count} messages`} at ${line.unitPrice} = ${moneyLabel(workspace.currency, line.amountCents)}`,
            ),
            '',
            `Total: ${moneyLabel(workspace.currency, totalCents(view.lines))}`,
            `Kill Bill invoice: ${recorded}`,
          ].join('\n'),
        }).catch(() => undefined);
      }
      const after = await monthView(month, workspace, context.now);
      return {
        status: 201,
        json: { month: { ...monthBody(after), lines: after.lines.map(lineBody) } },
      };
    },
  }),
];
