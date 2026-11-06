import { randomBytes } from 'node:crypto';
import { Asset, assetDecimals, formatAmount } from '../../shared/assets';
import { businessMonth, dateTimeLabel } from '../../shared/businesstime';
import { fiatValueCents } from '../../shared/decimal';
import { maskedAddress, trimAmount } from '../../shared/format';
import { config } from '../config';
import { query, queryOne } from '../db/pool';
import { newId } from '../db/seed';
import {
  CounterpartyBlocked,
  DataChannel,
  decideAfterReview,
  decidePath,
  PathInputs,
  PathOutcome,
} from '../domain/case';
import { failure } from '../http/errors';
import { WorkspaceRecord } from '../http/runtime';
import { sendMail } from '../services/mail';
import { CaseRow, currentRequestPage, reloadCase, requestPageStatus } from './cases';
import { CounterpartyRow, dueDiligenceOf, findByAddress, networkOf } from './counterparties';
import { CustomerRow } from './customers';
import { nextCaseReference, rateInForce, ruleInForceAt } from './workspace';

export interface CaseCreator {
  readonly kind: 'member' | 'partner_key';
  readonly name: string;
}

export interface CaseInput {
  readonly asset: Asset;
  readonly amountScaled: bigint;
  readonly destinationAddress: string;
  readonly customer: CustomerRow;
  readonly beneficiaryName: string;
}

/** Records one metered network message. */
async function meterMessage(
  workspace: WorkspaceRecord,
  direction: 'sent' | 'received',
  at: Date,
  caseId: string | null,
  messageId: string | null,
): Promise<void> {
  await query(
    `INSERT INTO metered_messages (id, workspace_slug, direction, sent_at, business_month, case_id, message_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      newId('mm'),
      workspace.slug,
      direction,
      at,
      businessMonth(at, workspace.timeZone),
      caseId,
      messageId,
    ],
  );
}

export async function meterIncomingMessage(
  workspaceSlug: string,
  timeZone: string,
  at: Date,
  messageId: string,
): Promise<void> {
  await query(
    `INSERT INTO metered_messages (id, workspace_slug, direction, sent_at, business_month, case_id, message_id)
     VALUES ($1,$2,'received',$3,$4,NULL,$5)`,
    [newId('mm'), workspaceSlug, at, businessMonth(at, timeZone), messageId],
  );
}

async function issueRequestPage(
  workspace: WorkspaceRecord,
  caseRow: CaseRow,
  contactEmail: string,
  now: Date,
): Promise<void> {
  await query('UPDATE request_pages SET current = false, ended_at = COALESCE(ended_at, $2) WHERE case_id = $1 AND current = true', [
    caseRow.id,
    now,
  ]);
  const token = randomBytes(24).toString('hex');
  const endsAt = new Date(now.getTime() + config().timers.dataRequestPageSeconds * 1000);
  await query(
    `INSERT INTO request_pages (id, case_id, workspace_slug, token, contact_email, sent_at, ends_at, current)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
    [newId('rp'), caseRow.id, workspace.slug, token, contactEmail, now, endsAt],
  );
  const address = `${config().publicUrl}/r/${token}`;
  const text = [
    `A Travel Rule data request is waiting for ${workspace.name}.`,
    '',
    `Open the data request page: ${address}`,
    '',
    `Case reference: ${caseRow.reference}`,
    `Asset and amount: ${caseRow.asset} ${trimAmount(caseRow.amount)}`,
    `From address: ${maskedAddress(caseRow.sending_address)}`,
    `To address: ${maskedAddress(caseRow.destination_address)}`,
    '',
    `This page ends at ${dateTimeLabel(endsAt, workspace.timeZone, workspace.city)}.`,
  ].join('\n');
  await sendMail({
    to: [contactEmail],
    subject: `Travel Rule data request ${caseRow.reference} from ${workspace.name}`,
    text,
  }).catch(() => undefined);
}

/** Data sent: a signed network message, or a data request page by mail. */
async function sendData(
  workspace: WorkspaceRecord,
  caseRow: CaseRow,
  counterparty: CounterpartyRow,
  channel: DataChannel,
  awaitsAnswer: boolean,
  at: Date,
): Promise<void> {
  const answerDueAt = awaitsAnswer
    ? new Date(at.getTime() + config().timers.answerWindowSeconds * 1000)
    : null;
  await query(
    `UPDATE cases SET data_sent_channel = $2, data_sent_at = $3, data_sent_name = $4, answer_due_at = $5
     WHERE id = $1`,
    [caseRow.id, channel, at, counterparty.legal_name, answerDueAt],
  );
  if (channel === 'network') {
    await meterMessage(workspace, 'sent', at, caseRow.id, null);
    return;
  }
  await issueRequestPage(workspace, { ...caseRow, data_sent_at: at }, counterparty.contact_email, at);
}

async function pathInputsFor(
  workspace: WorkspaceRecord,
  counterparty: CounterpartyRow | null,
  value: bigint,
  at: Date,
): Promise<PathInputs> {
  const own = await ruleInForceAt(workspace.slug, workspace.jurisdictionCode, at);
  const theirs =
    counterparty === null
      ? null
      : await ruleInForceAt(workspace.slug, counterparty.jurisdiction_code, at);
  return {
    inRegistry: counterparty !== null,
    dueDiligence: counterparty === null ? null : dueDiligenceOf(counterparty),
    network: counterparty === null ? null : networkOf(counterparty),
    fiatValueCents: value,
    workspaceThresholdCents: own === null ? 0n : own.thresholdCents,
    confirmationLimitCents: workspace.confirmationLimitCents,
    counterpartyRule: counterparty === null ? null : theirs === null ? 'no_rule' : 'in_force',
  };
}

export async function createCase(
  workspace: WorkspaceRecord,
  creator: CaseCreator,
  input: CaseInput,
  now: Date,
): Promise<CaseRow> {
  const counterparty = await findByAddress(workspace.slug, input.destinationAddress);
  const rateCents = await rateInForce(workspace.slug, input.asset);
  const decimals = assetDecimals(input.asset);
  const value = fiatValueCents(input.amountScaled, decimals, rateCents);
  const inputs = await pathInputsFor(workspace, counterparty, value, now);
  const ownRule = await ruleInForceAt(workspace.slug, workspace.jurisdictionCode, now);
  let outcome: PathOutcome;
  try {
    outcome = decidePath(inputs);
  } catch (error) {
    if (error instanceof CounterpartyBlocked) throw failure('counterparty_blocked');
    throw error;
  }
  const reference = await nextCaseReference(workspace.slug);
  const id = newId('case');
  await query(
    `INSERT INTO cases (id, workspace_slug, reference, created_at, created_by_kind, created_by_name,
       asset, amount, destination_address, sending_address, wallet, counterparty_id,
       originator_customer_id, originator_name, originator_identity_number, originator_date_of_birth,
       beneficiary_name, fiat_value_cents, currency,
       du_jurisdiction_code, du_threshold_cents, du_threshold_currency, du_rule_in_force_since,
       du_rate_cents, du_confirmation_limit_cents, du_counterparty_name, du_counterparty_rule,
       path, status, counterparty_at, ownership_required, erasure_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
       $24,$25,$26,$27,$28,$29,$30,$31,'not_due')`,
    [
      id,
      workspace.slug,
      reference,
      now,
      creator.kind,
      creator.name,
      input.asset,
      formatAmount(input.amountScaled, input.asset),
      input.destinationAddress,
      workspace.sendingAddress,
      outcome.wallet,
      counterparty === null ? null : counterparty.id,
      input.customer.id,
      input.customer.name,
      input.customer.identity_number,
      input.customer.date_of_birth,
      input.beneficiaryName,
      value.toString(),
      workspace.currency,
      workspace.jurisdictionCode,
      inputs.workspaceThresholdCents.toString(),
      workspace.currency,
      ownRule === null ? null : ownRule.since,
      rateCents.toString(),
      workspace.confirmationLimitCents.toString(),
      counterparty === null ? null : counterparty.legal_name,
      inputs.counterpartyRule,
      outcome.path,
      outcome.status,
      outcome.path === 'review' ? null : now,
      outcome.ownershipRequired,
    ],
  );
  const stored = await reloadCase(id);
  if (outcome.dataChannel !== null && counterparty !== null) {
    await sendData(workspace, stored, counterparty, outcome.dataChannel, outcome.awaitsAnswer, now);
  }
  return reloadCase(id);
}

/** A review Accept continues with steps 4 to 6, under the rules recorded at creation. */
export async function continueAfterReview(
  workspace: WorkspaceRecord,
  caseRow: CaseRow,
  counterparty: CounterpartyRow,
  at: Date,
): Promise<CaseRow> {
  const outcome = decideAfterReview({
    inRegistry: true,
    dueDiligence: dueDiligenceOf(counterparty),
    network: networkOf(counterparty),
    fiatValueCents: BigInt(caseRow.fiat_value_cents),
    workspaceThresholdCents: BigInt(caseRow.du_threshold_cents),
    confirmationLimitCents: BigInt(caseRow.du_confirmation_limit_cents),
    counterpartyRule: caseRow.du_counterparty_rule === 'no_rule' ? 'no_rule' : 'in_force',
  });
  await query('UPDATE cases SET path = $2, status = $3, counterparty_at = $4 WHERE id = $1', [
    caseRow.id,
    outcome.path,
    outcome.status,
    at,
  ]);
  const stored = await reloadCase(caseRow.id);
  if (outcome.dataChannel !== null) {
    await sendData(workspace, stored, counterparty, outcome.dataChannel, outcome.awaitsAnswer, at);
  }
  return reloadCase(caseRow.id);
}

export async function rejectInReview(caseRow: CaseRow, at: Date): Promise<CaseRow> {
  await query(
    `UPDATE cases SET status = 'returned', review_rejected_at = $2, outcome = 'returned',
       closed_at = $2, erasure_status = 'scheduled', erasure_due_at = $3 WHERE id = $1`,
    [caseRow.id, at, retentionDueAt(at)],
  );
  return reloadCase(caseRow.id);
}

export function retentionDueAt(closedAt: Date): Date {
  return new Date(closedAt.getTime() + config().timers.retentionSeconds * 1000);
}

/** The due instant reached: every read and the timed work use this one transition. */
export async function lapseAnswers(workspaceSlug: string, now: Date): Promise<void> {
  await query(
    `UPDATE cases SET status = 'no_response'
     WHERE workspace_slug = $1 AND status = 'awaiting_answer' AND answer_due_at <= $2`,
    [workspaceSlug, now],
  );
}

export async function lapseAnswersEverywhere(now: Date): Promise<void> {
  await query(
    `UPDATE cases SET status = 'no_response' WHERE status = 'awaiting_answer' AND answer_due_at <= $1`,
    [now],
  );
}

export type AnswerArrival = 'applied' | 'late' | 'noted';

/** The one rule for whether a counterparty's answer is accepted, and how. */
export function answerArrivalFor(caseRow: CaseRow, now: Date): AnswerArrival | 'refused' {
  if (caseRow.answer_at !== null) return 'refused';
  if (caseRow.status === 'released' || caseRow.status === 'returned') return 'refused';
  if (caseRow.path === 'sunrise' && caseRow.status === 'cleared') return 'noted';
  if (caseRow.status !== 'awaiting_answer' && caseRow.status !== 'no_response') return 'refused';
  if (caseRow.status === 'no_response') return 'late';
  if (caseRow.answer_due_at !== null && caseRow.answer_due_at.getTime() <= now.getTime()) {
    return 'late';
  }
  return 'applied';
}

export async function applyAnswer(
  caseRow: CaseRow,
  decision: 'accepted' | 'rejected',
  via: 'network' | 'request_page',
  arrival: AnswerArrival,
  now: Date,
): Promise<CaseRow> {
  const status =
    arrival === 'noted'
      ? caseRow.status
      : arrival === 'late'
        ? 'no_response'
        : decision === 'accepted'
          ? 'accepted'
          : 'rejected';
  await query(
    `UPDATE cases SET status = $5, answer_decision = $2, answer_at = $3, answer_late = $6,
       answer_via = $4 WHERE id = $1`,
    [caseRow.id, decision, now, via, status, arrival === 'late'],
  );
  return reloadCase(caseRow.id);
}

export async function closeCase(
  caseRow: CaseRow,
  outcome: 'released' | 'returned',
  now: Date,
): Promise<CaseRow> {
  await query(
    `UPDATE cases SET status = $2, outcome = $2, closed_at = $3,
       erasure_status = 'scheduled', erasure_due_at = $4 WHERE id = $1`,
    [caseRow.id, outcome, now, retentionDueAt(now)],
  );
  return reloadCase(caseRow.id);
}

export async function newRequestPageFor(
  workspace: WorkspaceRecord,
  caseRow: CaseRow,
  now: Date,
): Promise<CaseRow> {
  const counterparty =
    caseRow.counterparty_id === null
      ? null
      : await queryOne<CounterpartyRow>('SELECT * FROM counterparties WHERE id = $1', [
          caseRow.counterparty_id,
        ]);
  if (counterparty === null) throw failure('request_page_not_open');
  await issueRequestPage(workspace, caseRow, counterparty.contact_email, now);
  return reloadCase(caseRow.id);
}

export async function endRequestPage(caseRow: CaseRow, now: Date): Promise<CaseRow> {
  const page = await currentRequestPage(caseRow.id);
  if (page === null || requestPageStatus(page, now) !== 'live') {
    throw failure('request_page_not_open');
  }
  await query('UPDATE request_pages SET ended_at = $2 WHERE id = $1', [page.id, now]);
  return reloadCase(caseRow.id);
}

/** A new page may go out while the case is open, its data went as a page and no answer is recorded. */
export function requestPageSendable(caseRow: CaseRow): boolean {
  if (caseRow.data_sent_channel !== 'request_page') return false;
  if (caseRow.answer_at !== null) return false;
  return (
    caseRow.status === 'awaiting_answer' ||
    caseRow.status === 'no_response' ||
    (caseRow.path === 'sunrise' && caseRow.status === 'cleared')
  );
}
