// Billable seconds, billable minutes and integer-cent cost — the single rounding authority.

export type PlanId = 'pilot' | 'scale';

/** Whole billable seconds for one closed session, computed once under the plan in force at its start. */
export function billableSeconds(plan: PlanId, audioMs: number, channels: number): number {
  if (audioMs <= 0) return 0;
  if (plan === 'pilot') {
    return channels * 60 * Math.ceil(audioMs / 60000);
  }
  return channels * Math.max(15, Math.ceil(audioMs / 1000));
}

/** Billable minutes for display: seconds ÷ 60, half-up, two decimals. */
function roundHalfUp2(x: number): number {
  return Math.floor(x * 100 + 0.5) / 100;
}

export function formatBillableMinutes(seconds: number): string {
  return roundHalfUp2(seconds / 60).toFixed(2);
}

export function formatQuotaUsed(usedSeconds: number): string {
  return roundHalfUp2(usedSeconds / 60).toFixed(2);
}

/** The meter format: <used> / <limit> min. */
export function quotaMeterText(usedSeconds: number, limitMinutes: number): string {
  return `${formatQuotaUsed(usedSeconds)} / ${limitMinutes} min`;
}

/** Progressbar value 0-100, half-up, capped. */
export function quotaPercent(usedSeconds: number, limitMinutes: number): number {
  if (limitMinutes <= 0) return 0;
  const p = (usedSeconds / (limitMinutes * 60)) * 100;
  return Math.min(100, Math.round(p));
}

export const PRICE_PER_BILLABLE_MINUTE_CENTS: Record<PlanId, number> = { pilot: 6, scale: 3 };

/** Plan cost in integer cents for a sum of billable seconds: sum × price ÷ 60 rounded up — the only rounding step. */
export function planCostCents(plan: PlanId, billableSecondsSum: number): number {
  if (billableSecondsSum <= 0) return 0;
  return Math.ceil((billableSecondsSum * PRICE_PER_BILLABLE_MINUTE_CENTS[plan]) / 60);
}

export function formatCostCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** The public calculator's valid length: digits, optional decimal point, at most three decimals, 0 to 3600 inclusive. */
export function parseCalculatorSeconds(raw: string): number | null {
  if (!/^\d{1,4}(\.\d{1,3})?$/.test(raw)) return null;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0 || v > 3600) return null;
  return v;
}
