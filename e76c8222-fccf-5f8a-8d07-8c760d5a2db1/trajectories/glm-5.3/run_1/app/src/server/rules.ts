// Single definitions for every domain rule in the brief. All callers use these.
import type {
  CredentialType, GateResult, Quote, Setting,
} from './types.js';
import { SETTING_CREDENTIALS } from './types.js';
import { centsToMoney, moneyToCents, roundHalfUpCents } from './money.js';
import { MS_PER_MINUTE } from './time.js';

export const TRAVEL_BUFFER_MINUTES = 30;
export const OFFER_LIFETIME_MINUTES = 12 * 60;
export const OFFER_LEAD_MINUTES = 2 * 60;
export const EXPIRY_WARNING_DAYS = 30;
export const MIN_ASSIGNMENT_MINUTES = 30;
export const MAX_ASSIGNMENT_MINUTES = 10 * 60;

// Team rule: two seats for a legal setting or a request longer than two hours.
export function seatTotal(setting: Setting, durationMinutes: number): 1 | 2 {
  return setting === 'legal' || durationMinutes > 120 ? 2 : 1;
}

export interface AssignmentInterval {
  ref: string;
  startMs: number;
  endMs: number;
}

export interface CredentialRecord {
  type: CredentialType;
  expiresOnMs: number;
}

// The four dispatch gates, evaluated in order.
export function evaluateGates(input: {
  setting: Setting;
  credentials: CredentialRecord[];
  endMs: number;
  assignments: AssignmentInterval[];
  startMs: number;
  consumerBlocked: boolean;
  consumerName: string;
}): GateResult[] {
  const accepted = SETTING_CREDENTIALS[input.setting];
  const held = input.credentials.some((c) => accepted.includes(c.type));
  const credential: GateResult = {
    gate: 'credential',
    label: 'Credential',
    pass: held,
    reason: held ? null : `No ${input.setting} credential. Needs one of ${accepted.join(', ')}.`,
  };

  let validity: GateResult;
  if (!credential.pass) {
    validity = { gate: 'validity', label: 'Valid on date', pass: false, reason: 'No credential to check.' };
  } else {
    const relevant = input.credentials.filter((c) => accepted.includes(c.type));
    const latest = relevant.reduce((a, b) => (b.expiresOnMs > a.expiresOnMs ? b : a));
    if (latest.expiresOnMs >= input.endMs) {
      validity = { gate: 'validity', label: 'Valid on date', pass: true, reason: null };
    } else {
      const d = new Date(latest.expiresOnMs);
      const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      validity = {
        gate: 'validity', label: 'Valid on date', pass: false,
        reason: `${latest.type} expires ${dateStr}, before this assignment ends.`,
      };
    }
  }

  const bufferMs = TRAVEL_BUFFER_MINUTES * MS_PER_MINUTE;
  const firstConflict = input.assignments
    .filter((a) => !(a.endMs + bufferMs <= input.startMs || a.startMs - bufferMs >= input.endMs))
    .sort((a, b) => a.startMs - b.startMs)[0];
  const schedule: GateResult = {
    gate: 'schedule',
    label: 'Schedule',
    pass: !firstConflict,
    reason: firstConflict ? `Too close to ${firstConflict.ref}; jobs need a travel buffer.` : null,
  };

  const consumer: GateResult = {
    gate: 'consumer',
    label: 'Consumer',
    pass: !input.consumerBlocked,
    reason: input.consumerBlocked ? `${input.consumerName} has blocked this interpreter.` : null,
  };

  return [credential, validity, schedule, consumer];
}

// Offer expiry: earlier of 12 hours after the pin and 2 hours before the start.
export function offerExpiryMs(pinMs: number, requestStartMs: number | null): number {
  if (requestStartMs === null) return pinMs + OFFER_LIFETIME_MINUTES * MS_PER_MINUTE;
  return Math.min(pinMs + OFFER_LIFETIME_MINUTES * MS_PER_MINUTE, requestStartMs - OFFER_LEAD_MINUTES * MS_PER_MINUTE);
}

// Cancellation window: 48 hours for 2 hours or less, 72 otherwise; exactly on the line is on time.
export function windowHoursForDuration(durationMinutes: number): 48 | 72 {
  return durationMinutes <= 120 ? 48 : 72;
}

export function isLateCancellation(nowMs: number, startMs: number, durationMinutes: number): boolean {
  const window = windowHoursForDuration(durationMinutes);
  return startMs - nowMs < window * 60 * MS_PER_MINUTE;
}

export function inCancellationWindow(nowMs: number, startMs: number, durationMinutes: number): boolean {
  return isLateCancellation(nowMs, startMs, durationMinutes);
}

export interface FeeInputs {
  nowMs: number;
  startMs: number;
  endMs: number;
  seatedCount: number;
  hourlyRateCents: number;
}

// The one fee definition used by both the quote endpoint and cancel.
export function computeQuote(inputs: FeeInputs): Quote {
  const durationMinutes = Math.round((inputs.endMs - inputs.startMs) / MS_PER_MINUTE);
  const window = windowHoursForDuration(durationMinutes);
  const hoursBefore = (inputs.startMs - inputs.nowMs) / (60 * MS_PER_MINUTE);
  const late = isLateCancellation(inputs.nowMs, inputs.startMs, durationMinutes);
  const chargeHours = late ? (durationMinutes <= 120 ? 120 : durationMinutes) : 0;
  const feePer = roundHalfUpCents((chargeHours / 60) * inputs.hourlyRateCents * 100);
  const fee = feePer * inputs.seatedCount;
  return {
    late,
    window_hours: window,
    hours_before_start: hoursToText((inputs.startMs - inputs.nowMs) / (60 * MS_PER_MINUTE)),
    seated: inputs.seatedCount,
    charge_hours_per_interpreter: hoursToText(chargeHours / 60),
    hourly_rate: centsToMoney(inputs.hourlyRateCents),
    fee_per_interpreter: centsToMoney(feePer),
    fee: centsToMoney(fee),
  };
}

export function hoursToText(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  return rounded.toFixed(2);
}

// Billed hours: the larger of 2 and actual time rounded up to the next quarter hour.
export function billedHours(actualStartMs: number, actualEndMs: number): string {
  const minutes = Math.max(0, Math.round((actualEndMs - actualStartMs) / MS_PER_MINUTE));
  const quarters = Math.ceil(minutes / 15);
  const quarterHours = quarters * 15 / 60;
  return hoursToText(Math.max(2, quarterHours));
}

export function billedHoursCentsOfHours(billedHoursText: string): number {
  return Math.round(Number(billedHoursText) * 60);
}

export function amountFor(billedHoursText: string, hourlyRateCents: number): number {
  return roundHalfUpCents(billedHoursCentsOfHours(billedHoursText) * hourlyRateCents * 100);
}

export function credentialStatus(expiresOnMs: number, nowMs: number): 'valid' | 'expiring' | 'expired' {
  const dayMs = 86_400_000;
  const todayMs = Math.floor(nowMs / dayMs) * dayMs;
  if (expiresOnMs < todayMs) return 'expired';
  if (expiresOnMs <= todayMs + EXPIRY_WARNING_DAYS * dayMs) return 'expiring';
  return 'valid';
}

export function chargeKeyForTimesheet(timesheetId: string): string {
  return `ts-${timesheetId}`;
}

export function chargeKeyForCancellation(requestId: string): string {
  return `cx-${requestId}`;
}
