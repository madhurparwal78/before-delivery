import type { AssignmentView, Role } from '../../shared/contract.js';
import { viewerOf } from '../auth/sessions.js';
import { findAssignmentByNumber } from '../db/assignments.js';
import type { Queryable } from '../db/pool.js';
import { pool } from '../db/pool.js';
import type { AssignmentRecord, Viewer } from '../domain/records.js';
import { assignmentViewFor, viewKindFor, type ViewKind } from '../domain/visibility.js';
import { fail } from '../http/errors.js';
import type { AuthenticatedContext } from '../http/router.js';

export function requireRole(ctx: AuthenticatedContext, roles: readonly Role[]): void {
  if (!roles.includes(ctx.session.user.role)) {
    fail('forbidden');
  }
}

export function requireOrgId(ctx: AuthenticatedContext): number {
  const orgId = ctx.session.user.org_id;
  if (orgId === null) {
    fail('forbidden');
  }
  return orgId;
}

export interface VisibleAssignment {
  record: AssignmentRecord;
  kind: ViewKind;
  viewer: Viewer;
}

/** Loads an assignment as the caller may see it; anything else is simply not there. */
export async function loadVisibleAssignment(
  ctx: AuthenticatedContext,
  db: Queryable = pool,
): Promise<VisibleAssignment> {
  const number = ctx.params['number'] ?? '';
  const record = await findAssignmentByNumber(db, number);
  if (record === null) {
    fail('not_found');
  }
  const viewer = viewerOf(ctx.session);
  const kind = viewKindFor(record, viewer);
  if (kind === null) {
    fail('not_found');
  }
  return { record, kind, viewer };
}

export function viewAs(record: AssignmentRecord, viewer: Viewer): AssignmentView {
  const kind = viewKindFor(record, viewer);
  if (kind === null) {
    throw new Error(`assignment ${record.number} is not visible to user ${viewer.id}`);
  }
  return assignmentViewFor(record, kind);
}

export function seatNumberParam(ctx: AuthenticatedContext): number {
  const raw = ctx.params['seat'] ?? '';
  const seat = Number(raw);
  if (!Number.isInteger(seat)) {
    fail('not_found');
  }
  return seat;
}
