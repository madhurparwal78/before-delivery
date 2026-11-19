import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { Queryable } from '../db.js';
import { queueMail } from '../mail.js';
import { UFERN_PER_FERN } from '../../shared/fees.js';
import { formatTime } from '../../shared/format.js';
import {
  depositsBurned,
  ProposalStatus,
  PROPOSAL_STATUS_TEXT,
  TallyCounts,
  tallyOutcome,
  VoteOption,
} from '../../shared/governance.js';
import { BURN_ACCOUNT, depositsAccount, memberAccount, postPair } from './ledger.js';
import { totalBonded } from './staking.js';
import { membersOf } from './workspaces.js';

export const minDepositUfern = BigInt(config.minDepositFern) * UFERN_PER_FERN;

export interface ProposalRow {
  id: string;
  workspace_id: string;
  number: number;
  title: string;
  description: string;
  status: ProposalStatus;
  deposit_ufern: string;
  deposit_ends_at: Date;
  voting_starts_at: Date | null;
  voting_ends_at: Date | null;
  final_tally: StoredTally | null;
  reminded_at: Date | null;
}

export interface StoredTally {
  yes: string;
  no: string;
  noWithVeto: string;
  abstain: string;
  totalBonded: string;
}

export async function proposalsOf(tx: Queryable, workspaceId: string): Promise<ProposalRow[]> {
  const { rows } = await tx.query<ProposalRow>(
    `SELECT id, workspace_id, number, title, description, status, deposit_ufern::text,
            deposit_ends_at, voting_starts_at, voting_ends_at, final_tally, reminded_at
     FROM proposals WHERE workspace_id = $1 ORDER BY number`,
    [workspaceId],
  );
  return rows;
}

export async function proposalByNumber(
  tx: Queryable,
  workspaceId: string,
  number: number,
): Promise<ProposalRow | null> {
  const { rows } = await tx.query<ProposalRow>(
    `SELECT id, workspace_id, number, title, description, status, deposit_ufern::text,
            deposit_ends_at, voting_starts_at, voting_ends_at, final_tally, reminded_at
     FROM proposals WHERE workspace_id = $1 AND number = $2`,
    [workspaceId, number],
  );
  return rows[0] ?? null;
}

/** Voting power is the voter's bonded stake at the moment of tally. */
export async function liveTally(
  tx: Queryable,
  workspaceId: string,
  proposalId: string,
): Promise<{ counts: TallyCounts; bonded: bigint }> {
  const { rows } = await tx.query<{ option: VoteOption; power: string | null }>(
    `SELECT v.option,
            (SELECT sum(d.amount_ufern)::text FROM delegations d
              WHERE d.workspace_id = v.workspace_id
                AND ((v.person_id IS NOT NULL AND d.person_id = v.person_id)
                  OR (v.validator_id IS NOT NULL AND d.validator_id = v.validator_id
                      AND d.person_id IS NULL))) AS power
     FROM votes v WHERE v.proposal_id = $1`,
    [proposalId],
  );
  const counts: TallyCounts = { yes: 0n, no: 0n, noWithVeto: 0n, abstain: 0n };
  for (const row of rows) {
    const power = BigInt(row.power ?? '0');
    if (row.option === 'yes') counts.yes += power;
    else if (row.option === 'no') counts.no += power;
    else if (row.option === 'no_with_veto') counts.noWithVeto += power;
    else counts.abstain += power;
  }
  return { counts, bonded: await totalBonded(tx, workspaceId) };
}

export function storedToCounts(stored: StoredTally): { counts: TallyCounts; bonded: bigint } {
  return {
    counts: {
      yes: BigInt(stored.yes),
      no: BigInt(stored.no),
      noWithVeto: BigInt(stored.noWithVeto),
      abstain: BigInt(stored.abstain),
    },
    bonded: BigInt(stored.totalBonded),
  };
}

export async function tallyOf(
  tx: Queryable,
  proposal: ProposalRow,
): Promise<{ counts: TallyCounts; bonded: bigint; result: ProposalStatus }> {
  if (proposal.final_tally) {
    const { counts, bonded } = storedToCounts(proposal.final_tally);
    return { counts, bonded, result: proposal.status };
  }
  const { counts, bonded } = await liveTally(tx, proposal.workspace_id, proposal.id);
  const result = proposal.status === 'deposit' ? 'deposit' : tallyOutcome(counts, bonded);
  return { counts, bonded, result };
}

async function openVoting(tx: Queryable, proposal: ProposalRow, at: Date): Promise<void> {
  const votingEndsAt = new Date(at.getTime() + config.votingPeriodSeconds * 1000);
  await tx.query(
    `UPDATE proposals SET status = 'voting', voting_starts_at = $2, voting_ends_at = $3
     WHERE id = $1`,
    [proposal.id, at, votingEndsAt],
  );
  const members = await membersOf(tx, proposal.workspace_id);
  const { rows } = await tx.query<{ name: string }>('SELECT name FROM workspaces WHERE id = $1', [
    proposal.workspace_id,
  ]);
  const workspaceName = rows[0].name;
  for (const member of members) {
    await queueMail(
      tx,
      proposal.workspace_id,
      {
        recipient: member.email,
        subject: `Voting is open on proposal ${proposal.number}: ${proposal.title}`,
        body: `Proposal ${proposal.number} "${proposal.title}" in ${workspaceName} on Fernsquare is open for voting until ${formatTime(
          votingEndsAt.toISOString(),
          config.timeZone,
        )}.`,
      },
      at,
    );
  }
}

export async function applyProposal(
  tx: Queryable,
  workspaceId: string,
  personId: string,
  title: string,
  description: string,
  initialDepositUfern: bigint,
  height: number,
  at: Date,
): Promise<number> {
  const { rows } = await tx.query<{ next: string }>(
    'SELECT coalesce(max(number), 0)::text AS next FROM proposals WHERE workspace_id = $1',
    [workspaceId],
  );
  const number = Number(rows[0].next) + 1;
  const id = randomUUID();
  const depositEndsAt = new Date(at.getTime() + config.depositPeriodSeconds * 1000);
  await tx.query(
    `INSERT INTO proposals
       (id, workspace_id, number, title, description, status, deposit_ufern, deposit_ends_at, created_at)
     VALUES ($1, $2, $3, $4, $5, 'deposit', $6, $7, $8)`,
    [id, workspaceId, number, title, description, initialDepositUfern, depositEndsAt, at],
  );
  if (initialDepositUfern > 0n) {
    await recordDeposit(tx, workspaceId, id, number, personId, initialDepositUfern, height, at);
  }
  if (initialDepositUfern >= minDepositUfern) {
    const proposal = (await proposalByNumber(tx, workspaceId, number)) as ProposalRow;
    await openVoting(tx, proposal, at);
  }
  return number;
}

async function recordDeposit(
  tx: Queryable,
  workspaceId: string,
  proposalId: string,
  proposalNumber: number,
  personId: string,
  amountUfern: bigint,
  height: number | null,
  at: Date,
): Promise<void> {
  await tx.query(
    `INSERT INTO deposits (id, workspace_id, proposal_id, person_id, amount_ufern, at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), workspaceId, proposalId, personId, amountUfern, at],
  );
  await postPair(tx, {
    workspaceId,
    debit: memberAccount(personId),
    credit: depositsAccount(proposalNumber),
    amountUfern,
    kind: 'deposit',
    label: `Deposit on proposal ${proposalNumber}`,
    height,
    at,
  });
}

export async function applyDeposit(
  tx: Queryable,
  proposal: ProposalRow,
  personId: string,
  amountUfern: bigint,
  height: number,
  at: Date,
): Promise<void> {
  await recordDeposit(
    tx,
    proposal.workspace_id,
    proposal.id,
    proposal.number,
    personId,
    amountUfern,
    height,
    at,
  );
  const total = BigInt(proposal.deposit_ufern) + amountUfern;
  await tx.query('UPDATE proposals SET deposit_ufern = $2 WHERE id = $1', [proposal.id, total]);
  if (total >= minDepositUfern) {
    await openVoting(tx, { ...proposal, deposit_ufern: total.toString() }, at);
  }
}

export async function applyVote(
  tx: Queryable,
  proposal: ProposalRow,
  personId: string,
  option: VoteOption,
  at: Date,
): Promise<void> {
  const { rows } = await tx.query<{ id: string }>(
    'SELECT id FROM votes WHERE proposal_id = $1 AND person_id = $2',
    [proposal.id, personId],
  );
  if (rows[0]) {
    await tx.query('UPDATE votes SET option = $2, at = $3 WHERE id = $1', [rows[0].id, option, at]);
    return;
  }
  await tx.query(
    `INSERT INTO votes (id, workspace_id, proposal_id, person_id, option, at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), proposal.workspace_id, proposal.id, personId, option, at],
  );
}

async function settleDeposits(
  tx: Queryable,
  proposal: ProposalRow,
  status: ProposalStatus,
  at: Date,
): Promise<void> {
  const burned = depositsBurned(status);
  const { rows } = await tx.query<{ person_id: string; amount_ufern: string }>(
    'SELECT person_id, amount_ufern::text FROM deposits WHERE proposal_id = $1 ORDER BY at, id',
    [proposal.id],
  );
  for (const row of rows) {
    const amount = BigInt(row.amount_ufern);
    await postPair(tx, {
      workspaceId: proposal.workspace_id,
      debit: depositsAccount(proposal.number),
      credit: burned ? BURN_ACCOUNT : memberAccount(row.person_id),
      amountUfern: amount,
      kind: burned ? 'deposit-burn' : 'deposit-refund',
      label: burned ? 'Deposit burned' : 'Deposit refund',
      height: null,
      at,
    });
  }
}

/** Closes a proposal and stores its final tally. */
export async function finaliseProposal(
  tx: Queryable,
  proposal: ProposalRow,
  at: Date,
): Promise<ProposalStatus> {
  const { counts, bonded } = await liveTally(tx, proposal.workspace_id, proposal.id);
  const status = tallyOutcome(counts, bonded);
  const stored: StoredTally = {
    yes: counts.yes.toString(),
    no: counts.no.toString(),
    noWithVeto: counts.noWithVeto.toString(),
    abstain: counts.abstain.toString(),
    totalBonded: bonded.toString(),
  };
  await tx.query('UPDATE proposals SET status = $2, final_tally = $3 WHERE id = $1', [
    proposal.id,
    status,
    JSON.stringify(stored),
  ]);
  await settleDeposits(tx, proposal, status, at);
  return status;
}

export async function failDepositPeriod(
  tx: Queryable,
  proposal: ProposalRow,
  at: Date,
): Promise<void> {
  await tx.query("UPDATE proposals SET status = 'failed_deposit' WHERE id = $1", [proposal.id]);
  await settleDeposits(tx, proposal, 'failed_deposit', at);
}

/** Reminds every member with bonded stake who has not voted. */
export async function sendVoteReminder(
  tx: Queryable,
  proposal: ProposalRow,
  at: Date,
): Promise<void> {
  const votingEndsAt = proposal.voting_ends_at as Date;
  const { rows } = await tx.query<{ email: string; workspace_name: string }>(
    `SELECT DISTINCT p.email, w.name AS workspace_name
     FROM members m
       JOIN people p ON p.id = m.person_id
       JOIN workspaces w ON w.id = m.workspace_id
       JOIN delegations d ON d.workspace_id = m.workspace_id AND d.person_id = m.person_id
     WHERE m.workspace_id = $1
       AND NOT EXISTS (SELECT 1 FROM votes v WHERE v.proposal_id = $2 AND v.person_id = m.person_id)`,
    [proposal.workspace_id, proposal.id],
  );
  for (const row of rows) {
    await queueMail(
      tx,
      proposal.workspace_id,
      {
        recipient: row.email,
        subject: `Reminder: proposal ${proposal.number} closes at ${formatTime(
          votingEndsAt.toISOString(),
          config.timeZone,
        )}`,
        body: `Proposal ${proposal.number} "${proposal.title}" in ${row.workspace_name} on Fernsquare closes at ${formatTime(
          votingEndsAt.toISOString(),
          config.timeZone,
        )}. You have bonded stake and have not voted yet.`,
      },
      at,
    );
  }
  await tx.query('UPDATE proposals SET reminded_at = $2 WHERE id = $1', [proposal.id, at]);
}

export function statusText(status: ProposalStatus): string {
  return PROPOSAL_STATUS_TEXT[status];
}
