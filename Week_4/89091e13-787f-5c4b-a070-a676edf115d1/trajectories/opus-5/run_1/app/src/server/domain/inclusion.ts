import { Queryable } from '../db.js';
import { VoteOption } from '../../shared/governance.js';
import { BURN_ACCOUNT, memberAccount, postPair } from './ledger.js';
import {
  applyDeposit,
  applyProposal,
  applyVote,
  proposalByNumber,
  ProposalRow,
} from './governance.js';
import {
  applyClaim,
  applyDelegate,
  applyRedelegate,
  applyUndelegate,
  pendingRewardsTotal,
  stakingRefusal,
  validatorById,
} from './staking.js';
import {
  DelegatePayload,
  DepositPayload,
  ProposalPayload,
  RedelegatePayload,
  TransactionRow,
  VotePayload,
  WorkspaceRow,
} from './types.js';

export type InclusionOutcome = { included: true } | { included: false; reason: string };

const INCLUDED: InclusionOutcome = { included: true };

export function depositPeriodEnded(number: number): string {
  return `The deposit period for proposal ${number} has ended.`;
}

export function votingNotOpen(number: number): string {
  return `Proposal ${number} is not open for voting yet.`;
}

export function votingPeriodEnded(number: number): string {
  return `The voting period for proposal ${number} has ended.`;
}

export const NO_REWARDS = 'There are no rewards to claim.';

export function votingIsOpen(proposal: ProposalRow, at: Date): boolean {
  return (
    proposal.status === 'voting' &&
    proposal.voting_ends_at !== null &&
    at.getTime() < proposal.voting_ends_at.getTime()
  );
}

export function depositIsOpen(proposal: ProposalRow, at: Date): boolean {
  return proposal.status === 'deposit' && at.getTime() < proposal.deposit_ends_at.getTime();
}

/**
 * Applies one transaction at its block's production: the hold is released, the
 * fee is charged, and the rule is checked again at inclusion time.
 */
export async function includeTransaction(
  tx: Queryable,
  workspace: WorkspaceRow,
  row: TransactionRow,
  height: number,
  at: Date,
): Promise<InclusionOutcome> {
  await tx.query('UPDATE transactions SET held_ufern = 0 WHERE id = $1', [row.id]);
  const feeUfern = BigInt(row.fee_ufern);
  const outcome = await applyEffect(tx, workspace, row, height, at);
  if (feeUfern > 0n) {
    await postPair(tx, {
      workspaceId: workspace.id,
      debit: memberAccount(row.sender_id),
      credit: BURN_ACCOUNT,
      amountUfern: feeUfern,
      kind: 'fee',
      label: 'Fee',
      height,
      at,
    });
  }
  if (outcome.included) {
    await tx.query("UPDATE transactions SET status = 'included', height = $2 WHERE id = $1", [
      row.id,
      height,
    ]);
  } else {
    await tx.query(
      "UPDATE transactions SET status = 'rejected', height = $2, rejection_reason = $3 WHERE id = $1",
      [row.id, height, outcome.reason],
    );
  }
  return outcome;
}

async function applyEffect(
  tx: Queryable,
  workspace: WorkspaceRow,
  row: TransactionRow,
  height: number,
  at: Date,
): Promise<InclusionOutcome> {
  const feeUfern = BigInt(row.fee_ufern);
  if (row.kind === 'blob') return INCLUDED;

  if (row.kind === 'delegate' || row.kind === 'undelegate') {
    const payload = row.payload as DelegatePayload;
    const validator = await validatorById(tx, workspace.id, payload.validatorId);
    if (!validator) return { included: false, reason: 'Choose a validator.' };
    const amountUfern = BigInt(payload.amountUfern);
    const refusal = await stakingRefusal(tx, {
      kind: row.kind,
      workspaceId: workspace.id,
      personId: row.sender_id,
      validator,
      toValidator: null,
      amountUfern,
      feeUfern,
      now: at,
    });
    if (refusal) return { included: false, reason: refusal.message };
    if (row.kind === 'delegate') {
      await applyDelegate(tx, workspace.id, row.sender_id, validator, amountUfern, height, at);
    } else {
      await applyUndelegate(tx, workspace.id, row.sender_id, validator, amountUfern, height, at);
    }
    return INCLUDED;
  }

  if (row.kind === 'redelegate') {
    const payload = row.payload as RedelegatePayload;
    const from = await validatorById(tx, workspace.id, payload.fromValidatorId);
    const to = await validatorById(tx, workspace.id, payload.toValidatorId);
    if (!from || !to) return { included: false, reason: 'Choose a validator.' };
    const amountUfern = BigInt(payload.amountUfern);
    const refusal = await stakingRefusal(tx, {
      kind: 'redelegate',
      workspaceId: workspace.id,
      personId: row.sender_id,
      validator: from,
      toValidator: to,
      amountUfern,
      feeUfern,
      now: at,
    });
    if (refusal) return { included: false, reason: refusal.message };
    await applyRedelegate(tx, workspace.id, row.sender_id, from, to, amountUfern, height, at);
    return INCLUDED;
  }

  if (row.kind === 'claim') {
    const pending = await pendingRewardsTotal(tx, workspace.id, row.sender_id);
    if (pending === 0n) return { included: false, reason: NO_REWARDS };
    await applyClaim(tx, workspace.id, row.sender_id, height, at);
    return INCLUDED;
  }

  if (row.kind === 'proposal') {
    const payload = row.payload as ProposalPayload;
    await applyProposal(
      tx,
      workspace.id,
      row.sender_id,
      payload.title,
      payload.description,
      BigInt(payload.initialDepositUfern),
      height,
      at,
    );
    return INCLUDED;
  }

  if (row.kind === 'deposit') {
    const payload = row.payload as DepositPayload;
    const proposal = await proposalByNumber(tx, workspace.id, payload.proposalNumber);
    if (!proposal || !depositIsOpen(proposal, at)) {
      return { included: false, reason: depositPeriodEnded(payload.proposalNumber) };
    }
    await applyDeposit(tx, proposal, row.sender_id, BigInt(payload.amountUfern), height, at);
    return INCLUDED;
  }

  const payload = row.payload as VotePayload;
  const proposal = await proposalByNumber(tx, workspace.id, payload.proposalNumber);
  if (!proposal) return { included: false, reason: votingPeriodEnded(payload.proposalNumber) };
  if (proposal.status === 'deposit') {
    return { included: false, reason: votingNotOpen(proposal.number) };
  }
  if (!votingIsOpen(proposal, at)) {
    return { included: false, reason: votingPeriodEnded(proposal.number) };
  }
  await applyVote(tx, proposal, row.sender_id, payload.option as VoteOption, at);
  return INCLUDED;
}
