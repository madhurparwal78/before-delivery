import { findAssignments } from '../../db/assignments.js';
import { query, queryOne } from '../../db/pool.js';
import { insertRateEntry, listRateEntries } from '../../db/rateCards.js';
import { isBillable } from '../../domain/charges.js';
import { centralDateKey, parseCentralDateKey } from '../../../shared/centralTime.js';
import { isoWithCentralOffset } from '../../domain/time.js';
import type { ServiceLine } from '../../domain/types.js';
import { chargesOf, postAssignmentInvoice } from '../../services/billing.js';
import { fail } from '../errors.js';
import type { Route } from '../router.js';
import { integerFromText, stringOf } from '../validation.js';

const SERVICE_LINES: ServiceLine[] = ['asl', 'spoken'];

export const billingRoutes: Route[] = [
  {
    kind: 'assignment',
    method: 'GET',
    path: '/api/assignments/:number/charges',
    body: 'none',
    roles: ['billing_lead'],
    async handler(ctx) {
      if (!isBillable(ctx.assignment)) fail('not_billable');
      const rates = await listRateEntries(ctx.assignment.orgCode);
      const charges = chargesOf(ctx.assignment, rates);
      return {
        status: 200,
        json: {
          number: ctx.assignment.number,
          kind: charges.kind,
          rate: {
            effective_from: charges.rate.effectiveFrom,
            hourly_rate_cents: charges.rate.hourlyRateCents,
            mileage_cents_per_mile: charges.rate.mileageCentsPerMile,
          },
          lines: charges.lines.map((line) => ({
            seat: line.seat,
            actual_minutes: line.actualMinutes,
            billable_minutes: line.billableMinutes,
            amount_cents: line.amountCents,
            round_trip_miles: line.roundTripMiles,
            billable_miles: line.billableMiles,
            mileage_cents: line.mileageCents,
          })),
          total_cents: charges.totalCents,
        },
      };
    },
  },
  {
    kind: 'assignment',
    method: 'POST',
    path: '/api/assignments/:number/invoice',
    body: 'json',
    roles: ['billing_lead'],
    async handler(ctx) {
      const result = await postAssignmentInvoice(ctx.assignment.number);
      return { status: result.status, json: { billing: result.billing } };
    },
  },
  {
    kind: 'session',
    method: 'GET',
    path: '/api/billing/queue',
    body: 'none',
    roles: ['billing_lead'],
    async handler() {
      const records = await findAssignments(
        "a.billing_status in ('ready', 'queued', 'posted')",
        [],
      );
      return {
        status: 200,
        json: {
          items: records.map((record) => ({
            number: record.number,
            org_code: record.orgCode,
            kind: record.status === 'cancelled' ? 'late_cancellation' : 'service',
            start_at: isoWithCentralOffset(record.startAt),
            total_cents: record.totalCents,
            billing: {
              status: record.billingStatus,
              invoice_id: record.invoiceId,
              total_cents: record.totalCents,
            },
          })),
        },
      };
    },
  },
  {
    kind: 'session',
    method: 'GET',
    path: '/api/rate-cards',
    body: 'none',
    roles: ['billing_lead'],
    async handler(ctx) {
      const orgCode = ctx.url.searchParams.get('org') ?? '';
      const org = await queryOne<{ code: string }>('select code from orgs where code = $1', [orgCode]);
      if (org === null) fail('not_found');
      const entries = await listRateEntries(org.code);
      return {
        status: 200,
        json: {
          entries: entries.map((entry) => ({
            org: entry.orgCode,
            service_line: entry.serviceLine,
            effective_from: entry.effectiveFrom,
            hourly_rate_cents: entry.hourlyRateCents,
            mileage_cents_per_mile: entry.mileageCentsPerMile,
          })),
        },
      };
    },
  },
  {
    kind: 'session',
    method: 'POST',
    path: '/api/rate-cards',
    body: 'json',
    roles: ['billing_lead'],
    async handler(ctx) {
      const orgCode = stringOf(ctx.json['org']) ?? '';
      const org = await queryOne<{ code: string }>('select code from orgs where code = $1', [orgCode]);
      if (org === null) fail('not_found');

      const serviceLine = stringOf(ctx.json['service_line']);
      const effectiveFrom = stringOf(ctx.json['effective_from']);
      const hourlyRateCents = integerFromText(ctx.json['hourly_rate_cents']);
      const mileageCentsPerMile = integerFromText(ctx.json['mileage_cents_per_mile']);

      const line = SERVICE_LINES.find((candidate) => candidate === serviceLine);
      const effectiveDate = effectiveFrom === null ? null : parseCentralDateKey(effectiveFrom);
      if (line !== undefined && effectiveDate !== null) {
        const duplicate = await queryOne<{ id: number }>(
          'select id from rate_cards where org_code = $1 and service_line = $2 and effective_from = $3',
          [org.code, line, effectiveFrom ?? ''],
        );
        if (duplicate !== null) fail('duplicate_rate');
      }

      const errors: Record<string, string> = {};
      if (line === undefined) errors['service_line'] = 'Choose ASL or spoken language.';
      if (effectiveDate === null) {
        errors['effective_from'] = 'Use a date written as YYYY-MM-DD.';
      } else if (centralDateKey(effectiveDate) <= centralDateKey(new Date())) {
        errors['effective_from'] = 'Start the rate on a later date than today.';
      }
      if (hourlyRateCents === null || hourlyRateCents < 1 || hourlyRateCents > 1_000_000) {
        errors['hourly_rate_cents'] = 'Enter an hourly rate from 1 to 1,000,000 cents.';
      }
      if (mileageCentsPerMile === null || mileageCentsPerMile < 0 || mileageCentsPerMile > 1000) {
        errors['mileage_cents_per_mile'] = 'Enter a mileage rate from 0 to 1,000 cents.';
      }
      if (
        line === undefined ||
        effectiveDate === null ||
        hourlyRateCents === null ||
        mileageCentsPerMile === null ||
        Object.keys(errors).length > 0
      ) {
        fail('validation', errors);
      }

      const entry = await insertRateEntry({
        orgCode: org.code,
        serviceLine: line,
        effectiveFrom: centralDateKey(effectiveDate),
        hourlyRateCents,
        mileageCentsPerMile,
      });
      if (entry === null) fail('duplicate_rate');
      await query(
        `insert into audit_log (actor_id, kind, detail) values ($1, 'rate_entry_added', $2::jsonb)`,
        [
          ctx.user.id,
          JSON.stringify({
            org: entry.orgCode,
            service_line: entry.serviceLine,
            effective_from: entry.effectiveFrom,
            hourly_rate_cents: entry.hourlyRateCents,
            mileage_cents_per_mile: entry.mileageCentsPerMile,
          }),
        ],
      );
      return {
        status: 201,
        json: {
          org: entry.orgCode,
          service_line: entry.serviceLine,
          effective_from: entry.effectiveFrom,
          hourly_rate_cents: entry.hourlyRateCents,
          mileage_cents_per_mile: entry.mileageCentsPerMile,
        },
      };
    },
  },
];
