import type { SessionUser } from '../http/context.js';
import { listPolicies } from '../db/repo/policy.js';
import { listTenants } from '../db/repo/tenants.js';
import { toKitchenIso } from '../domain/time.js';
import type {
  BookingRecord,
  DocumentRecord,
  InvoiceRecord,
  LedgerEntryRecord,
  PolicyRecord,
  StationRecord,
} from '../domain/types.js';
import { isApprovedAndValid } from '../domain/documents.js';

export function userJson(user: SessionUser): Record<string, unknown> {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    tenant_id: user.tenantId,
  };
}

export function stationJson(station: StationRecord): Record<string, unknown> {
  return {
    id: station.id,
    name: station.name,
    kind: station.kind,
    hourly_rate_cents: station.hourlyRateCents,
  };
}

export function policyJson(policy: PolicyRecord): Record<string, unknown> {
  return {
    version: policy.version,
    free_window_hours: policy.freeWindowHours,
    late_fee_percent: policy.lateFeePercent,
    effective_at: toKitchenIso(policy.effectiveAt),
  };
}

export interface BookingContext {
  policies: Map<number, PolicyRecord>;
  tenantNames: Map<string, string>;
}

export async function bookingContext(): Promise<BookingContext> {
  const [policies, tenants] = await Promise.all([listPolicies(), listTenants()]);
  return {
    policies: new Map(policies.map((policy) => [policy.version, policy])),
    tenantNames: new Map(tenants.map((tenant) => [tenant.id, tenant.businessName])),
  };
}

export function bookingJson(
  booking: BookingRecord,
  context: BookingContext,
  actor: SessionUser,
): Record<string, unknown> {
  const policy = booking.policyVersion === null ? null : context.policies.get(booking.policyVersion);
  const json: Record<string, unknown> = {
    id: booking.id,
    ref: booking.ref,
    hold_ref: booking.holdRef,
    tenant_id: booking.tenantId,
    station_id: booking.stationId,
    date: booking.date,
    start_local: booking.startLocal,
    end_local: booking.endLocal,
    start: toKitchenIso(booking.startAt),
    end: toKitchenIso(booking.endAt),
    elapsed_minutes: booking.elapsedMinutes,
    status: booking.status,
    pay_with: booking.payWith,
    amount_cents: booking.payWith === 'account' ? booking.amountCents : null,
    policy: policy
      ? {
          version: policy.version,
          free_window_hours: policy.freeWindowHours,
          late_fee_percent: policy.lateFeePercent,
        }
      : null,
    notes: booking.notes,
    checked_in_at: booking.checkedInAt ? toKitchenIso(booking.checkedInAt) : null,
    checked_out_at: booking.checkedOutAt ? toKitchenIso(booking.checkedOutAt) : null,
    holdover:
      booking.holdoverReportedMinutes === null
        ? null
        : {
            reported_minutes: booking.holdoverReportedMinutes,
            billed_minutes: booking.holdoverBilledMinutes,
            amount_cents: booking.holdoverAmountCents,
          },
    cancellation: booking.cancelledAt
      ? {
          cancelled_at: toKitchenIso(booking.cancelledAt),
          late: booking.cancellationLate,
          fee_cents: booking.cancellationFeeCents,
          fee_minutes: booking.cancellationFeeMinutes,
          fee_refunded: booking.cancellationFeeRefunded,
        }
      : null,
    created_at: toKitchenIso(booking.createdAt),
  };
  if (actor.role === 'operator') {
    json['tenant_name'] = context.tenantNames.get(booking.tenantId) ?? booking.tenantId;
  }
  return json;
}

export function documentJson(document: DocumentRecord, today: string): Record<string, unknown> {
  return {
    id: document.id,
    tenant_id: document.tenantId,
    kind: document.kind,
    holder_name: document.holderName,
    expires_on: document.expiresOn,
    status: document.status,
    valid: isApprovedAndValid(document, today),
    file_name: document.fileName,
    content_type: document.contentType,
    size_bytes: document.sizeBytes,
    uploaded_at: toKitchenIso(document.uploadedAt),
    reviewed_at: document.reviewedAt ? toKitchenIso(document.reviewedAt) : null,
    rejection_reason: document.rejectionReason,
  };
}

export function invoiceJson(invoice: InvoiceRecord): Record<string, unknown> {
  return {
    id: invoice.id,
    number: invoice.number,
    tenant_id: invoice.tenantId,
    period: invoice.period,
    status: invoice.status,
    lines: invoice.lines.map((line) => ({
      kind: line.kind,
      description: line.description,
      booking_ref: line.bookingRef,
      amount_cents: line.amountCents,
    })),
    subtotal_cents: invoice.subtotalCents,
    tax_rate_percent: invoice.taxRatePercent,
    tax_cents: invoice.taxCents,
    total_cents: invoice.totalCents,
    issued_at: toKitchenIso(invoice.issuedAt),
    paid_at: invoice.paidAt ? toKitchenIso(invoice.paidAt) : null,
  };
}

export function ledgerEntryJson(entry: LedgerEntryRecord): Record<string, unknown> {
  return {
    id: entry.id,
    movement_id: entry.movementId,
    account: entry.account,
    minutes: entry.minutes,
    reason: entry.reason,
    booking_id: entry.bookingId,
    created_at: toKitchenIso(entry.createdAt),
  };
}
