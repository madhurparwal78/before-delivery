import { Asset } from '../../shared/assets';
import { toInstant } from '../../shared/businesstime';
import { query, queryOne } from '../db/pool';
import {
  AnswerDecision,
  buildTrack,
  CaseOutcome,
  CasePath,
  CaseStatus,
  CounterpartyRule,
  DataChannel,
  ErasureStatus,
  isClosed,
  releaseAllowed,
  Station,
  Wallet,
} from '../domain/case';
import { maskIdentityNumber, maskPersonName } from '../domain/masking';
import { Role } from '../http/runtime';

export interface CaseRow {
  id: string;
  workspace_slug: string;
  reference: string;
  created_at: Date;
  created_by_kind: string;
  created_by_name: string;
  asset: string;
  amount: string;
  destination_address: string;
  sending_address: string;
  wallet: string;
  counterparty_id: string | null;
  originator_customer_id: string;
  originator_name: string | null;
  originator_identity_number: string | null;
  originator_date_of_birth: string | null;
  beneficiary_name: string | null;
  fiat_value_cents: string;
  currency: string;
  du_jurisdiction_code: string | null;
  du_threshold_cents: string;
  du_threshold_currency: string;
  du_rule_in_force_since: string | null;
  du_rate_cents: string;
  du_confirmation_limit_cents: string;
  du_counterparty_name: string | null;
  du_counterparty_rule: string | null;
  path: string;
  status: string;
  counterparty_at: Date | null;
  review_rejected_at: Date | null;
  data_sent_channel: string | null;
  data_sent_at: Date | null;
  data_sent_name: string | null;
  answer_decision: string | null;
  answer_at: Date | null;
  answer_late: boolean;
  answer_via: string | null;
  answer_due_at: Date | null;
  ownership_required: boolean;
  ownership_confirmed_on: string | null;
  ownership_recorded_at: Date | null;
  ownership_recorded_by: string | null;
  release_reason_text: string | null;
  release_reason_by: string | null;
  release_reason_at: Date | null;
  outcome: string | null;
  closed_at: Date | null;
  erasure_status: string;
  erasure_due_at: Date | null;
  erased_at: Date | null;
  archived: boolean;
  archived_at: Date | null;
}

export async function findCase(workspaceSlug: string, id: string): Promise<CaseRow | null> {
  return queryOne<CaseRow>('SELECT * FROM cases WHERE workspace_slug = $1 AND id = $2', [
    workspaceSlug,
    id,
  ]);
}

export async function findCaseByReference(
  workspaceSlug: string,
  reference: string,
): Promise<CaseRow | null> {
  return queryOne<CaseRow>('SELECT * FROM cases WHERE workspace_slug = $1 AND reference = $2', [
    workspaceSlug,
    reference,
  ]);
}

export async function reloadCase(id: string): Promise<CaseRow> {
  const row = await queryOne<CaseRow>('SELECT * FROM cases WHERE id = $1', [id]);
  if (row === null) throw new Error(`No case ${id}`);
  return row;
}

export interface ClaimRow {
  case_id: string;
  member_id: string;
  member_name: string;
  claimed_at: Date;
  ends_at: Date;
}

export interface DecisionRow {
  case_id: string;
  decision: string;
  reason: string;
  decided_by_id: string;
  decided_by_name: string;
  decided_at: Date;
}

export interface RequestPageRow {
  id: string;
  case_id: string;
  workspace_slug: string;
  token: string;
  contact_email: string;
  sent_at: Date;
  ends_at: Date;
  ended_at: Date | null;
  answered_at: Date | null;
  answer_decision: string | null;
  certificate_id: string | null;
  current: boolean;
}

export async function currentRequestPage(caseId: string): Promise<RequestPageRow | null> {
  return queryOne<RequestPageRow>(
    'SELECT * FROM request_pages WHERE case_id = $1 AND current = true',
    [caseId],
  );
}

export async function findClaim(caseId: string): Promise<ClaimRow | null> {
  return queryOne<ClaimRow>('SELECT * FROM review_claims WHERE case_id = $1', [caseId]);
}

export async function findDecision(caseId: string): Promise<DecisionRow | null> {
  return queryOne<DecisionRow>('SELECT * FROM review_decisions WHERE case_id = $1', [caseId]);
}

export function remainingSeconds(due: Date | null, now: Date): number {
  if (due === null) return 0;
  return Math.max(0, Math.ceil((due.getTime() - now.getTime()) / 1000));
}

/** `live` while the page's end instant has not been reached and it is current. */
export function requestPageStatus(page: RequestPageRow, now: Date): 'live' | 'ended' | 'answered' {
  if (page.answered_at !== null) return 'answered';
  if (!page.current || page.ended_at !== null) return 'ended';
  return page.ends_at.getTime() <= now.getTime() ? 'ended' : 'live';
}

export function pathOf(row: CaseRow): CasePath {
  return row.path as CasePath;
}

export function statusOf(row: CaseRow): CaseStatus {
  return row.status as CaseStatus;
}

export function trackOf(row: CaseRow): Station[] {
  return buildTrack({
    path: pathOf(row),
    status: statusOf(row),
    wallet: row.wallet as Wallet,
    screenedAt: row.created_at,
    counterpartyNameAsDecided: row.du_counterparty_name,
    counterpartyAt: row.counterparty_at,
    reviewRejectedAt: row.review_rejected_at,
    dataChannel: row.data_sent_channel as DataChannel | null,
    dataSentAt: row.data_sent_at,
    ownershipRequired: row.ownership_required,
    ownershipRecordedAt: row.ownership_recorded_at,
    answerDecision: row.answer_decision as AnswerDecision | null,
    answerAt: row.answer_at,
    answerLate: row.answer_late,
    answerDueAt: row.answer_due_at,
    hasReleaseReason: row.release_reason_text !== null,
    outcome: row.outcome as CaseOutcome | null,
    closedAt: row.closed_at,
  });
}

interface CounterpartyFacts {
  id: string;
  legal_name: string;
  lei: string;
  jurisdiction_code: string;
  network: string;
}

export interface DigestRow {
  kind: string;
  object_key: string;
  sha256: string;
}

export async function caseDigests(caseId: string): Promise<DigestRow[]> {
  return query<DigestRow>(
    `SELECT 'message' AS kind, object_key, sha256 FROM messages WHERE case_id = $1
     UNION ALL
     SELECT 'certificate' AS kind, object_key, sha256 FROM certificates WHERE case_id = $1
     ORDER BY object_key`,
    [caseId],
  );
}

function maskedName(name: string | null, role: Role): string | null {
  if (name === null) return null;
  return role === 'support_agent' ? maskPersonName(name) : name;
}

export interface ArchivedCaseBody {
  readonly id: string;
  readonly reference: string;
  readonly archived: true;
  readonly archivedAt: string | null;
  readonly closedAt: string | null;
}

export function presentArchivedCase(row: CaseRow): ArchivedCaseBody {
  return {
    id: row.id,
    reference: row.reference,
    archived: true,
    archivedAt: row.archived_at === null ? null : toInstant(row.archived_at),
    closedAt: row.closed_at === null ? null : toInstant(row.closed_at),
  };
}

/** The one case body every endpoint and every screen reads. */
export async function presentCase(
  row: CaseRow,
  role: Role,
  now: Date,
): Promise<Record<string, unknown>> {
  const counterparty =
    row.counterparty_id === null
      ? null
      : await queryOne<CounterpartyFacts>(
          'SELECT id, legal_name, lei, jurisdiction_code, network FROM counterparties WHERE id = $1',
          [row.counterparty_id],
        );
  const claim = await findClaim(row.id);
  const decision = await findDecision(row.id);
  const page = await currentRequestPage(row.id);
  const digests = await caseDigests(row.id);
  const status = statusOf(row);
  const originator: Record<string, unknown> =
    row.originator_name === null
      ? {}
      : {
          customerId: row.originator_customer_id,
          name: maskedName(row.originator_name, role),
          identityNumber:
            row.originator_identity_number === null
              ? null
              : role === 'support_agent'
                ? maskIdentityNumber(row.originator_identity_number)
                : row.originator_identity_number,
          ...(role === 'support_agent' ? {} : { dateOfBirth: row.originator_date_of_birth }),
        };
  const claimView =
    claim === null || claim.ends_at.getTime() <= now.getTime()
      ? null
      : {
          memberId: claim.member_id,
          memberName: claim.member_name,
          claimedAt: toInstant(claim.claimed_at),
          endsAt: toInstant(claim.ends_at),
          remainingSeconds: remainingSeconds(claim.ends_at, now),
        };
  return {
    id: row.id,
    reference: row.reference,
    createdAt: toInstant(row.created_at),
    createdBy:
      row.created_by_kind === 'member'
        ? { kind: 'member', name: row.created_by_name }
        : { kind: 'partner_key', label: row.created_by_name },
    asset: row.asset as Asset,
    amount: row.amount,
    destinationAddress: row.destination_address,
    sendingAddress: row.sending_address,
    wallet: row.wallet,
    counterparty:
      counterparty === null
        ? null
        : {
            id: counterparty.id,
            name: counterparty.legal_name,
            lei: counterparty.lei,
            jurisdictionCode: counterparty.jurisdiction_code,
            network: counterparty.network,
          },
    originator: row.originator_name === null ? null : originator,
    beneficiaryName: maskedName(row.beneficiary_name, role),
    fiatValueCents: BigInt(row.fiat_value_cents),
    currency: row.currency,
    decidedUnder: {
      jurisdictionCode: row.du_jurisdiction_code,
      thresholdCents: BigInt(row.du_threshold_cents),
      thresholdCurrency: row.du_threshold_currency,
      ruleInForceSince: row.du_rule_in_force_since,
      rateCents: BigInt(row.du_rate_cents),
      confirmationLimitCents: BigInt(row.du_confirmation_limit_cents),
      counterpartyName: row.du_counterparty_name,
      counterpartyRule: row.du_counterparty_rule as CounterpartyRule | null,
    },
    path: pathOf(row),
    status,
    dataSent:
      row.data_sent_at === null
        ? null
        : {
            channel: row.data_sent_channel,
            at: toInstant(row.data_sent_at),
            counterpartyNameAsSent: maskedName(row.data_sent_name, role),
          },
    answer:
      row.answer_at === null
        ? null
        : {
            decision: row.answer_decision,
            at: toInstant(row.answer_at),
            late: row.answer_late,
            via: row.answer_via,
          },
    answerDueAt: row.answer_due_at === null ? null : toInstant(row.answer_due_at),
    answerRemainingSeconds:
      row.answer_due_at === null ? null : status === 'awaiting_answer' ? remainingSeconds(row.answer_due_at, now) : 0,
    ownership: {
      required: row.ownership_required,
      confirmedOn: row.ownership_confirmed_on,
      recordedAt: row.ownership_recorded_at === null ? null : toInstant(row.ownership_recorded_at),
      recordedBy: row.ownership_recorded_by,
    },
    review:
      pathOf(row) === 'review' || claim !== null || decision !== null
        ? {
            claim: claimView,
            decision:
              decision === null
                ? null
                : {
                    decision: decision.decision,
                    reason: decision.reason,
                    decidedBy: decision.decided_by_name,
                    decidedAt: toInstant(decision.decided_at),
                  },
          }
        : null,
    requestPage:
      page === null
        ? null
        : {
            status: requestPageStatus(page, now),
            sentAt: toInstant(page.sent_at),
            endsAt: toInstant(page.ends_at),
            remainingSeconds:
              requestPageStatus(page, now) === 'live' ? remainingSeconds(page.ends_at, now) : 0,
            contactEmail: page.contact_email,
          },
    releaseReason:
      row.release_reason_text === null
        ? null
        : {
            text: row.release_reason_text,
            recordedBy: row.release_reason_by,
            recordedAt: row.release_reason_at === null ? null : toInstant(row.release_reason_at),
          },
    releaseAllowed: !isClosed(status) && releaseAllowed(status, row.release_reason_text !== null),
    outcome: row.outcome,
    closedAt: row.closed_at === null ? null : toInstant(row.closed_at),
    erasure: {
      status: row.erasure_status as ErasureStatus,
      dueAt: row.erasure_due_at === null ? null : toInstant(row.erasure_due_at),
      erasedAt: row.erased_at === null ? null : toInstant(row.erased_at),
      digests: digests.map((digest) => ({
        kind: digest.kind,
        objectKey: digest.object_key,
        sha256: digest.sha256,
      })),
    },
    archived: row.archived,
    track: trackOf(row),
    now: toInstant(now),
  };
}
