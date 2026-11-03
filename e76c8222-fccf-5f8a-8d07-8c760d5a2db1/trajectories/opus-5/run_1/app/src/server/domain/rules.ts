import {
  CredentialStatus,
  GATE_LABELS,
  GateResult,
  Quote,
  RequestStatus,
  SETTING_CREDENTIALS,
  Setting,
  CredentialType,
} from '../../shared/types';
import { divideHalfUp, formatCents, formatMinutesAsHours } from '../../shared/money';
import { agencyDateOf } from '../../shared/time';

export const TRAVEL_BUFFER_MINUTES = 30;
export const OFFER_WINDOW_HOURS = 12;
export const OFFER_LEAD_HOURS = 2;
export const CREDENTIAL_WARNING_DAYS = 30;
export const MINIMUM_BILLED_QUARTERS = 8;
export const SHORT_REQUEST_MINUTES = 120;

/** Team rule: over two hours, or any legal assignment, needs two seats. */
export function seatsRequired(setting: Setting, durationMinutes: number): number {
  return durationMinutes > SHORT_REQUEST_MINUTES || setting === 'legal' ? 2 : 1;
}

export const CANCELLABLE_STATUSES: readonly RequestStatus[] = [
  'draft',
  'submitted',
  'partially_staffed',
  'staffed',
];

export const PREP_UPLOAD_STATUSES: readonly RequestStatus[] = [
  'draft',
  'submitted',
  'partially_staffed',
  'staffed',
];

export const DISPATCHABLE_STATUSES: readonly RequestStatus[] = ['submitted', 'partially_staffed'];

/** The status a request has, derived from its seats, its times and its timesheets. */
export function deriveRequestStatus(input: {
  stored: RequestStatus;
  seatsTotal: number;
  seatsAccepted: number;
  approvedTimesheets: number;
  endAt: Date;
  now: Date;
}): RequestStatus {
  const { stored } = input;
  if (stored === 'draft' || stored === 'cancelled_on_time' || stored === 'cancelled_late') {
    return stored;
  }
  if (input.seatsAccepted < input.seatsTotal) {
    return input.seatsAccepted > 0 ? 'partially_staffed' : 'submitted';
  }
  if (input.now.getTime() < input.endAt.getTime()) return 'staffed';
  if (input.approvedTimesheets >= input.seatsTotal) return 'invoiced';
  return 'completed';
}

/** Offer expiry: the earlier of twelve hours from the pin and two hours before the start. */
export function offerExpiresAt(input: { now: Date; startAt: Date; loggedAfter: boolean }): Date {
  const fromPin = new Date(input.now.getTime() + OFFER_WINDOW_HOURS * 3600000);
  if (input.loggedAfter) return fromPin;
  const beforeStart = new Date(input.startAt.getTime() - OFFER_LEAD_HOURS * 3600000);
  return fromPin.getTime() <= beforeStart.getTime() ? fromPin : beforeStart;
}

export interface GateCredential {
  type: CredentialType;
  expires_on: string;
}

export interface GateCommitment {
  ref: string;
  start: Date;
  end: Date;
}

export interface GateInput {
  setting: Setting;
  startAt: Date;
  endAt: Date;
  consumerName: string;
  blockedByConsumer: boolean;
  credentials: readonly GateCredential[];
  commitments: readonly GateCommitment[];
}

const gate = (name: keyof typeof GATE_LABELS, pass: boolean, reason: string | null): GateResult => ({
  gate: name,
  label: GATE_LABELS[name],
  pass,
  reason: pass ? null : reason,
});

/** The four dispatch gates, in order, for one interpreter against one seat's request. */
export function evaluateGates(input: GateInput): GateResult[] {
  const acceptedTypes = SETTING_CREDENTIALS[input.setting];
  const held = input.credentials
    .filter((credential) => acceptedTypes.includes(credential.type))
    .slice()
    .sort((left, right) => (left.expires_on < right.expires_on ? 1 : -1));

  const credentialGate = gate(
    'credential',
    held.length > 0,
    `No ${input.setting} credential. Needs one of ${acceptedTypes.join(', ')}.`,
  );

  const latest = held[0];
  const endDate = agencyDateOf(input.endAt);
  const validityGate = latest
    ? gate(
        'validity',
        latest.expires_on >= endDate,
        `${latest.type} expires ${latest.expires_on}, before this assignment ends.`,
      )
    : gate('validity', false, 'No credential to check.');

  const bufferMs = TRAVEL_BUFFER_MINUTES * 60000;
  const conflicts = input.commitments
    .filter((commitment) => {
      const clearBefore = commitment.end.getTime() + bufferMs <= input.startAt.getTime();
      const clearAfter = commitment.start.getTime() >= input.endAt.getTime() + bufferMs;
      return !clearBefore && !clearAfter;
    })
    .sort((left, right) => left.start.getTime() - right.start.getTime());
  const scheduleGate = gate(
    'schedule',
    conflicts.length === 0,
    conflicts[0] ? `Too close to ${conflicts[0].ref}; jobs need a travel buffer.` : null,
  );

  const consumerGate = gate(
    'consumer',
    !input.blockedByConsumer,
    `${input.consumerName} has blocked this interpreter.`,
  );

  return [credentialGate, validityGate, scheduleGate, consumerGate];
}

export function cancellationWindowHours(durationMinutes: number): 48 | 72 {
  return durationMinutes <= SHORT_REQUEST_MINUTES ? 48 : 72;
}

export interface QuoteInput {
  durationMinutes: number;
  startAt: Date;
  now: Date;
  seated: number;
  rateCents: number;
  isDraft: boolean;
}

export interface FeeQuote {
  quote: Quote;
  feeCents: number;
  feePerInterpreterCents: number;
}

/** The one cancellation window and fee definition, used by the quote and by the cancel. */
export function computeCancellationQuote(input: QuoteInput): FeeQuote {
  const windowHours = cancellationWindowHours(input.durationMinutes);
  const msBeforeStart = input.startAt.getTime() - input.now.getTime();
  const late = !input.isDraft && msBeforeStart < windowHours * 3600000;
  const chargeMinutes = late
    ? Math.max(SHORT_REQUEST_MINUTES, input.durationMinutes)
    : 0;
  const feePerInterpreterCents = divideHalfUp(chargeMinutes * input.rateCents, 60);
  const feeCents = feePerInterpreterCents * input.seated;
  return {
    feeCents,
    feePerInterpreterCents,
    quote: {
      late,
      window_hours: windowHours,
      hours_before_start: (msBeforeStart / 3600000).toFixed(2),
      seated: input.seated,
      charge_hours_per_interpreter: formatMinutesAsHours(chargeMinutes),
      hourly_rate: formatCents(input.rateCents),
      fee_per_interpreter: formatCents(feePerInterpreterCents),
      fee: formatCents(feeCents),
    },
  };
}

export function isInCancellationWindow(input: {
  status: RequestStatus;
  durationMinutes: number;
  startAt: Date;
  now: Date;
}): boolean {
  if (!(['submitted', 'partially_staffed', 'staffed'] as RequestStatus[]).includes(input.status)) {
    return false;
  }
  const msBeforeStart = input.startAt.getTime() - input.now.getTime();
  if (msBeforeStart <= 0) return false;
  return msBeforeStart < cancellationWindowHours(input.durationMinutes) * 3600000;
}

/** Billed hours: the larger of two hours and the worked time rounded up to the next quarter. */
export function billedQuarters(actualStart: Date, actualEnd: Date): number {
  const workedMinutes = (actualEnd.getTime() - actualStart.getTime()) / 60000;
  return Math.max(MINIMUM_BILLED_QUARTERS, Math.ceil(workedMinutes / 15));
}

export function timesheetAmountCents(quarters: number, rateCents: number): number {
  return divideHalfUp(quarters * rateCents, 4);
}

export function credentialStatus(expiresOn: string, now: Date): CredentialStatus {
  const today = agencyDateOf(now);
  if (expiresOn < today) return 'expired';
  const warningEdge = agencyDateOf(new Date(now.getTime() + CREDENTIAL_WARNING_DAYS * 86400000));
  return expiresOn <= warningEdge ? 'expiring' : 'valid';
}

export function durationMinutesOf(startAt: Date, endAt: Date): number {
  return Math.round((endAt.getTime() - startAt.getTime()) / 60000);
}
