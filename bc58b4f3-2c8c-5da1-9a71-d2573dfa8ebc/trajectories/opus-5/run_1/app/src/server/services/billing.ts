import { loadAssignmentInTransaction, lockAssignmentByNumber } from '../db/assignments.js';
import { query, withTransaction } from '../db/pool.js';
import { listRateEntriesIn } from '../db/rateCards.js';
import { chargesFor, isBillable, rateInForce, serviceLineFor, type Charges } from '../domain/charges.js';
import type { AssignmentRecord, RateEntry } from '../domain/types.js';
import { fail } from '../http/errors.js';
import { KillBillUnreachable, postExternalCharge } from './killbill.js';

export interface BillingView {
  status: string;
  invoice_id: string | null;
  total_cents: number | null;
}

export function chargesOf(assignment: AssignmentRecord, rates: readonly RateEntry[]): Charges {
  const rate = rateInForce(rates, assignment.startAt, serviceLineFor(assignment.languageCode));
  return chargesFor(assignment, rate);
}

export interface PostResult {
  status: 200 | 201 | 202;
  billing: BillingView;
}

export async function postAssignmentInvoice(number: string): Promise<PostResult> {
  return withTransaction(async (tx) => {
    const locked = await lockAssignmentByNumber(tx, number);
    if (locked === null) fail('not_found');
    const assignment = await loadAssignmentInTransaction(tx, locked.id);

    if (assignment.billingStatus === 'posted') {
      return {
        status: 200 as const,
        billing: {
          status: 'posted',
          invoice_id: assignment.invoiceId,
          total_cents: assignment.totalCents,
        },
      };
    }
    if (!isBillable(assignment)) fail('not_billable');

    const rates = await listRateEntriesIn(tx, assignment.orgCode);
    const charges = chargesOf(assignment, rates);

    try {
      const invoiceId = await postExternalCharge({
        orgCode: assignment.orgCode,
        orgName: assignment.orgName,
        number: assignment.number,
        kind: charges.kind,
        totalCents: charges.totalCents,
      });
      await tx.query(
        `update assignments
         set billing_status = 'posted', invoice_id = $1, total_cents = $2,
             status = case when status = 'verified' then 'invoiced' else status end
         where id = $3`,
        [invoiceId, charges.totalCents, assignment.id],
      );
      await tx.query(
        `insert into audit_log (kind, assignment_id, detail)
         values ('invoice_posted', $1, $2::jsonb)`,
        [
          assignment.id,
          JSON.stringify({
            invoice_id: invoiceId,
            total_cents: charges.totalCents,
            kind: charges.kind,
          }),
        ],
      );
      return {
        status: 201 as const,
        billing: { status: 'posted', invoice_id: invoiceId, total_cents: charges.totalCents },
      };
    } catch (error) {
      if (!(error instanceof KillBillUnreachable)) throw error;
      await tx.query(
        `update assignments set billing_status = 'queued', total_cents = $1 where id = $2`,
        [charges.totalCents, assignment.id],
      );
      return {
        status: 202 as const,
        billing: { status: 'queued', invoice_id: null, total_cents: charges.totalCents },
      };
    }
  });
}

/** Posts every queued item; runs on its own every BILLING_RETRY_SECONDS. */
export async function postQueuedInvoices(): Promise<void> {
  const rows = await query<{ number: string }>(
    "select number from assignments where billing_status = 'queued' order by id",
  );
  for (const row of rows) {
    await postAssignmentInvoice(row.number);
  }
}
