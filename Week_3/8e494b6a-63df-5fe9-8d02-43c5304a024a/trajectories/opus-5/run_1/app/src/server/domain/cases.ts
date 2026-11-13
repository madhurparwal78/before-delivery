export type CaseStatus = 'open' | 'investigating' | 'resolved' | 'closed';

export const CASE_STATUSES: CaseStatus[] = ['open', 'investigating', 'resolved', 'closed'];

const FORWARD: Record<CaseStatus, CaseStatus | null> = {
  open: 'investigating',
  investigating: 'resolved',
  resolved: 'closed',
  closed: null,
};

/** Rule L: one step forward, or resolved back to investigating. */
export function caseMoveAllowed(from: CaseStatus, to: CaseStatus): boolean {
  if (FORWARD[from] === to) return true;
  return from === 'resolved' && to === 'investigating';
}
