
export const addonState = (
  sub: { entitlement_state?: string | null; billing_end_date?: string | null },
): { state: 'active' | 'ending'; period_end: Date | null } => {
  // Kill Bill answers with an ACTIVE subscription and a billing end date once the term is cancelled.
  if (sub.billing_end_date) {
    const periodEnd = new Date(`${sub.billing_end_date}T00:00:00Z`);
    return { state: periodEnd.getTime() > Date.now() ? 'ending' : 'active', period_end: periodEnd };
  }
  return { state: 'active', period_end: null };
};

export interface EntitlementSnapshot {
  state: 'none' | 'active' | 'ending' | 'grace' | 'lapsed';
  period_end: Date | null;
  checked_at: Date;
  source: 'killbill' | 'cache';
}

export const freshSnapshot = (sub: { entitlement_state?: string | null; billing_end_date?: string | null } | null): EntitlementSnapshot => {
  if (!sub) return { state: 'none', period_end: null, checked_at: new Date(), source: 'killbill' };
  const s = addonState(sub);
  return { state: s.state, period_end: s.period_end, checked_at: new Date(), source: 'killbill' };
};

export const deadlineWith = (period_end: Date | null, calendarDays: number, overrideSeconds?: number): Date | null => {
  if (!period_end) return null;
  if (overrideSeconds !== undefined) return new Date(period_end.getTime() + overrideSeconds * 1000);
  const d = new Date(period_end);
  d.setUTCDate(d.getUTCDate() + calendarDays);
  return d;
};

