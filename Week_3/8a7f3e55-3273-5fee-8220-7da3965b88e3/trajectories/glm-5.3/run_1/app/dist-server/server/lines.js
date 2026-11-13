import { formatInstant } from '../domain/time.js';
export const LINE_SELECT = `
  SELECT line_ref, booking_id, booking_ref, org_id, kind, assignment_date::text AS assignment_date,
         rate_effective_from::text AS rate_effective_from, hourly_rate_cents, team_surcharge_bp,
         basis_minutes, billable_minutes, interpreter_count, time_amount_cents,
         mileage_miles, mileage_cents_per_mile, mileage_amount_cents, amount_cents,
         billing_amount_cents, billing_week::text AS billing_week, sync_status, created_at
  FROM invoice_lines
`;
export function serializeLine(row) {
    return {
        line_ref: row.line_ref,
        booking_id: row.booking_id,
        booking_ref: row.booking_ref,
        org_id: row.org_id,
        kind: row.kind,
        assignment_date: row.assignment_date,
        rate_effective_from: row.rate_effective_from,
        hourly_rate_cents: row.hourly_rate_cents,
        team_surcharge_bp: row.team_surcharge_bp,
        basis_minutes: row.basis_minutes,
        billable_minutes: row.billable_minutes,
        interpreter_count: row.interpreter_count,
        time_amount_cents: row.time_amount_cents,
        mileage_miles: row.mileage_miles,
        mileage_cents_per_mile: row.mileage_cents_per_mile,
        mileage_amount_cents: row.mileage_amount_cents,
        amount_cents: row.amount_cents,
        billing_amount_cents: row.billing_amount_cents,
        billing_week: row.billing_week,
        sync_status: row.sync_status,
        created_at: formatInstant(row.created_at.getTime()),
    };
}
