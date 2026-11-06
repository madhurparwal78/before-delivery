import { findAssignmentById } from '../db/assignments.js';
import type { Queryable } from '../db/pool.js';
import type { AssignmentRecord } from '../domain/records.js';
import { statusFromSeats } from '../../shared/transitions.js';
import { markBillable } from './billing.js';
import { enqueueCoverageReceipt } from './notifications.js';

/**
 * Brings an assignment's status in line with the state of its seats, and raises the one
 * coverage receipt and the billing readiness that follow from it.
 */
export async function recomputeCoverage(db: Queryable, assignmentId: number): Promise<AssignmentRecord> {
  const current = await findAssignmentById(db, assignmentId);
  const next = statusFromSeats(current.seats.map((seat) => seat.status));
  if (next === current.status) {
    return current;
  }
  await db.query('UPDATE assignments SET status = $1, coverage_round = coverage_round + $2 WHERE id = $3', [
    next,
    next === 'covered' ? 1 : 0,
    assignmentId,
  ]);
  const updated = await findAssignmentById(db, assignmentId);
  if (next === 'covered') {
    await enqueueCoverageReceipt(db, updated);
  }
  if (next === 'verified') {
    await markBillable(db, updated);
  }
  return updated;
}
