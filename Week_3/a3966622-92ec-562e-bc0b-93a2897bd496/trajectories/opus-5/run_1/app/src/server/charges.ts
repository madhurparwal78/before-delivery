import { formatInstantSeconds, instantToWall } from '../domain/porttime.ts';
import { type BillingEventKind, billingEventLines, linesTotal } from '../domain/tariff.ts';
import {
  detentionBilledHalfHours,
  moveBoardingInstant,
  revisionForBoarding,
} from './derive.ts';
import type { InvoiceRecord, MoveRecord, StoreState } from './store/types.ts';

export type BillingEventInput = {
  state: StoreState;
  move: MoveRecord;
  kind: BillingEventKind;
  now: number;
  detentionUnitSeconds: number;
  nextId: (counter: string, prefix: string) => string;
};

/** Each billing event computes its lines once, stores them, and posts them as its own invoice. */
export function recordBillingEvent(input: BillingEventInput): InvoiceRecord {
  const { state, move, kind, now } = input;
  const boarding = moveBoardingInstant(move);
  const revision = revisionForBoarding(state, boarding);
  const detentionHalfHours =
    kind === 'Completed'
      ? detentionBilledHalfHours(state, move, now, input.detentionUnitSeconds)
      : 0;
  const lines = billingEventLines(kind, revision, {
    draught_mm: move.draught_mm,
    gross_tonnage: move.gross_tonnage,
    boarding: instantToWall(boarding),
    detention_half_hours: detentionHalfHours,
    late_amendments: move.late_amendments,
  });
  move.late_amendments = 0;
  const invoice: InvoiceRecord = {
    id: input.nextId('invoice', 'INV'),
    move_ref: move.ref,
    agency_code: move.agency_code,
    event_kind: kind,
    state: 'pending',
    number: null,
    balance_cents: null,
    balance_confirmed_at: null,
    lines,
    total_cents: linesTotal(lines),
    charge_state: 'pending',
    killbill_invoice_id: null,
    issue_requested: false,
    created_at: formatInstantSeconds(now),
  };
  state.invoices.push(invoice);
  state.steps.push({
    id: `ST-${invoice.id}-charge`,
    kind: 'charge_post',
    target_id: invoice.id,
    state: 'pending',
    attempts: 0,
    last_attempt_at: null,
    last_error: null,
  });
  move.billing_events.push({
    kind,
    at: formatInstantSeconds(now),
    invoice_id: invoice.id,
  });
  return invoice;
}
