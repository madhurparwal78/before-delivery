import { authenticateStaff, requireChange } from './auth.js';
import type { Staff } from './auth.js';
import { pool } from './db.js';
import { forbidden, notFound } from './http.js';
import type { Ctx } from './http.js';
import { can, loadRules } from './permissions.js';
import type { Viewer } from './permissions.js';
import { findThread } from './thread-view.js';
import type { ThreadSource } from './thread-view.js';
import type { RuleAction, RuleBody } from '../shared/types.js';

export interface StaffAccess {
  staff: Staff;
  viewer: Viewer;
}

export async function staffAccess(ctx: Ctx, options: { change: boolean }): Promise<StaffAccess> {
  const staff = await authenticateStaff(ctx);
  if (options.change) requireChange(ctx, staff);
  const rules = staff.role === 'moderator' ? ((await loadRules(pool, [staff.id])).get(staff.id) as RuleBody[]) : [];
  return { staff, viewer: { role: staff.role, rules } };
}

export async function readableThread(access: StaffAccess, threadId: string): Promise<ThreadSource> {
  const thread = await findThread(pool, access.staff.gameId, threadId);
  if (!thread || !can(access.viewer, 'read', thread.topic)) throw notFound();
  return thread;
}

export function requireAction(access: StaffAccess, action: RuleAction, thread: ThreadSource): void {
  if (!can(access.viewer, action, thread.topic)) throw forbidden();
}

export function requireDeveloper(staff: Staff): void {
  if (staff.role !== 'developer') throw forbidden();
}
