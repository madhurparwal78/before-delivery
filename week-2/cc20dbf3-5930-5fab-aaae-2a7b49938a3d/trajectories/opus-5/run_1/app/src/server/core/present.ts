import type { LibraryCalendar } from '../../domain/calendar.js';
import { spanBackOn, type OccupyingSpan } from '../../domain/occupancy.js';
import { effectiveHoldStatus, effectiveLoanStatus } from '../../domain/states.js';
import type {
  Hold,
  Item,
  LedgerEntry,
  Loan,
  Photo,
  Settlement,
  Span,
  Unit,
  User,
} from '../../shared/api.js';
import type { Caller } from '../http/context.js';
import type { ItemRecord, UnitRecord } from './catalogue.js';
import type { HoldRecord, LoanRecord, PhotoRecord, SettlementRecord, UnitDetails } from './records.js';

/** Staff means volunteer or founder. */
export function isStaff(caller: Caller): boolean {
  return caller.role === 'volunteer' || caller.role === 'founder';
}

export function presentUser(caller: Caller): User {
  return { id: caller.id, name: caller.name, role: caller.role };
}

export function presentUnit(unit: UnitRecord | UnitDetails): Unit {
  return { id: unit.id, label: unit.label, lane_index: unit.laneIndex };
}

export function presentItem(item: ItemRecord, unitCount: number, unitsFreeToday: number): Item {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    deposit_cents: item.depositCents,
    replacement_cents: item.replacementCents,
    unit_count: unitCount,
    units_free_today: unitsFreeToday,
  };
}

/** Members see only when a unit is busy and back; staff also see the borrower's name. */
export function presentSpan(
  calendar: LibraryCalendar,
  span: OccupyingSpan,
  caller: Caller,
): Span {
  const base: Span = {
    start_date: span.startDate,
    end_date: span.endDate,
    status: span.status,
    back_on: spanBackOn(calendar, span),
    mine: span.memberId === caller.id,
  };
  if (!isStaff(caller)) return base;
  return {
    ...base,
    borrower: { name: span.memberName },
    record: { type: span.recordType, id: span.recordId },
  };
}

export function presentHold(hold: HoldRecord, now: Date): Hold {
  return {
    id: hold.id,
    item: { id: hold.itemId, name: hold.itemName },
    unit: presentUnit(hold.unit),
    member: { id: hold.memberId, name: hold.memberName },
    status: effectiveHoldStatus(hold.storedStatus, hold.pickupDeadline, now),
    start_date: hold.startDate,
    end_date: hold.endDate,
    ready_at: hold.readyAt === null ? null : hold.readyAt.toISOString(),
    pickup_deadline: hold.pickupDeadline === null ? null : hold.pickupDeadline.toISOString(),
    created_at: hold.createdAt.toISOString(),
  };
}

export function presentPhoto(photo: PhotoRecord): Photo {
  return {
    id: photo.id,
    stage: photo.stage,
    content_type: photo.contentType,
    size_bytes: photo.sizeBytes,
    url: `/api/loans/${photo.loanId}/photos/${photo.id}`,
  };
}

export function presentSettlement(loanId: string, settlement: SettlementRecord): Settlement {
  return {
    loan_id: loanId,
    deposit_cents: settlement.depositCents,
    released_cents: settlement.releasedCents,
    damage_cents: settlement.damageCents,
    damage_from_deposit_cents: settlement.damageFromDepositCents,
    extra_damage_cents: settlement.extraDamageCents,
    late_days: settlement.lateDays,
    late_fee_cents: settlement.lateFeeCents,
    total_charged_cents: settlement.totalChargedCents,
    settled_at: settlement.settledAt.toISOString(),
  };
}

export function presentLoan(loan: LoanRecord, now: Date): Loan {
  return {
    id: loan.id,
    item: { id: loan.itemId, name: loan.itemName },
    unit: presentUnit(loan.unit),
    member: { id: loan.memberId, name: loan.memberName },
    hold_id: loan.holdId,
    status: effectiveLoanStatus(loan.storedStatus, loan.dueAt, now),
    checked_out_at: loan.checkedOutAt.toISOString(),
    due_date: loan.dueDate,
    due_at: loan.dueAt.toISOString(),
    renewed_at: loan.renewedAt === null ? null : loan.renewedAt.toISOString(),
    returned_at: loan.returnedAt === null ? null : loan.returnedAt.toISOString(),
    on_time: loan.onTime,
    late_days: loan.lateDays,
    deposit_cents: loan.depositCents,
    replacement_cents: loan.replacementCents,
    inspection:
      loan.inspection === null
        ? null
        : {
            outcome: loan.inspection.outcome,
            note: loan.inspection.note,
            inspected_at: loan.inspection.inspectedAt.toISOString(),
          },
    settlement: loan.settlement === null ? null : presentSettlement(loan.id, loan.settlement),
    photos: loan.photos.map(presentPhoto),
  };
}

export interface LedgerEntryRecord {
  readonly id: string;
  readonly loanId: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly kind: LedgerEntry['kind'];
  readonly amountCents: number;
  readonly createdAt: Date;
}

export function presentLedgerEntry(entry: LedgerEntryRecord): LedgerEntry {
  return {
    id: entry.id,
    loan_id: entry.loanId,
    item: { id: entry.itemId, name: entry.itemName },
    kind: entry.kind,
    amount_cents: entry.amountCents,
    created_at: entry.createdAt.toISOString(),
  };
}
