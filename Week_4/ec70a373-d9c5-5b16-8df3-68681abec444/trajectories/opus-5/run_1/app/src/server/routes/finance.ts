import { randomUUID } from 'node:crypto';
import { iso, nowMs } from '../clock';
import { query, tx } from '../db';
import { ApiError, isUuid, validationError } from '../http/errors';
import { closedBody } from '../http/request';
import type { HandlerResult, RequestContext } from '../http/context';
import { requireSiteInScope } from './session';
import { searchMembers } from '../domain/members';
import { sitesOfTenant } from '../domain/sites';
import { rateState, type RateRow } from '../domain/rules';
import { isDate, localDateOf } from '../../shared/tz';
import type { AuditOutcome, RateJson, ReportJson, ReportSiteRow, Role } from '../../shared/types';

export async function getMembers(ctx: RequestContext): Promise<HandlerResult> {
  const user = ctx.requireUser();
  const term = ctx.query.get('q');
  if (term === null || term.length < 2 || term.length > 100) {
    throw validationError({ q: 'Search with 2 to 100 characters.' });
  }
  const siteId = user.role === 'kitchen_manager' ? user.site_id : null;
  const members = await searchMembers(user.tenant_id, siteId, term);
  return { status: 200, body: { members } };
}

async function ratesOfSite(siteId: string): Promise<RateRow[]> {
  return query<RateRow>(
    `select id, to_char(effective_from, 'YYYY-MM-DD') as effective_from, hourly_rate_cents,
            tax_rate_percent, created_at
       from rates where site_id = $1 order by effective_from asc`,
    [siteId],
  );
}

function rateJson(rates: RateRow[], rate: RateRow, siteLocalDate: string): RateJson {
  return {
    id: rate.id,
    effective_from: rate.effective_from,
    hourly_rate_cents: rate.hourly_rate_cents,
    tax_rate_percent: rate.tax_rate_percent,
    state: rateState(rates, rate, siteLocalDate),
    created_at: iso(new Date(rate.created_at)),
  };
}

export async function getRates(ctx: RequestContext): Promise<HandlerResult> {
  const site = await requireSiteInScope(ctx, ctx.params.site_id as string);
  const rates = await ratesOfSite(site.id);
  const today = localDateOf(site.time_zone, nowMs());
  return {
    status: 200,
    body: { rates: rates.map((rate) => rateJson(rates, rate, today)) },
  };
}

export async function postRate(ctx: RequestContext): Promise<HandlerResult> {
  const site = await requireSiteInScope(ctx, ctx.params.site_id as string);
  ctx.audit.targetType = 'site';
  ctx.audit.targetId = site.id;
  const body = ctx.json();
  closedBody(body, ['effective_from', 'hourly_rate_cents', 'tax_rate_percent']);
  const effectiveFrom = body.effective_from;
  const hourlyRateCents = body.hourly_rate_cents;
  const taxRatePercent = body.tax_rate_percent;
  if (typeof effectiveFrom !== 'string' || !isDate(effectiveFrom)) {
    throw validationError({ effective_from: 'The effective date must be after today in site time.' });
  }
  if (
    typeof hourlyRateCents !== 'number' ||
    !Number.isInteger(hourlyRateCents) ||
    hourlyRateCents < 1 ||
    hourlyRateCents > 100000
  ) {
    throw validationError({
      hourly_rate_cents: 'Enter an hourly rate between $0.01 and $1,000.00.',
    });
  }
  if (
    typeof taxRatePercent !== 'string' ||
    !/^\d{1,2}(\.\d{1,3})?$/.test(taxRatePercent) ||
    Number.parseFloat(taxRatePercent) > 25
  ) {
    throw validationError({
      tax_rate_percent: 'Enter a tax rate between 0 and 25 percent with up to three decimals.',
    });
  }
  const today = localDateOf(site.time_zone, nowMs());
  if (effectiveFrom <= today) {
    throw validationError({ effective_from: 'The effective date must be after today in site time.' });
  }
  const rateId = randomUUID();
  await tx(async (client) => {
    const clash = await client.query<{ id: string }>(
      'select id from rates where site_id = $1 and effective_from = $2',
      [site.id, effectiveFrom],
    );
    if (clash.rows.length > 0) throw new ApiError('rate_exists');
    await client.query(
      `insert into rates (id, tenant_id, site_id, effective_from, hourly_rate_cents,
         tax_rate_percent, created_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [rateId, site.tenant_id, site.id, effectiveFrom, hourlyRateCents, taxRatePercent, iso(nowMs())],
    );
  });
  ctx.audit.targetType = 'rate';
  ctx.audit.targetId = rateId;
  const rates = await ratesOfSite(site.id);
  const rate = rates.find((candidate) => candidate.id === rateId) as RateRow;
  return {
    status: 201,
    body: {
      rate: rateJson(rates, rate, today),
      rates: rates.map((candidate) => rateJson(rates, candidate, today)),
    },
  };
}

async function buildReport(
  tenantId: string,
  month: string,
  memberId: string | null,
): Promise<ReportJson> {
  const sites = await sitesOfTenant(tenantId);
  const scheduled = await query<{ site_id: string; quarters: string }>(
    `select b.site_id, coalesce(sum(b.quarters), 0) as quarters
       from bookings b
      where b.tenant_id = $1
        and to_char(b.booking_date, 'YYYY-MM') = $2
        and b.status in ('confirmed','checked_in')
        and ($3::uuid is null or b.member_id = $3::uuid)
      group by b.site_id`,
    [tenantId, month, memberId],
  );
  const movements = await query<{ site_id: string; kind: string; quarters: string }>(
    `select b.site_id, mv.kind, coalesce(sum(mv.quarters), 0) as quarters
       from movements mv join bookings b on b.id = mv.booking_id
      where b.tenant_id = $1
        and to_char(b.booking_date, 'YYYY-MM') = $2
        and mv.kind in ('usage','late_checkout','forfeit')
        and ($3::uuid is null or b.member_id = $3::uuid)
      group by b.site_id, mv.kind`,
    [tenantId, month, memberId],
  );
  const overage = await query<{ site_id: string; cents: string }>(
    `select b.site_id, coalesce(sum((b.overage->>'total_cents')::bigint), 0) as cents
       from bookings b
      where b.tenant_id = $1
        and to_char(b.booking_date, 'YYYY-MM') = $2
        and b.overage is not null
        and ($3::uuid is null or b.member_id = $3::uuid)
      group by b.site_id`,
    [tenantId, month, memberId],
  );
  const rows: ReportSiteRow[] = sites
    .map((site) => {
      const scheduledQuarters = Number(
        scheduled.find((row) => row.site_id === site.id)?.quarters ?? 0,
      );
      const usedQuarters = movements
        .filter((row) => row.site_id === site.id && row.kind !== 'forfeit')
        .reduce((sum, row) => sum + Number(row.quarters), 0);
      const forfeitedQuarters = movements
        .filter((row) => row.site_id === site.id && row.kind === 'forfeit')
        .reduce((sum, row) => sum + Number(row.quarters), 0);
      return {
        site_id: site.id,
        site_name: site.name,
        scheduled_hours: scheduledQuarters / 4,
        used_hours: usedQuarters / 4,
        forfeited_hours: forfeitedQuarters / 4,
        overage_cents: Number(overage.find((row) => row.site_id === site.id)?.cents ?? 0),
      };
    })
    .sort((left, right) => left.site_name.localeCompare(right.site_name));
  let member: ReportJson['member'] = null;
  if (memberId !== null) {
    const found = await query<{ id: string; business_name: string }>(
      'select id, business_name from members where id = $1',
      [memberId],
    );
    const row = found[0];
    if (row !== undefined) member = { id: row.id, business_name: row.business_name };
  }
  return {
    month,
    member,
    sites: rows,
    totals: {
      scheduled_hours: rows.reduce((sum, row) => sum + row.scheduled_hours, 0),
      used_hours: rows.reduce((sum, row) => sum + row.used_hours, 0),
      forfeited_hours: rows.reduce((sum, row) => sum + row.forfeited_hours, 0),
      overage_cents: rows.reduce((sum, row) => sum + row.overage_cents, 0),
    },
  };
}

async function reportQuery(ctx: RequestContext): Promise<{ month: string; memberId: string | null }> {
  const user = ctx.requireUser();
  const month = ctx.query.get('month');
  if (month === null || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw validationError({ month: 'Enter a month as YYYY-MM.' });
  }
  const year = Number.parseInt(month.slice(0, 4), 10);
  if (year < 2000 || year > 2099) throw validationError({ month: 'Enter a month as YYYY-MM.' });
  const rawMember = ctx.query.get('member_id');
  if (rawMember === null || rawMember === '') return { month, memberId: null };
  if (!isUuid(rawMember)) throw new ApiError('not_found');
  const found = await query<{ id: string }>(
    'select id from members where id = $1 and tenant_id = $2',
    [rawMember, user.tenant_id],
  );
  if (found.length === 0) throw new ApiError('not_found');
  return { month, memberId: rawMember };
}

export async function getReport(ctx: RequestContext): Promise<HandlerResult> {
  const user = ctx.requireUser();
  const { month, memberId } = await reportQuery(ctx);
  const report = await buildReport(user.tenant_id, month, memberId);
  return { status: 200, body: report };
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function getReportCsv(ctx: RequestContext): Promise<HandlerResult> {
  const user = ctx.requireUser();
  const { month, memberId } = await reportQuery(ctx);
  const report = await buildReport(user.tenant_id, month, memberId);
  const lines = ['site_name,month,scheduled_hours,used_hours,forfeited_hours,overage_cents'];
  for (const row of report.sites) {
    lines.push(
      [
        csvCell(row.site_name),
        month,
        row.scheduled_hours.toFixed(2),
        row.used_hours.toFixed(2),
        row.forfeited_hours.toFixed(2),
        String(row.overage_cents),
      ].join(','),
    );
  }
  lines.push(
    [
      'TOTAL',
      month,
      report.totals.scheduled_hours.toFixed(2),
      report.totals.used_hours.toFixed(2),
      report.totals.forfeited_hours.toFixed(2),
      String(report.totals.overage_cents),
    ].join(','),
  );
  return {
    status: 200,
    raw: Buffer.from(`${lines.join('\n')}\n`, 'utf8'),
    contentType: 'text/csv; charset=utf-8',
    headers: {
      'Content-Disposition': `attachment; filename="utilisation-${month}.csv"`,
    },
  };
}

interface AuditRow {
  id: string;
  at: Date;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_role: Role | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  outcome: AuditOutcome;
  address_prefix: string | null;
}

export async function getAudit(ctx: RequestContext): Promise<HandlerResult> {
  const user = ctx.requireUser();
  const rawSince = ctx.query.get('since');
  let since = 0;
  if (rawSince !== null && rawSince !== '') {
    if (!/^\d{1,10}$/.test(rawSince)) throw validationError({ since: 'Give a positive integer.' });
    since = Number.parseInt(rawSince, 10);
    if (since > 2147483647 || since < 1) throw validationError({ since: 'Give a positive integer.' });
  }
  const events = await query<AuditRow>(
    `select id::text as id, at, actor_user_id, actor_name, actor_role, action, target_type,
            target_id, outcome, address_prefix
       from audit_events
      where scope_tenant_id = $1
        and ($2::uuid is null or scope_site_id = $2::uuid)
        and id > $3
      order by audit_events.id desc
      limit 200`,
    [user.tenant_id, user.role === 'kitchen_manager' ? user.site_id : null, since],
  );
  return {
    status: 200,
    body: {
      events: events.map((event) => ({
        id: Number(event.id),
        at: iso(event.at),
        actor:
          event.actor_user_id === null || event.actor_name === null || event.actor_role === null
            ? null
            : { user_id: event.actor_user_id, name: event.actor_name, role: event.actor_role },
        action: event.action,
        target_type: event.target_type,
        target_id: event.target_id,
        outcome: event.outcome,
        address_prefix: event.address_prefix,
      })),
    },
  };
}
