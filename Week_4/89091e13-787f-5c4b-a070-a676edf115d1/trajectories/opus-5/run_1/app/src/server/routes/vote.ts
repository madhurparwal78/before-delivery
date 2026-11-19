import { randomUUID } from 'node:crypto';
import { db, withTransaction } from '../db.js';
import { conflict, notFound, unprocessable } from '../http.js';
import { emitEvent, flushEvents } from '../live.js';
import { parseFern, STAKING_GAS } from '../../shared/fees.js';
import { VoteOption } from '../../shared/governance.js';
import { balancesFor, lockPerson } from '../domain/accounts.js';
import { now } from '../domain/engine.js';
import {
  minDepositUfern,
  proposalByNumber,
  proposalsOf,
  ProposalRow,
} from '../domain/governance.js';
import {
  depositIsOpen,
  depositPeriodEnded,
  votingIsOpen,
  votingNotOpen,
  votingPeriodEnded,
} from '../domain/inclusion.js';
import { insufficientBalance } from '../domain/staking.js';
import { TransactionKind } from '../domain/types.js';
import {
  readString,
  replayIdempotent,
  RequestContext,
  requireWorkspace,
  requireWrite,
  storeIdempotent,
  StoredResponse,
} from './context.js';
import { proposalView, transactionWriteView } from './serialize.js';
import { stakingFee } from './stake.js';

export async function listProposals(ctx: RequestContext, id: string): Promise<StoredResponse> {
  const { workspace, person } = await requireWorkspace(ctx, id);
  const proposals = await proposalsOf(db, workspace.id);
  const views = [];
  for (const proposal of proposals) {
    views.push(await proposalView(db, proposal, person.id, minDepositUfern));
  }
  return { status: 200, body: views };
}

export async function getProposal(
  ctx: RequestContext,
  id: string,
  number: string,
): Promise<StoredResponse> {
  const { workspace, person } = await requireWorkspace(ctx, id);
  const proposal = await requireProposal(workspace.id, number);
  return {
    status: 200,
    body: await proposalView(db, proposal, person.id, minDepositUfern),
  };
}

async function requireProposal(workspaceId: string, number: string): Promise<ProposalRow> {
  const parsed = Number(number);
  if (!Number.isInteger(parsed)) throw notFound();
  const proposal = await proposalByNumber(db, workspaceId, parsed);
  if (!proposal) throw notFound();
  return proposal;
}

interface GovernanceWrite {
  kind: TransactionKind;
  payload: Record<string, unknown>;
  holdUfern: bigint;
}

async function createTransaction(
  ctx: RequestContext,
  workspaceId: string,
  personId: string,
  write: GovernanceWrite,
): Promise<StoredResponse> {
  const feeUfern = stakingFee();
  const txId = randomUUID();
  const at = now();
  const result = await withTransaction(async (tx) => {
    await lockPerson(tx, personId);
    await tx.query(
      `INSERT INTO transactions
         (id, workspace_id, kind, sender_id, status, fee_ufern, gas, held_ufern, payload, submitted_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9)`,
      [
        txId,
        workspaceId,
        write.kind,
        personId,
        feeUfern,
        STAKING_GAS,
        write.holdUfern,
        JSON.stringify(write.payload),
        at,
      ],
    );
    const stored: StoredResponse = {
      status: 201,
      body: transactionWriteView({
        id: txId,
        kind: write.kind,
        feeUfern,
        gas: STAKING_GAS,
        submittedAt: at,
      }),
    };
    await storeIdempotent(tx, ctx, workspaceId, personId, stored);
    return stored;
  });
  emitEvent(workspaceId, { kind: 'transactions' });
  flushEvents();
  return result;
}

export async function createProposal(ctx: RequestContext, id: string): Promise<StoredResponse> {
  const { workspace, role, person } = await requireWorkspace(ctx, id);
  const replay = await replayIdempotent(ctx, workspace.id, person.id);
  if (replay) return replay;
  requireWrite(role, 'transaction');
  const title = readString(ctx, 'title').trim();
  const description = readString(ctx, 'description');
  if (title.length === 0) throw unprocessable('title', 'Give the proposal a title.');
  if (title.length > 120) {
    throw unprocessable('title', 'Keep the title to 120 characters or fewer.');
  }
  if (description.length > 2000) {
    throw unprocessable('description', 'Keep the description to 2,000 characters or fewer.');
  }
  const depositUfern = parseFern(readString(ctx, 'initialDeposit') || '0');
  if (depositUfern === null) {
    throw unprocessable('amount', 'Amount must be an amount in FERN with at most 6 decimals.');
  }
  const feeUfern = stakingFee();
  const balances = await balancesFor(db, workspace.id, person.id);
  if (balances.availableUfern < feeUfern + depositUfern) {
    throw unprocessable(
      'amount',
      insufficientBalance(balances.availableUfern, feeUfern + depositUfern),
    );
  }
  return createTransaction(ctx, workspace.id, person.id, {
    kind: 'proposal',
    payload: { title, description, initialDepositUfern: depositUfern.toString() },
    holdUfern: feeUfern + depositUfern,
  });
}

export async function createDeposit(
  ctx: RequestContext,
  id: string,
  number: string,
): Promise<StoredResponse> {
  const { workspace, role, person } = await requireWorkspace(ctx, id);
  const proposal = await requireProposal(workspace.id, number);
  const replay = await replayIdempotent(ctx, workspace.id, person.id);
  if (replay) return replay;
  requireWrite(role, 'transaction');
  const amountUfern = parseFern(readString(ctx, 'amount'));
  if (amountUfern === null) {
    throw unprocessable('amount', 'Amount must be an amount in FERN with at most 6 decimals.');
  }
  if (amountUfern <= 0n) throw unprocessable('amount', 'Amount must be more than 0.');
  const feeUfern = stakingFee();
  const balances = await balancesFor(db, workspace.id, person.id);
  if (balances.availableUfern < feeUfern + amountUfern) {
    throw unprocessable(
      'amount',
      insufficientBalance(balances.availableUfern, feeUfern + amountUfern),
    );
  }
  if (!depositIsOpen(proposal, now())) throw conflict(depositPeriodEnded(proposal.number));
  return createTransaction(ctx, workspace.id, person.id, {
    kind: 'deposit',
    payload: { proposalNumber: proposal.number, amountUfern: amountUfern.toString() },
    holdUfern: feeUfern + amountUfern,
  });
}

const OPTIONS: VoteOption[] = ['yes', 'no', 'no_with_veto', 'abstain'];

export async function createVote(
  ctx: RequestContext,
  id: string,
  number: string,
): Promise<StoredResponse> {
  const { workspace, role, person } = await requireWorkspace(ctx, id);
  const proposal = await requireProposal(workspace.id, number);
  const replay = await replayIdempotent(ctx, workspace.id, person.id);
  if (replay) return replay;
  requireWrite(role, 'transaction');
  const option = readString(ctx, 'option') as VoteOption;
  if (!OPTIONS.includes(option)) throw unprocessable('option', 'Choose an option.');
  const feeUfern = stakingFee();
  const balances = await balancesFor(db, workspace.id, person.id);
  if (balances.availableUfern < feeUfern) {
    throw unprocessable('option', insufficientBalance(balances.availableUfern, feeUfern));
  }
  const at = now();
  if (proposal.status === 'deposit') throw conflict(votingNotOpen(proposal.number));
  if (!votingIsOpen(proposal, at)) throw conflict(votingPeriodEnded(proposal.number));
  return createTransaction(ctx, workspace.id, person.id, {
    kind: 'vote',
    payload: { proposalNumber: proposal.number, option },
    holdUfern: feeUfern,
  });
}
