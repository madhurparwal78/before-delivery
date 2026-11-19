import { now, isoAt } from './clock.js';
import {
  nyParts, nyDateStr, nyMidnightUtcMs, firstBusinessDayOnOrAfter,
  nthBusinessDayAfter, addCalendarDays, dateStr, dateFromStr, isBusinessDay,
} from './calendar.js';
import { APPROVAL_THRESHOLD_CENTS, DUAL_APPROVAL_THRESHOLD_CENTS } from './config.js';

// One place decides the approval and dual-approval thresholds.
export { APPROVAL_THRESHOLD_CENTS, DUAL_APPROVAL_THRESHOLD_CENTS };

export function businessNowMs() {
  return now();
}

export function businessDate() {
  return nyDateStr(businessNowMs());
}

// The effective date a direct send or a final approval gets at the given
// posting instant. Cuttoffs are New York local, judged on that instant's own
// daylight-saving state.
export function effectiveDateForPost(method, atMs) {
  const p = nyParts(atMs);
  const today = dateStr(p.y, p.m, p.d);
  if (method === 'rtp') return today;
  if (method === 'check') return firstBusinessDayOnOrAfter(addCalendarDays(today, 1));
  const cutoffHour = method === 'ach' ? 16 : 17;
  const beforeCutoff = p.hh < cutoffHour; // exclusive edge
  const todayIsBusiness = isBusinessDay(today);
  if (beforeCutoff && todayIsBusiness) return today;
  return firstBusinessDayOnOrAfter(addCalendarDays(today, 1));
}

// The effective date stored when a payment is scheduled.
export function effectiveDateForSchedule(method, scheduledFor) {
  if (method === 'rtp') return scheduledFor;
  return firstBusinessDayOnOrAfter(scheduledFor);
}

// A preview of what a direct send would get now, plus the next instant any of
// the four dates would change.
export function settlementPreview() {
  const atMs = businessNowMs();
  const dates = {};
  for (const m of ['ach', 'wire', 'rtp', 'check']) dates[m] = effectiveDateForPost(m, atMs);
  return {
    dates,
    changeAtMs: nextSettlementChangeMs(atMs, dates),
  };
}

// The earliest instant after atMs at which some settlement date differs. It is
// always a 16:00 or 17:00 New York cutoff or a New York midnight, each resolved
// by that date's own daylight-saving rule.
export function nextSettlementChangeMs(atMs, dates) {
  const p = nyParts(atMs);
  const today = dateStr(p.y, p.m, p.d);
  const candidates = [];
  const pushCutoff = (hour, baseDate) => {
    const { y, m, d } = dateFromStr(baseDate);
    const ms = nyMidnightUtcMs(y, m, d);
    if (ms === null) return;
    candidates.push(ms + hour * 3600 * 1000);
  };
  const nextDay = addCalendarDays(today, 1);
  if (dates.ach !== undefined) {
    pushCutoff(16, today);
    pushCutoff(17, today);
  }
  const midnight = nyMidnightUtcMs(...(() => { const q = dateFromStr(nextDay); return [q.y, q.m, q.d]; })());
  if (midnight !== null) candidates.push(midnight);
  let best = null;
  for (const c of candidates) {
    if (c > atMs && (best === null || c < best)) best = c;
  }
  if (best !== null) return best;
  // Fall back to the next day's midnight if nothing beat atMs (cannot happen
  // in practice: midnight of tomorrow always follows).
  const q = dateFromStr(addCalendarDays(nextDay, 1));
  return nyMidnightUtcMs(q.y, q.m, q.d);
}

// Approval expiry: 00:00 New York on the fifth Federal Reserve business day
// strictly after the New York creation date.
export function approvalExpiry(createdAtMs) {
  const createdNy = nyDateStr(createdAtMs);
  const expiryDate = nthBusinessDayAfter(createdNy, 5);
  const q = dateFromStr(expiryDate);
  const expiresAtMs = nyMidnightUtcMs(q.y, q.m, q.d);
  const approveBy = addCalendarDays(expiryDate, -1);
  return {
    expires_at: isoAt(expiresAtMs),
    approve_by: approveBy,
    expiresAtMs,
  };
}

export function approvalsRequiredFor(amountCents) {
  if (amountCents <= APPROVAL_THRESHOLD_CENTS) return 0;
  if (amountCents <= DUAL_APPROVAL_THRESHOLD_CENTS) return 1;
  return 2;
}
