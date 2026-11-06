import { query } from '../db.js';
import { errors } from './errors.js';
import { jsonOk, type Ctx } from './http.js';
import { resolveWorkspace } from './auth.js';
import { businessMonthInZone } from '../domain/time.js';
import type { CaseRecord } from './helpers.js';
import { csvDocument, REGULATOR_HEADER } from '../domain/csv.js';
import { amountString } from '../domain/case-body.js';
import { initials } from '../../shared/util.js';

export async function listFileMonths(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  const now = new Date();
  const currentMonth = businessMonthInZone(now, ws.time_zone);
  const firstSeeded = (await query<{ month: string }>('SELECT month FROM closed_months WHERE workspace_slug = $1 ORDER BY month ASC LIMIT 1', [ws.slug])).rows[0]?.month ?? currentMonth;
  const months: { month: string; cases: number }[] = [];
  let month = firstSeeded;
  while (month <= currentMonth) {
    const start = await import('../domain/time.js').then((m) => m.localMidnightUtc(`${month}-01`, ws.time_zone));
    const end = await import('../domain/time.js').then((m) => m.firstOfNextMonthUtc(month, ws.time_zone));
    const count = await query<{ n: string }>('SELECT count(*) AS n FROM cases WHERE workspace_slug = $1 AND created_at >= $2 AND created_at < $3', [ws.slug, start, end]);
    months.push({ month, cases: Number(count.rows[0].n) });
    month = nextMonth(month);
  }
  return jsonOk({ months });
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + m;
  return `${Math.floor(total / 12)}-${((total % 12) + 1).toString().padStart(2, '0')}`;
}

export async function regulatorFile(ctx: Ctx): Promise<Response> {
  const ws = await resolveWorkspace(ctx);
  const { enforceRateLimit } = await import('./partner.js');
  const { config } = await import('../config.js');
  if (ctx.session !== null) {
    await enforceRateLimit(`file:${ctx.session.memberId}`, 5, config.regulatorFileRateWindowSeconds);
  }
  const month = ctx.query.get('month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(month) || month > businessMonthInZone(new Date(), ws.time_zone)) {
    throw errors.invalid({ month: 'Choose a month that has started.' });
  }
  const role = ctx.session?.role ?? 'compliance_officer';
  const support = role === 'support_agent';

  const start = await import('../domain/time.js').then((m) => m.localMidnightUtc(`${month}-01`, ws.time_zone));
  const end = await import('../domain/time.js').then((m) => m.firstOfNextMonthUtc(month, ws.time_zone));
  const rows = await query<CaseRecord & { counterparty_current_name: string | null }>(
    `SELECT c.*, cp.legal_name AS counterparty_current_name FROM cases c
     LEFT JOIN counterparties cp ON cp.id = c.counterparty_id
     WHERE c.workspace_slug = $1 AND c.created_at >= $2 AND c.created_at < $3
     ORDER BY c.created_at, c.reference`,
    [ws.slug, start, end],
  );

  const out: (string | null)[][] = [REGULATOR_HEADER.slice()];
  for (const c of rows.rows) {
    const erased = c.erased === true;
    const originatorName = erased ? '' : support ? initials(c.originator_name ?? '') : c.originator_name ?? '';
    const originatorIdentity = erased ? '' : support ? `…${(c.originator_identity ?? '').slice(-4)}` : c.originator_identity ?? '';
    const originatorDob = erased || support ? '' : c.originator_dob === null ? '' : c.originator_dob.toISOString().slice(0, 10);
    const beneficiaryName = erased ? '' : support ? initials(c.beneficiary_name ?? '') : c.beneficiary_name ?? '';
    out.push([
      c.reference,
      instant(c.created_at),
      c.asset,
      amountString(c.amount_digits, c.amount_scale),
      cents(c.fiat_value_cents),
      c.currency,
      c.decided_threshold_cents === null ? '' : cents(c.decided_threshold_cents),
      c.decided_rule_since === null ? '' : c.decided_rule_since.toISOString().slice(0, 10),
      cents(c.decided_rate_cents),
      erased || c.decided_counterparty_name === null ? '' : c.decided_counterparty_name,
      erased || c.counterparty_lei === null ? '' : c.counterparty_lei,
      erased || c.counterparty_jurisdiction === null ? '' : c.counterparty_jurisdiction,
      erased || c.decided_counterparty_rule === null ? '' : c.decided_counterparty_rule,
      c.path,
      c.status,
      c.data_sent_channel ?? '',
      c.data_sent_at === null ? '' : instant(c.data_sent_at),
      c.answer_decision ?? '',
      c.answer_late === null ? '' : c.answer_late ? 'true' : 'false',
      c.answer_at === null ? '' : instant(c.answer_at),
      originatorName,
      originatorIdentity,
      originatorDob,
      beneficiaryName,
      c.closed_at === null ? '' : instant(c.closed_at),
      c.outcome ?? '',
    ]);
  }
  const csv = csvDocument(out);
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${ws.slug}-regulator-${month}.csv"`,
    },
  });
}

function instant(d: Date): string {
  return `${d.toISOString().slice(0, 19)}Z`;
}

function cents(value: string | bigint): string {
  const n = typeof value === 'bigint' ? Number(value) : Number(value);
  const digits = Math.abs(Math.trunc(n)).toString().padStart(3, '0');
  return `${n < 0 ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
