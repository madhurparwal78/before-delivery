import { config } from '../config';
import type { RunStatus, StepStatus } from '../../shared/types';

const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['waiting', 'succeeded', 'failed', 'cancelled'],
  waiting: ['running', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

const STEP_TRANSITIONS: Record<StepStatus, readonly StepStatus[]> = {
  pending: ['running', 'skipped'],
  running: ['succeeded', 'failed', 'retrying', 'waiting', 'cancelled'],
  waiting: ['succeeded', 'cancelled'],
  retrying: ['running', 'cancelled'],
  /* A step may run again for the next loop iteration, and a loop the step limit
     interrupted becomes failed. */
  succeeded: ['running', 'failed'],
  failed: ['running'],
  skipped: [],
  cancelled: [],
};

export function runTransitionAllowed(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function stepTransitionAllowed(from: StepStatus, to: StepStatus): boolean {
  return STEP_TRANSITIONS[from].includes(to);
}

export function isRunFinished(status: RunStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled';
}

/** The retry rule: one first attempt plus RETRY_COUNT retries, RETRY_DELAY_SECONDS apart. */
export const totalAttempts = config.retryCount + 1;

export function hasAttemptsLeft(attemptsSoFar: number): boolean {
  return attemptsSoFar < totalAttempts;
}

export const retryDelaySeconds = config.retryDelaySeconds;

/** The step limit: executions one run may make. */
export function exceedsStepLimit(executionsSoFar: number): boolean {
  return executionsSoFar + 1 > config.stepLimit;
}
