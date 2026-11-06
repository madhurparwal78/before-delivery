import type { BillingQueueItem, RateCardEntry, ServiceLine } from '../../shared/contract.js';
import { agencyDateString, parseDateString, toAgencyIso } from '../../shared/zone.js';
import { queryAssignments } from '../db/assignments.js';
import { pool } from '../db/pool.js';
import { billableKindOf } from '../domain/billing.js';
import { fail } from '../http/errors.js';
import type { Reply, Route } from '../http/router.js';
import { FieldErrors, integerField, parseJsonBody, stringField } from '../http/validation.js';
import { chargesFor, postInvoice } from '../services/billing.js';
import { loadVisibleAssignment, requireRole } from './support.js';

const SERVICE_LINES: readonly ServiceLine[] = ['asl', 'spoken'];

const assignmentCharges: Route = {
  method: 'GET',
  pattern: '/api/assignments/:number/charges',
  body: 'none',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    const { record } = await loadVisibleAssignment(ctx);
    requireRole(ctx, ['billing_lead']);
    const charges = await chargesFor(pool, record);
    if (charges === null) {
      fail('not_billable');
    }
    return { status: 200, body: charges };
  },
};

const postAssignmentInvoice: Route = {
  method: 'POST',
  pattern: '/api/assignments/:number/invoice',
  body: 'json',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    const { record } = await loadVisibleAssignment(ctx);
    requireRole(ctx, ['billing_lead']);
    const result = await postInvoice(record.number, ctx.session.user.id);
    if (result === null) {
      fail('not_billable');
    }
    const status = result.outcome === 'posted' ? 201 : result.outcome === 'already_posted' ? 200 : 202;
    return { status, body: { billing: result.billing } };
  },
};

const billingQueue: Route = {
  method: 'GET',
  pattern: '/api/billing/queue',
  body: 'none',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    requireRole(ctx, ['billing_lead']);
    const records = await queryAssignments(pool, { billingStatuses: ['ready', 'queued', 'posted'] });
    const items: BillingQueueItem[] = [];
    for (const record of records) {
      const kind = billableKindOf(record);
      if (kind === null) {
        continue;
      }
      items.push({
        number: record.number,
        org_code: record.org_code,
        kind,
        start_at: toAgencyIso(record.start_at),
        total_cents: record.total_cents ?? 0,
        billing: {
          status: record.billing_status,
          invoice_id: record.invoice_id,
          total_cents: record.total_cents,
        },
      });
    }
    return { status: 200, body: { items } };
  },
};

async function orgIdForCode(code: string): Promise<number> {
  const result = await pool.query<{ id: number }>('SELECT id FROM orgs WHERE code = $1', [code]);
  const id = result.rows[0]?.id;
  if (id === undefined) {
    fail('not_found');
  }
  return id;
}

const listRateCards: Route = {
  method: 'GET',
  pattern: '/api/rate-cards',
  body: 'none',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    requireRole(ctx, ['billing_lead']);
    const code = ctx.query.get('org') ?? '';
    const orgId = await orgIdForCode(code);
    const result = await pool.query<RateCardEntry>(
      `SELECT $1::text AS org, service_line, effective_from, hourly_rate_cents, mileage_cents_per_mile
       FROM rate_cards WHERE org_id = $2 ORDER BY effective_from ASC, service_line ASC`,
      [code, orgId],
    );
    return { status: 200, body: { entries: result.rows } };
  },
};

const addRateCard: Route = {
  method: 'POST',
  pattern: '/api/rate-cards',
  body: 'json',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    requireRole(ctx, ['billing_lead']);
    const body = parseJsonBody(ctx.rawBody);
    const code = stringField(body, 'org');
    const orgId = await orgIdForCode(code);

    const errors = new FieldErrors();
    const serviceLineRaw = stringField(body, 'service_line');
    const serviceLine = SERVICE_LINES.includes(serviceLineRaw as ServiceLine)
      ? (serviceLineRaw as ServiceLine)
      : null;
    if (serviceLine === null) {
      errors.add('service_line', 'Choose ASL or spoken.');
    }
    const effectiveFromRaw = stringField(body, 'effective_from');
    const effectiveFrom = parseDateString(effectiveFromRaw);
    if (effectiveFrom === null || effectiveFromRaw <= agencyDateString(new Date())) {
      errors.add('effective_from', 'Choose a date later than today.');
    }
    const hourlyRateCents = integerField(body, 'hourly_rate_cents');
    if (hourlyRateCents === null || hourlyRateCents < 1 || hourlyRateCents > 1_000_000) {
      errors.add('hourly_rate_cents', 'Give an hourly rate from 1 to 1,000,000 cents.');
    }
    const mileageCentsPerMile = integerField(body, 'mileage_cents_per_mile');
    if (mileageCentsPerMile === null || mileageCentsPerMile < 0 || mileageCentsPerMile > 1000) {
      errors.add('mileage_cents_per_mile', 'Give mileage from 0 to 1,000 cents per mile.');
    }

    const duplicate =
      serviceLine !== null && effectiveFrom !== null
        ? await pool.query(
            'SELECT 1 FROM rate_cards WHERE org_id = $1 AND service_line = $2 AND effective_from = $3::date',
            [orgId, serviceLine, effectiveFromRaw],
          )
        : null;
    if (duplicate !== null && duplicate.rows.length > 0) {
      fail('duplicate_rate');
    }
    errors.throwIfAny();
    if (serviceLine === null || hourlyRateCents === null || mileageCentsPerMile === null) {
      throw new Error('validated rate input is incomplete');
    }

    const inserted = await pool.query<RateCardEntry>(
      `INSERT INTO rate_cards (org_id, service_line, effective_from, hourly_rate_cents, mileage_cents_per_mile)
       VALUES ($1, $2, $3::date, $4, $5)
       RETURNING $6::text AS org, service_line, effective_from, hourly_rate_cents, mileage_cents_per_mile`,
      [orgId, serviceLine, effectiveFromRaw, hourlyRateCents, mileageCentsPerMile, code],
    );
    const entry = inserted.rows[0];
    if (entry === undefined) {
      throw new Error('rate card insert returned nothing');
    }
    await pool.query(
      "INSERT INTO audit_entries (kind, actor_id, detail) VALUES ('rate_card_added', $1, $2)",
      [ctx.session.user.id, JSON.stringify(entry)],
    );
    return { status: 201, body: entry };
  },
};

export const billingRoutes = [
  assignmentCharges,
  postAssignmentInvoice,
  billingQueue,
  listRateCards,
  addRateCard,
];
