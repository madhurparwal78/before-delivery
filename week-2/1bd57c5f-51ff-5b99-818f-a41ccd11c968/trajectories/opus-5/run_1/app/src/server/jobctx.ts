import type { JobRole } from '../shared/domain.js';
import type { Account } from './auth.js';
import type { Queryable } from './db.js';
import { fail } from './errors.js';
import { loadJob, loadMembers, type JobRecord, type MemberRecord, type Viewer } from './model.js';

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function requireUuid(value: string): string {
  if (!isUuid(value)) fail('not_found');
  return value;
}

export type JobContext = {
  job: JobRecord;
  viewer: Viewer;
  members: MemberRecord[];
  membership: MemberRecord;
};

/**
 * Resolves the job and the caller's standing on it. A job the caller never held a role on
 * is indistinguishable from a missing one; a role that has ended answers `role_ended`.
 */
export async function requireJob(
  tx: Queryable,
  account: Account,
  jobId: string,
): Promise<JobContext> {
  requireUuid(jobId);
  const job = await loadJob(tx, jobId);
  if (job === null) fail('not_found');
  const all = await loadMembers(tx, jobId, true);
  const membership = all.find((member) => member.personId === account.person.id);
  if (membership === undefined) fail('not_found');
  if (!membership.active) fail('role_ended');
  return {
    job,
    viewer: {
      personId: account.person.id,
      role: membership.role,
      trade: membership.trade,
      memberId: membership.id,
      name: membership.name,
    },
    members: all.filter((member) => member.active),
    membership,
  };
}

export function requireRole(ctx: JobContext, roles: JobRole[]): void {
  if (!roles.includes(ctx.viewer.role)) fail('forbidden');
}

export function requireOpenJob(ctx: JobContext): void {
  if (ctx.job.status === 'closed_out') fail('job_closed');
}

export function memberById(ctx: JobContext, memberId: string): MemberRecord {
  requireUuid(memberId);
  const member = ctx.members.find((candidate) => candidate.id === memberId);
  if (member === undefined) fail('not_found');
  return member;
}
