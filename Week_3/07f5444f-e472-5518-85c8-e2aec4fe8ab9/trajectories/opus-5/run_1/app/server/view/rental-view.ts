import type { RentalSet } from '../../shared/api.js';
import { isoWithLondonOffset } from '../../shared/london.js';
import type { RentalAggregate } from '../data/rentals.js';
import { dueAtMs, dueDateOf, isOverdue } from '../domain/rental-dates.js';
import { RENTAL_STATUS_LABELS } from '../domain/transitions.js';

export function copiesMissing(aggregate: RentalAggregate): { part_id: string; part_name: string; missing: number }[] {
  return aggregate.slip
    .filter((line) => line.checked_in < line.copies)
    .map((line) => ({ part_id: line.part_id, part_name: line.part_name, missing: line.copies - line.checked_in }));
}

export function rentalSetView(aggregate: RentalAggregate, todayBusinessDate: string): RentalSet {
  const dueDate = dueDateOf(aggregate.finalPerformanceDate);
  const dueAt = dueAtMs(dueDate);
  const overdue = isOverdue(aggregate.row.status, dueDate, todayBusinessDate);
  const onSlip = aggregate.slip.reduce((total, line) => total + line.copies, 0);
  const checkedIn = aggregate.slip.reduce((total, line) => total + line.checked_in, 0);
  const queued = aggregate.reminders.filter((reminder) => reminder.status === 'queued').length;
  const sentTimes = aggregate.reminders
    .filter((reminder) => reminder.status === 'sent' && reminder.sent_at !== null)
    .map((reminder) => (reminder.sent_at as Date).getTime());
  const reminderStatus =
    aggregate.reminders.length === 0 ? 'none' : queued > 0 ? 'queued' : 'sent';
  const returnedAt = aggregate.row.returned_at;
  return {
    id: aggregate.row.id,
    work_id: aggregate.row.programme_work_id,
    work_title: aggregate.row.work_title,
    programme_id: aggregate.row.programme_id,
    programme_number: String(aggregate.row.programme_number).padStart(2, '0'),
    publisher: aggregate.row.publisher,
    status: aggregate.row.status,
    display_status: overdue ? 'Overdue' : RENTAL_STATUS_LABELS[aggregate.row.status],
    overdue,
    final_performance_date: aggregate.finalPerformanceDate,
    due_date: dueDate,
    due_at: isoWithLondonOffset(dueAt),
    slip: aggregate.slip.map((line) => ({
      part_id: line.part_id,
      part_name: line.part_name,
      copies: line.copies,
      checked_in: line.checked_in,
    })),
    copies_on_slip: onSlip,
    copies_checked_in: checkedIn,
    copies_missing: onSlip - checkedIn,
    reminder: {
      status: reminderStatus,
      sent_at:
        reminderStatus === 'sent' && sentTimes.length > 0
          ? isoWithLondonOffset(Math.max(...sentTimes))
          : null,
    },
    returned_at: returnedAt === null ? null : isoWithLondonOffset(returnedAt.getTime()),
    returned_late: returnedAt !== null && returnedAt.getTime() > dueAt,
  };
}
