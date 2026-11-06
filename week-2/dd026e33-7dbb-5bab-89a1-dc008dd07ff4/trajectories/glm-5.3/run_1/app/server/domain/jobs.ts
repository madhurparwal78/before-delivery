/**
 * Workshop job state machine and versions — the single decision place.
 */
export type JobStatus =
  | 'draft'
  | 'sent'
  | 'approved'
  | 'declined'
  | 'expired'
  | 'in_progress'
  | 'finished'
  | 'invoiced'
  | 'paid';

export type JobAction =
  | 'edit'
  | 'send'
  | 'revise'
  | 'approve'
  | 'decline'
  | 'log_stage'
  | 'add_reading'
  | 'finish'
  | 'issue_invoice';

export function jobStatusAllows(action: JobAction, status: JobStatus, isExpired: boolean, hasLines: boolean, hasStages: boolean): { ok: boolean; code?: 'invalid_transition' | 'estimate_expired' } {
  switch (action) {
    case 'edit':
      return status === 'draft' ? { ok: true } : { ok: false, code: 'invalid_transition' };
    case 'send':
      return status === 'draft'
        ? hasLines
          ? { ok: true }
          : { ok: false, code: 'invalid_transition' }
        : { ok: false, code: 'invalid_transition' };
    case 'revise':
      return status === 'declined' || status === 'expired'
        ? { ok: true }
        : { ok: false, code: 'invalid_transition' };
    case 'approve':
    case 'decline':
      if (status !== 'sent') return { ok: false, code: 'invalid_transition' };
      if (isExpired) return { ok: false, code: 'estimate_expired' };
      return { ok: true };
    case 'log_stage':
      return status === 'approved' || status === 'in_progress'
        ? { ok: true }
        : { ok: false, code: 'invalid_transition' };
    case 'add_reading':
      return status === 'in_progress' ? { ok: true } : { ok: false, code: 'invalid_transition' };
    case 'finish':
      return status === 'in_progress' && hasStages
        ? { ok: true }
        : { ok: false, code: 'invalid_transition' };
    case 'issue_invoice':
      return status === 'finished' ? { ok: true } : { ok: false, code: 'invalid_transition' };
  }
}

/** Statuses that block a release while open (`car_in_workshop`). */
export function jobBlocksRelease(status: JobStatus): boolean {
  switch (status) {
    case 'draft':
    case 'sent':
    case 'approved':
    case 'declined':
    case 'expired':
    case 'in_progress':
    case 'finished':
      return true;
    case 'invoiced':
    case 'paid':
      return false;
  }
}

/** Effective status a read should report, applying estimate expiry from time. */
export function effectiveStatus(status: JobStatus, now: number, expiresAt: number | null): JobStatus {
  if (status === 'sent' && expiresAt !== null && now >= expiresAt) {
    return 'expired';
  }
  return status;
}
