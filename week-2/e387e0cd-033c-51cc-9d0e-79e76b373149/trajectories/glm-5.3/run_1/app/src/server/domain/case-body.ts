import { computeTrack } from './track.js';
import type { TrackStation, TrackCase } from './track.js';
import { formatInstant } from './time.js';
import { initials, maskIdentity } from '../../shared/util.js';

// One place turns a stored case row into its published API body, applying the
// support-agent masking and computing the Handshake track.
export type CaseRow = {
  id: string;
  workspace_slug: string;
  reference: string;
  created_at: Date;
  created_by_kind: string;
  created_by_name: string;
  asset: string;
  amount_digits: string;
  amount_scale: number;
  destination_address: string;
  sending_address: string;
  wallet: string;
  counterparty_id: string | null;
  counterparty_name_as_sent: string | null;
  counterparty_lei: string | null;
  counterparty_jurisdiction: string | null;
  counterparty_network: string | null;
  counterparty_current_name: string | null;
  customer_id: string;
  originator_name: string | null;
  originator_identity: string | null;
  originator_dob: Date | null;
  beneficiary_name: string | null;
  fiat_value_cents: string;
  currency: string;
  path: string;
  status: string;
  data_sent_channel: string | null;
  data_sent_at: Date | null;
  answer_due_at: Date | null;
  answer_decision: string | null;
  answer_at: Date | null;
  answer_late: boolean | null;
  answer_via: string | null;
  ownership_required: boolean;
  ownership_confirmed_on: Date | null;
  ownership_recorded_at: Date | null;
  ownership_recorded_by: string | null;
  release_reason: string | null;
  release_reason_by: string | null;
  release_reason_at: Date | null;
  outcome: string | null;
  closed_at: Date | null;
  archived: boolean;
  archived_at: Date | null;
  erased: boolean;
  erasure_due_at: Date | null;
  erasure_status: string;
  erased_at: Date | null;
  decided_jurisdiction: string;
  decided_threshold_cents: string | null;
  decided_threshold_currency: string | null;
  decided_rule_since: Date | null;
  decided_rate_cents: string;
  decided_confirmation_limit: string;
  decided_counterparty_name: string | null;
  decided_counterparty_rule: string | null;
  decided_review_accepted_at: Date | null;
};

export function amountString(digits: string | bigint, scale: number): string {
  const d = typeof digits === 'bigint' ? digits.toString() : digits;
  const neg = d.startsWith('-');
  const abs = neg ? d.slice(1) : d;
  let str = abs;
  if (scale > 0) {
    if (str.length <= scale) str = '0'.repeat(scale - str.length + 1) + str;
    str = `${str.slice(0, str.length - scale)}.${str.slice(str.length - scale)}`;
  }
  return neg ? `-${str}` : str;
}

export function decimalCents(value: string | number): string {
  const cents = typeof value === 'number' ? value : Number(value);
  const digits = Math.abs(Math.trunc(cents)).toString().padStart(3, '0');
  return `${cents < 0 ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export interface SerialiseOptions { role?: string; now?: Date; workspaceSlug?: string; digests?: unknown[]; requestPage?: Record<string, unknown> | null; review?: Record<string, unknown> | null }

export function serialiseCase(row: CaseRow, opts: SerialiseOptions = {}): Record<string, unknown> {
  const support = opts.role === 'support_agent';
  const now = opts.now ?? new Date();
  const amount = amountString(row.amount_digits, row.amount_scale);
  const originatorName = row.originator_name !== null ? (support && !row.erased ? initials(row.originator_name) : row.originator_name) : null;
  const beneficiaryName = row.beneficiary_name !== null ? (support && !row.erased ? initials(row.beneficiary_name) : row.beneficiary_name) : null;
  const answerDueMs = row.answer_due_at !== null ? row.answer_due_at.getTime() : null;
  const remaining = answerDueMs !== null ? Math.max(0, Math.floor((answerDueMs - now.getTime()) / 1000)) : 0;

  const releaseAllowed = (row.status === 'accepted' || row.status === 'cleared' || (row.status === 'no_response' && row.release_reason !== null));

  const trackInput: TrackCase = {
    createdAt: formatInstant(row.created_at),
    path: row.path as TrackCase['path'],
    status: row.status,
    wallet: row.wallet as 'hosted' | 'self_hosted',
    counterpartyNameAsSent: row.counterparty_name_as_sent,
    dataSent: row.data_sent_at !== null && row.data_sent_channel !== null ? { channel: row.data_sent_channel as 'network' | 'request_page', at: formatInstant(row.data_sent_at) } : null,
    dataSentText: null,
    answer: row.answer_decision !== null && row.answer_at !== null ? { decision: row.answer_decision as 'accepted' | 'rejected', at: formatInstant(row.answer_at), late: row.answer_late === true } : null,
    answerDueAt: row.answer_due_at !== null ? formatInstant(row.answer_due_at) : null,
    ownershipRequired: row.ownership_required,
    ownershipRecordedAt: row.ownership_recorded_at !== null ? formatInstant(row.ownership_recorded_at) : null,
    reviewAcceptedAt: row.decided_review_accepted_at !== null ? formatInstant(row.decided_review_accepted_at) : null,
    releaseAllowed,
    releaseReasonRecorded: row.release_reason !== null,
    outcome: row.outcome as 'released' | 'returned' | null,
    closedAt: row.closed_at !== null ? formatInstant(row.closed_at) : null,
  };
  const track: TrackStation[] = computeTrack(trackInput);

  const erasureStatus = row.erasure_status;
  const erasure: Record<string, unknown> = {
    status: erasureStatus,
    dueAt: row.erasure_due_at !== null ? formatInstant(row.erasure_due_at) : null,
    erasedAt: row.erased_at !== null ? formatInstant(row.erased_at) : null,
    digests: opts.digests ?? [],
  };

  const body: Record<string, unknown> = {
    id: row.id,
    reference: row.reference,
    createdAt: formatInstant(row.created_at),
    createdBy: { kind: row.created_by_kind, name: row.created_by_name },
    asset: row.asset,
    amount,
    destinationAddress: row.erased ? null : row.destination_address,
    sendingAddress: row.erased ? null : row.sending_address,
    wallet: row.wallet,
    counterparty: row.counterparty_id !== null && row.counterparty_current_name !== null
      ? { id: row.counterparty_id, name: row.counterparty_current_name, lei: row.counterparty_lei, jurisdictionCode: row.counterparty_jurisdiction, network: row.counterparty_network }
      : null,
    originator: row.erased
      ? null
      : {
          customerId: row.customer_id,
          name: originatorName,
          identityNumber: support ? maskIdentity(row.originator_identity ?? '') : row.originator_identity,
          ...(support ? {} : { dateOfBirth: row.originator_dob !== null ? dateStr(row.originator_dob) : null }),
        },
    beneficiaryName,
    fiatValueCents: Number(row.fiat_value_cents),
    currency: row.currency,
    decidedUnder: {
      jurisdictionCode: row.decided_jurisdiction,
      thresholdCents: row.decided_threshold_cents !== null ? Number(row.decided_threshold_cents) : null,
      thresholdCurrency: row.decided_threshold_currency,
      ruleInForceSince: row.decided_rule_since !== null ? dateStr(row.decided_rule_since) : null,
      rateCents: Number(row.decided_rate_cents),
      confirmationLimitCents: Number(row.decided_confirmation_limit),
      counterpartyName: row.decided_counterparty_name,
      counterpartyRule: row.decided_counterparty_rule,
    },
    path: row.path,
    status: row.status,
    dataSent: row.data_sent_at !== null && row.data_sent_channel !== null
      ? { channel: row.data_sent_channel, at: formatInstant(row.data_sent_at), counterpartyNameAsSent: row.counterparty_name_as_sent }
      : null,
    answer: row.answer_decision !== null && row.answer_at !== null
      ? { decision: row.answer_decision, at: formatInstant(row.answer_at), late: row.answer_late === true, via: row.answer_via }
      : null,
    answerDueAt: row.answer_due_at !== null ? formatInstant(row.answer_due_at) : null,
    answerRemainingSeconds: remaining,
    ownership: {
      required: row.ownership_required,
      confirmedOn: row.ownership_confirmed_on !== null ? dateStr(row.ownership_confirmed_on) : null,
      recordedAt: row.ownership_recorded_at !== null ? formatInstant(row.ownership_recorded_at) : null,
      recordedBy: row.ownership_recorded_by,
    },
    review: opts.review !== undefined ? opts.review : null,
    requestPage: opts.requestPage !== undefined ? opts.requestPage : null,
    releaseReason: row.release_reason !== null ? { text: row.release_reason, recordedBy: row.release_reason_by, recordedAt: row.release_reason_at !== null ? formatInstant(row.release_reason_at) : null } : null,
    releaseAllowed,
    outcome: row.outcome,
    closedAt: row.closed_at !== null ? formatInstant(row.closed_at) : null,
    erasure,
    archived: row.archived,
    track,
    now: formatInstant(now),
  };
  return body;
}

export function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
