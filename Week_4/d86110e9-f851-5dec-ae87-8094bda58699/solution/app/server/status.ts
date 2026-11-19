import type { RunStatus, StepStatus } from './model.js';

/** Allowed run status transitions. A run that has finished never changes again. */
const RUN_NEXT: Record<RunStatus, readonly RunStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['waiting', 'succeeded', 'failed', 'cancelled'],
  waiting: ['running', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

/** Allowed step status transitions. A loop body step that finished may start again for its next iteration. */
const STEP_NEXT: Record<StepStatus, readonly StepStatus[]> = {
  pending: ['running', 'skipped'],
  running: ['succeeded', 'failed', 'retrying', 'waiting'],
  retrying: ['running', 'cancelled'],
  waiting: ['succeeded', 'cancelled'],
  succeeded: ['running'],
  failed: ['running'],
  skipped: [],
  cancelled: [],
};

export function isFinishedRun(status: RunStatus): boolean {
  return RUN_NEXT[status].length === 0;
}

export function canMoveRun(from: RunStatus, to: RunStatus): boolean {
  return RUN_NEXT[from].includes(to);
}

function canMoveStep(from: StepStatus, to: StepStatus): boolean {
  return STEP_NEXT[from].includes(to);
}

export function moveRun(from: RunStatus, to: RunStatus): RunStatus {
  if (!canMoveRun(from, to)) throw new Error(`Run cannot move from ${from} to ${to}`);
  return to;
}

export function moveStep(from: StepStatus, to: StepStatus): StepStatus {
  if (!canMoveStep(from, to)) throw new Error(`Step cannot move from ${from} to ${to}`);
  return to;
}

export const ACTIVE_RUN: readonly RunStatus[] = ['queued', 'running', 'waiting'];
export const ALL_RUN_STATUSES: readonly RunStatus[] = ['queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled'];

/** A step asleep until a timer fires: waiting out a wait step or retrying after a failure. */
export function isSleeping(status: StepStatus): boolean {
  return status === 'waiting' || status === 'retrying';
}
