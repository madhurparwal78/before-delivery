import type { KernelStatus, RunResultStatus, RunState } from '../shared/types.js';
import { conflict } from './errors.js';

export type RunRecordState = RunState | 'cancelled';

const illegal = (from: string, to: string): never => {
  throw conflict('illegal_transition', { from, to });
};

/** A new run may be queued from any cell state except queued and running. */
export function assertCanQueue(cellRunState: RunState): void {
  if (cellRunState === 'queued' || cellRunState === 'running') illegal(cellRunState, 'queued');
}

export function assertCanStart(runState: RunRecordState): void {
  if (runState !== 'queued') illegal(runState, 'running');
}

export function assertCanResult(runState: RunRecordState, status: RunResultStatus): void {
  const needs: RunRecordState = status === 'not_run' || status === 'cancelled' ? 'queued' : 'running';
  if (runState !== needs) illegal(runState, status);
}

const KERNEL_MOVES: Record<KernelStatus, KernelStatus[]> = {
  starting: ['idle', 'restarting'],
  idle: ['busy', 'restarting'],
  busy: ['idle', 'interrupted', 'restarting'],
  interrupted: ['busy', 'idle', 'restarting'],
  restarting: ['idle', 'restarting'],
};

/** The kernel status moves a tab may report for its own kernel. */
export function assertKernelTransition(from: KernelStatus | null, to: KernelStatus): void {
  if (from === null) return;
  if (from === to) return;
  if (!KERNEL_MOVES[from].includes(to)) illegal(from, to);
}

/**
 * The cell state a run result leaves behind. A cancelled run returns the cell
 * to the state it had before it was queued.
 */
export function cellStateAfterResult(status: RunResultStatus, stateBeforeQueue: RunState): RunState {
  return status === 'cancelled' ? stateBeforeQueue : status;
}

/** A run that ends finished, failed or interrupted takes the next number. */
export function takesExecutionCount(status: RunResultStatus): boolean {
  return status === 'finished' || status === 'failed' || status === 'interrupted';
}
