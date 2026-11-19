import type { ClassroomStateName } from './types.js';

// Domain rule: classroom state derived from server time and stored instants.
// Single source of truth — every caller uses this.
export function deriveClassroomState(
  now: Date,
  joinOpensAt: Date,
  joinClosesAt: Date,
  handInAt: Date,
  archived: boolean,
): ClassroomStateName {
  if (archived) return 'archived';
  const t = now.getTime();
  if (t < joinOpensAt.getTime()) return 'draft';
  if (t < joinClosesAt.getTime()) return 'open';
  if (t < handInAt.getTime()) return 'in_session';
  return 'handed_in';
}

export function secondsUntil(now: Date, target: Date): number {
  return Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000));
}

export const CLASSROOM_STATE_LABELS: Record<ClassroomStateName, string> = {
  draft: 'Draft',
  open: 'Open for joining',
  in_session: 'In session',
  handed_in: 'Handed in',
  archived: 'Archived',
};
