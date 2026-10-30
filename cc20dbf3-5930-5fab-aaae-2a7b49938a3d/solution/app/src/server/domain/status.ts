// Effective statuses, decided once for every query: a ready hold at or past its pickup deadline is
// expired, and a loan still out strictly after its due instant is overdue. Both hold from that instant,
// whether or not the background sweep has run. By convention `$1` is the request's "now".

export const holdStatusSql = (alias = "h") =>
  `(CASE WHEN ${alias}.status = 'ready' AND ${alias}.pickup_deadline <= $1 THEN 'expired' ELSE ${alias}.status END)`;

/** The same overdue rule for an instant known in code: strictly after the due instant. */
export const isOverdueAt = (dueAt: Date, now: Date): boolean => now.getTime() > dueAt.getTime();

export const loanStatusSql = (alias = "l") =>
  `(CASE WHEN ${alias}.status = 'out' AND ${alias}.due_at < $1 THEN 'overdue' ELSE ${alias}.status END)`;
