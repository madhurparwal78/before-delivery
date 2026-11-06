import type { JobStatus } from './types';

export type JobAction =
  | 'edit'
  | 'send'
  | 'revise'
  | 'approve'
  | 'decline'
  | 'log_stage'
  | 'add_reading'
  | 'finish'
  | 'issue_invoice'
  | 'stage_photo';

export interface JobShape {
  readonly status: JobStatus;
  readonly lineCount: number;
  readonly stageCount: number;
}

/** The single decision on which workshop-job moves are legal. */
export function jobActionAllowed(job: JobShape, action: JobAction): boolean {
  switch (action) {
    case 'edit':
      return job.status === 'draft';
    case 'send':
      return job.status === 'draft' && job.lineCount >= 1;
    case 'revise':
      return job.status === 'declined' || job.status === 'expired';
    case 'approve':
    case 'decline':
      return job.status === 'sent';
    case 'log_stage':
      return job.status === 'approved' || job.status === 'in_progress';
    case 'add_reading':
      return job.status === 'in_progress' && job.stageCount >= 1;
    case 'finish':
      return job.status === 'in_progress' && job.stageCount >= 1;
    case 'issue_invoice':
      return job.status === 'finished';
    case 'stage_photo':
      return (
        job.status === 'approved' ||
        job.status === 'in_progress' ||
        job.status === 'finished' ||
        job.status === 'invoiced' ||
        job.status === 'paid'
      );
  }
}

/** The status a legal move leads to. */
export function jobStatusAfter(action: JobAction): JobStatus | null {
  switch (action) {
    case 'edit':
      return 'draft';
    case 'send':
      return 'sent';
    case 'revise':
      return 'draft';
    case 'approve':
      return 'approved';
    case 'decline':
      return 'declined';
    case 'log_stage':
    case 'add_reading':
      return 'in_progress';
    case 'finish':
      return 'finished';
    case 'issue_invoice':
      return 'invoiced';
    case 'stage_photo':
      return null;
  }
}

/** A car may hold only one job between draft and finished. */
export const OPEN_JOB_STATUSES: readonly JobStatus[] = [
  'draft',
  'sent',
  'approved',
  'declined',
  'expired',
  'in_progress',
  'finished',
];
