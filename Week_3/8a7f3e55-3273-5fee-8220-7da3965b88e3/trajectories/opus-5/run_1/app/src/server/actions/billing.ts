import type { InvoiceLine, WeekStatement } from '../../shared/api.js';
import { query, withTransaction } from '../db/pool.js';
import { agencyIso, agencyDate, dateOnlyAddDays, isMonday, mondayOfDate, parseDateOnly } from '../domain/time.js';
import { ApiError, apiError, FIELD_MESSAGES, validationError } from '../http/errors.js';
import { FieldErrors, integerFrom } from '../http/validation.js';
import {
  accountItems,
  BillingUnavailable,
  findAccountId,
  itemAmountCents,
} from '../services/killbill.js';
import { contractById, toContractResponse } from '../store/contracts.js';
import type { LineRecord } from '../store/bookings.js';
import type { Contract } from '../../shared/api.js';

interface LineRow extends LineRecord {
  killbill_item_id: string | null;
}

async function linesForWeek(orgId: string, weekStart: string): Promise<LineRow[]> {
  return query<LineRow>(
    `SELECT l.line_ref, l.booking_id, b.ref AS booking_ref, l.org_id, l.kind, l.assignment_date,
            l.rate_effective_from, l.hourly_rate_cents, l.team_surcharge_bp, l.basis_minutes,
            l.billable_minutes, l.interpreter_count, l.time_amount_cents, l.mileage_miles,
            l.mileage_cents_per_mile, l.mileage_amount_cents, l.amount_cents, l.billing_week,
            l.sync_status, l.killbill_item_id, l.created_at
     FROM invoice_lines l JOIN bookings b ON b.id = l.booking_id
     WHERE l.org_id = $1 AND l.billing_week = $2
     ORDER BY l.created_at, l.line_ref`,
    [orgId, weekStart],
  );
}

interface BillingAmounts {
  reachable: boolean;
  byLineRef: Map<string, number | null>;
}

/** Billing amounts always come from Kill Bill, including adjustments made there. */
async function readBillingAmounts(
  orgId: string,
  lines: readonly LineRow[],
): Promise<BillingAmounts> {
  const byLineRef = new Map<string, number | null>();
  for (const line of lines) byLineRef.set(line.line_ref, null);
  try {
    const accountId = await findAccountId(orgId);
    if (accountId === null) return { reachable: true, byLineRef };
    const items = await accountItems(accountId);
    for (const line of lines) {
      if (line.sync_status !== 'synced' || line.killbill_item_id === null) continue;
      byLineRef.set(line.line_ref, itemAmountCents(items, line.killbill_item_id));
    }
    return { reachable: true, byLineRef };
  } catch (cause) {
    if (cause instanceof BillingUnavailable) {
      for (const line of lines) byLineRef.set(line.line_ref, null);
      return { reachable: false, byLineRef };
    }
    throw cause;
  }
}

function lineView(line: LineRow, billingAmount: number | null): InvoiceLine {
  return {
    line_ref: line.line_ref,
    booking_id: line.booking_id,
    booking_ref: line.booking_ref,
    org_id: line.org_id,
    kind: line.kind,
    assignment_date: line.assignment_date,
    rate_effective_from: line.rate_effective_from,
    hourly_rate_cents: line.hourly_rate_cents,
    team_surcharge_bp: line.team_surcharge_bp,
    basis_minutes: line.basis_minutes,
    billable_minutes: line.billable_minutes,
    interpreter_count: line.interpreter_count,
    time_amount_cents: line.time_amount_cents,
    mileage_miles: line.mileage_miles,
    mileage_cents_per_mile: line.mileage_cents_per_mile,
    mileage_amount_cents: line.mileage_amount_cents,
    amount_cents: line.amount_cents,
    billing_amount_cents: billingAmount,
    billing_week: line.billing_week,
    sync_status: line.sync_status,
    created_at: agencyIso(new Date(line.created_at)),
  };
}

export function validateWeekStart(raw: string, now: Date): string {
  const parsed = parseDateOnly(raw);
  if (parsed === null || !isMonday(parsed) || parsed > mondayOfDate(agencyDate(now))) {
    throw validationError({ week_start: FIELD_MESSAGES.week_start });
  }
  return parsed;
}

interface ClosedWeekRow {
  closed_at: string;
  relayline_total_cents: number;
  billing_total_cents: number;
}

async function closedWeek(orgId: string, weekStart: string): Promise<ClosedWeekRow | null> {
  const rows = await query<ClosedWeekRow>(
    'SELECT closed_at, relayline_total_cents, billing_total_cents FROM billing_weeks WHERE org_id = $1 AND week_start = $2',
    [orgId, weekStart],
  );
  return rows[0] ?? null;
}

export async function weekStatement(
  orgId: string,
  orgName: string,
  weekStart: string,
): Promise<WeekStatement> {
  const lines = await linesForWeek(orgId, weekStart);
  const amounts = await readBillingAmounts(orgId, lines);
  const closed = await closedWeek(orgId, weekStart);
  const relaylineTotal = lines.reduce((total, line) => total + line.amount_cents, 0);
  const lineViews = lines.map((line) => lineView(line, amounts.byLineRef.get(line.line_ref) ?? null));
  const anyMissing = lineViews.some((line) => line.billing_amount_cents === null);
  const liveBillingTotal = anyMissing
    ? null
    : lineViews.reduce((total, line) => total + (line.billing_amount_cents ?? 0), 0);
  return {
    org_id: orgId,
    org_name: orgName,
    week_start: weekStart,
    status: closed ? 'closed' : 'open',
    lines: lineViews,
    relayline_total_cents: relaylineTotal,
    billing_total_cents: closed ? closed.billing_total_cents : liveBillingTotal,
    billing_reachable: amounts.reachable,
    closed_at: closed ? agencyIso(new Date(closed.closed_at)) : null,
  };
}

export async function closeWeek(
  orgId: string,
  orgName: string,
  weekStart: string,
): Promise<WeekStatement> {
  const alreadyClosed = await closedWeek(orgId, weekStart);
  if (alreadyClosed) throw apiError('week_closed');

  const lines = await linesForWeek(orgId, weekStart);
  const pending = lines.filter((line) => line.sync_status !== 'synced');
  if (pending.length > 0) {
    throw new ApiError('pending_sync', {
      pending_line_refs: pending.map((line) => line.line_ref),
    });
  }

  const amounts = await readBillingAmounts(orgId, lines);
  if (!amounts.reachable) throw apiError('billing_unavailable');

  const relaylineTotal = lines.reduce((total, line) => total + line.amount_cents, 0);
  const billingTotal = lines.reduce(
    (total, line) => total + (amounts.byLineRef.get(line.line_ref) ?? 0),
    0,
  );
  if (relaylineTotal !== billingTotal) {
    throw new ApiError('total_mismatch', {
      relayline_total_cents: relaylineTotal,
      billing_total_cents: billingTotal,
    });
  }

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO billing_weeks (org_id, week_start, closed_at, relayline_total_cents, billing_total_cents)
       VALUES ($1, $2, now(), $3, $4) ON CONFLICT (org_id, week_start) DO NOTHING`,
      [orgId, weekStart, relaylineTotal, billingTotal],
    );
  });
  return weekStatement(orgId, orgName, weekStart);
}

export async function addContractRate(
  contractId: string,
  body: Record<string, unknown>,
  now: Date,
): Promise<Contract> {
  const contract = await contractById(contractId);
  if (!contract) throw apiError('not_found');

  const errors = new FieldErrors();
  const effectiveFrom = parseDateOnly(body['effective_from']);
  const today = agencyDate(now);
  if (effectiveFrom === null || effectiveFrom <= today) {
    errors.add('effective_from', FIELD_MESSAGES.effective_from_past);
  } else if (contract.rates.some((rate) => rate.effective_from === effectiveFrom)) {
    errors.add('effective_from', FIELD_MESSAGES.effective_from_duplicate);
  }
  const hourlyRateCents = integerFrom(body['hourly_rate_cents']);
  if (hourlyRateCents === null || hourlyRateCents < 1 || hourlyRateCents > 100_000) {
    errors.add('hourly_rate_cents', FIELD_MESSAGES.hourly_rate_cents);
  }
  const teamSurchargeBp = integerFrom(body['team_surcharge_bp']);
  if (teamSurchargeBp === null || teamSurchargeBp < 0 || teamSurchargeBp > 10_000) {
    errors.add('team_surcharge_bp', FIELD_MESSAGES.team_surcharge_bp);
  }
  const mileageCentsPerMile = integerFrom(body['mileage_cents_per_mile']);
  if (mileageCentsPerMile === null || mileageCentsPerMile < 0 || mileageCentsPerMile > 1_000) {
    errors.add('mileage_cents_per_mile', FIELD_MESSAGES.mileage_cents_per_mile);
  }
  errors.throwIfAny();
  if (
    effectiveFrom === null ||
    hourlyRateCents === null ||
    teamSurchargeBp === null ||
    mileageCentsPerMile === null
  ) {
    throw new Error('Unreachable rate validation');
  }

  const billed = await query<{ latest: string | null }>(
    'SELECT max(assignment_date) AS latest FROM invoice_lines WHERE org_id = $1',
    [contract.orgId],
  );
  const latestBilled = billed[0]?.latest ?? null;
  if (latestBilled !== null && effectiveFrom <= latestBilled) {
    const dayAfterBilled = dateOnlyAddDays(latestBilled, 1);
    const tomorrow = dateOnlyAddDays(today, 1);
    throw new ApiError('rate_would_reprice', {
      earliest_allowed: dayAfterBilled > tomorrow ? dayAfterBilled : tomorrow,
    });
  }

  await query(
    `INSERT INTO contract_rates (contract_id, effective_from, hourly_rate_cents, team_surcharge_bp, mileage_cents_per_mile)
     VALUES ($1, $2, $3, $4, $5)`,
    [contractId, effectiveFrom, hourlyRateCents, teamSurchargeBp, mileageCentsPerMile],
  );
  const updated = await contractById(contractId);
  if (!updated) throw new Error('Contract disappeared');
  return toContractResponse(updated);
}
