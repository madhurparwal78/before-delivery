import type { AssignmentRecord } from './records.js';
import { UNCOVERED_COUNTING_STATUSES } from '../../shared/transitions.js';

/** Open-seat minutes across the assignments handed in: duration × open seats. */
export function uncoveredMinutesOf(records: readonly AssignmentRecord[]): number {
  return records
    .filter((record) => UNCOVERED_COUNTING_STATUSES.includes(record.status))
    .reduce(
      (total, record) =>
        total + record.duration_minutes * record.seats.filter((seat) => seat.status === 'open').length,
      0,
    );
}
