import { config } from "./config.ts";
import { maybeOne, rows, run, type Db } from "./db.ts";
import { enqueueMail } from "./outbox.ts";
import { BURN, depositsAccount, memberAccount, post } from "./ledger.ts";
import { stakingFee } from "./fee.ts";
import { latestHeight, membersOf, workspaceName } from "./workspace.ts";
import { validatorsOf, delegationsOf } from "./staking.ts";
import type { Refusal } from "./errors.ts";
import { VOTE_CHOICES, type Proposal, type ProposalStatus, type Tally, type VoteOption } from "../shared/api.ts";
import { formatFern, formatTime, parseFern, parseFernExact, percent } from "../shared/units.ts";

const STATUS_TEXT: Record<ProposalStatus, string> = {
  deposit: "Deposit period",
  voting: "Voting period",
  passed: "Passed",
  rejected: "Rejected",
  rejected_veto: "Rejected with veto",
  rejected_quorum: "Rejected — quorum not reached",
  failed: "Failed — deposit not met",
};

export interface TallyCounts {
  yes: number;
  no: number;
  noWithVeto: number;
  abstain: number;
  totalBonded: number;
}

const votesIn = (t: TallyCounts) => t.yes + t.no + t.noWithVeto + t.abstain;

/** The one place that decides a tally: quorum 33.4%, veto above 33.4% of votes, pass above 50% of non-abstaining votes. */
export function decideTally(t: TallyCounts): ProposalStatus {
  const votes = votesIn(t);
  if (t.totalBonded === 0 || votes * 1000 < 334 * t.totalBonded) return "rejected_quorum";
  if (t.noWithVeto * 1000 > 334 * votes) return "rejected_veto";
  return t.yes * 2 > votes - t.abstain ? "passed" : "rejected";
}

function tallyView(t: TallyCounts, result: string): Tally {
  const votes = votesIn(t);
  return {
    votesUfern: votes,
    totalBondedUfern: t.totalBonded,
    turnout: percent(votes, t.totalBonded, 2),
    yesUfern: t.yes,
    noUfern: t.no,
    noWithVetoUfern: t.noWithVeto,
    abstainUfern: t.abstain,
    vetoShare: percent(t.noWithVeto, votes, 2),
    yesShare: percent(t.yes, votes - t.abstain, 2),
    result,
  };
}

interface ProposalRow {
  number: number;
  title: string;
  description: string;
  status: ProposalStatus;
  depositUfern: number;
  depositEndsAt: Date;
  votingEndsAt: Date | null;
  finalTally: TallyCounts | null;
}

const PROPOSAL_COLUMNS = `number, title, description, status, deposit_ufern AS "depositUfern", deposit_ends_at AS "depositEndsAt",
  voting_ends_at AS "votingEndsAt", final_tally AS "finalTally"`;

export async function proposalOf(db: Db, workspaceId: string, number: number): Promise<ProposalRow | undefined> {
  return maybeOne<ProposalRow>(db, `SELECT ${PROPOSAL_COLUMNS} FROM proposals WHERE workspace_id = $1 AND number = $2`, [workspaceId, number]);
}

export async function proposalsOf(db: Db, workspaceId: string): Promise<ProposalRow[]> {
  return rows<ProposalRow>(db, `SELECT ${PROPOSAL_COLUMNS} FROM proposals WHERE workspace_id = $1 ORDER BY number`, [workspaceId]);
}

/** Voting power is the voter's bonded stake now: a validator's self stake, or a person's delegations. */
async function liveCounts(db: Db, workspaceId: string, number: number): Promise<TallyCounts> {
  const validators = await validatorsOf(db, workspaceId);
  const counts: TallyCounts = { yes: 0, no: 0, noWithVeto: 0, abstain: 0, totalBonded: validators.reduce((sum, v) => sum + v.stake, 0) };
  const votes = await rows<{ voter: string; option: VoteOption }>(db, "SELECT voter, option FROM votes WHERE workspace_id = $1 AND number = $2", [workspaceId, number]);
  const key = { yes: "yes", no: "no", no_with_veto: "noWithVeto", abstain: "abstain" } as const;
  for (const vote of votes) {
    const [kind, id] = vote.voter.split(":") as [string, string];
    const power =
      kind === "validator"
        ? (validators.find((v) => v.id === id)?.selfStake ?? 0)
        : (await delegationsOf(db, workspaceId, id)).reduce((sum, d) => sum + d.amount, 0);
    counts[key[vote.option]] += power;
  }
  return counts;
}

export async function proposalView(db: Db, workspaceId: string, row: ProposalRow, userId: string): Promise<Proposal> {
  const counts = row.finalTally ?? (await liveCounts(db, workspaceId, row.number));
  const result = row.status === "voting" || row.status === "deposit" ? STATUS_TEXT[decideTally(counts)] : STATUS_TEXT[row.status];
  const mine = await maybeOne<{ option: VoteOption }>(db, "SELECT option FROM votes WHERE workspace_id = $1 AND number = $2 AND voter = $3", [workspaceId, row.number, `member:${userId}`]);
  return {
    number: row.number,
    title: row.title,
    description: row.description,
    status: row.status,
    statusText: STATUS_TEXT[row.status],
    depositUfern: row.depositUfern,
    minDepositUfern: config.minDepositUfern,
    depositEndsAt: row.depositEndsAt.toISOString(),
    votingEndsAt: row.votingEndsAt?.toISOString() ?? null,
    tally: tallyView(counts, result),
    myVote: mine?.option ?? null,
  };
}

const insufficient = (funds: number, needs: number | bigint, field: string): Refusal => ({
  field,
  message: `Insufficient balance: available ${formatFern(funds)} FERN, this transaction needs ${formatFern(needs)} FERN.`,
});

const AMOUNT_FORMAT = "Amount must be an amount in FERN with at most 6 decimals.";

export type GovernanceRequest =
  | { kind: "proposal"; title: string; description: string; initialDeposit: number; exact?: bigint }
  | { kind: "deposit"; number: number; amount: number; exact?: bigint }
  | { kind: "vote"; number: number; option: VoteOption };

/** Validation of a raw proposal body: title, description, initial deposit. */
export function parseProposalBody(body: Record<string, unknown>): GovernanceRequest | Refusal {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title === "") return { field: "title", message: "Give the proposal a title." };
  if ([...title].length > 120) return { field: "title", message: "Keep the title to 120 characters or fewer." };
  const description = typeof body.description === "string" ? body.description : "";
  if ([...description].length > 2000) return { field: "description", message: "Keep the description to 2,000 characters or fewer." };
  const raw = body.initialDeposit === undefined || body.initialDeposit === "" ? "0" : body.initialDeposit;
  const initialDeposit = parseFern(raw);
  if (initialDeposit === null) return { field: "initialDeposit", message: "Initial deposit must be an amount in FERN with at most 6 decimals." };
  return { kind: "proposal", title, description, initialDeposit, ...beyondSafe(initialDeposit, raw) };
}

export function parseDepositBody(number: number, body: Record<string, unknown>): GovernanceRequest | Refusal {
  const amount = parseFern(body.amount);
  if (amount === null) return { field: "amount", message: AMOUNT_FORMAT };
  if (amount === 0) return { field: "amount", message: "Amount must be more than 0." };
  return { kind: "deposit", number, amount, ...beyondSafe(amount, body.amount) };
}

/** The exact ufern of an amount that saturated as a number, so a refusal can quote it to the last digit. */
function beyondSafe(amount: number, raw: unknown): { exact?: bigint } {
  const exact = amount === Number.MAX_SAFE_INTEGER ? parseFernExact(raw) : null;
  return exact === null ? {} : { exact };
}

export function parseVoteBody(number: number, body: Record<string, unknown>): GovernanceRequest | Refusal {
  const option = VOTE_CHOICES.find((o) => o.value === body.option)?.value;
  return option ? { kind: "vote", number, option } : { field: "option", message: "Choose an option." };
}

/** Held beyond the fee while the transaction waits for its block. */
export function heldAmount(request: GovernanceRequest): number {
  return request.kind === "proposal" ? request.initialDeposit : request.kind === "deposit" ? request.amount : 0;
}

/** Balance (422) then period (409) refusals, against the person's funds. Used when submitting and when the block takes the transaction. */
export async function refuseGovernance(db: Db, workspaceId: string, request: GovernanceRequest, at: Date, funds: number): Promise<Refusal | null> {
  const needs: number | bigint = request.kind !== "vote" && request.exact !== undefined ? BigInt(stakingFee()) + request.exact : stakingFee() + heldAmount(request);
  if (funds < needs) return insufficient(funds, needs, request.kind === "proposal" ? "initialDeposit" : request.kind === "deposit" ? "amount" : "fee");
  if (request.kind === "proposal") return null;
  const proposal = (await proposalOf(db, workspaceId, request.number)) as ProposalRow;
  if (request.kind === "deposit") {
    return proposal.status === "deposit" && at < proposal.depositEndsAt ? null : { field: null, message: `The deposit period for proposal ${request.number} has ended.` };
  }
  if (proposal.status === "deposit") return { field: null, message: `Proposal ${request.number} is not open for voting yet.` };
  return proposal.status === "voting" && proposal.votingEndsAt !== null && at < proposal.votingEndsAt
    ? null
    : { field: null, message: `The voting period for proposal ${request.number} has ended.` };
}

async function openVoting(db: Db, workspaceId: string, proposal: ProposalRow, at: Date): Promise<void> {
  const votingEndsAt = new Date(at.getTime() + config.votingPeriodMs);
  await run(db, "UPDATE proposals SET status = 'voting', voting_ends_at = $3 WHERE workspace_id = $1 AND number = $2", [workspaceId, proposal.number, votingEndsAt]);
  const name = await workspaceName(db, workspaceId);
  for (const member of await membersOf(db, workspaceId)) {
    await enqueueMail(db, member.email, `Voting is open on proposal ${proposal.number}: ${proposal.title}`, `Voting on proposal ${proposal.number} is open in ${name}. It closes at ${formatTime(votingEndsAt, config.timeZone)}.`);
  }
}

async function addDeposit(db: Db, workspaceId: string, number: number, userId: string, amount: number, height: number, at: Date): Promise<void> {
  await post(db, { workspaceId, from: memberAccount(userId), to: depositsAccount(number), amount, kind: "deposit", label: `Deposit on proposal ${number}`, height, at });
  await run(db, "INSERT INTO proposal_deposits (workspace_id, number, user_id, amount_ufern) VALUES ($1, $2, $3, $4)", [workspaceId, number, userId, amount]);
  await run(db, "UPDATE proposals SET deposit_ufern = deposit_ufern + $3 WHERE workspace_id = $1 AND number = $2", [workspaceId, number, amount]);
  const proposal = (await proposalOf(db, workspaceId, number)) as ProposalRow;
  if (proposal.status === "deposit" && proposal.depositUfern >= config.minDepositUfern) await openVoting(db, workspaceId, proposal, at);
}

/** Applies a governance transaction the block has taken. Proposals are numbered in inclusion order. */
export async function applyGovernance(db: Db, workspaceId: string, userId: string, request: GovernanceRequest, height: number, at: Date): Promise<void> {
  if (request.kind === "vote") {
    await run(
      db,
      `INSERT INTO votes (workspace_id, number, voter, option) VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, number, voter) DO UPDATE SET option = $4`,
      [workspaceId, request.number, `member:${userId}`, request.option],
    );
    return;
  }
  if (request.kind === "deposit") {
    await addDeposit(db, workspaceId, request.number, userId, request.amount, height, at);
    return;
  }
  const next = (await maybeOne<{ number: number }>(db, "SELECT COALESCE(MAX(number), 0)::int + 1 AS number FROM proposals WHERE workspace_id = $1", [workspaceId]))?.number as number;
  await run(
    db,
    "INSERT INTO proposals (workspace_id, number, title, description, status, deposit_ends_at) VALUES ($1, $2, $3, $4, 'deposit', $5)",
    [workspaceId, next, request.title, request.description, new Date(at.getTime() + config.depositPeriodMs)],
  );
  if (request.initialDeposit > 0) await addDeposit(db, workspaceId, next, userId, request.initialDeposit, height, at);
}

/** Returns every deposit of a proposal to its depositors, or burns them. */
async function settleDeposits(db: Db, workspaceId: string, number: number, burn: boolean, at: Date): Promise<void> {
  const height = await latestHeight(db, workspaceId);
  const deposits = await rows<{ userId: string; amount: number }>(
    db,
    'SELECT user_id AS "userId", amount_ufern AS amount FROM proposal_deposits WHERE workspace_id = $1 AND number = $2 ORDER BY user_id',
    [workspaceId, number],
  );
  for (const deposit of deposits) {
    await post(db, {
      workspaceId, from: depositsAccount(number), to: burn ? BURN : memberAccount(deposit.userId), amount: deposit.amount,
      kind: burn ? "deposit-burn" : "deposit-refund", label: burn ? "Deposit burned" : "Deposit refund", height, at,
    });
  }
}

/** The deposit period ended without the minimum: the proposal fails and deposits are refunded. */
export async function failProposal(db: Db, workspaceId: string, number: number, at: Date): Promise<void> {
  await run(db, "UPDATE proposals SET status = 'failed' WHERE workspace_id = $1 AND number = $2", [workspaceId, number]);
  await settleDeposits(db, workspaceId, number, false, at);
}

/** The voting period ended: the final tally decides, deposits are refunded or burned. */
export async function closeVoting(db: Db, workspaceId: string, number: number, at: Date): Promise<void> {
  const counts = await liveCounts(db, workspaceId, number);
  const status = decideTally(counts);
  await run(db, "UPDATE proposals SET status = $3, final_tally = $4 WHERE workspace_id = $1 AND number = $2", [workspaceId, number, status, JSON.stringify(counts)]);
  await settleDeposits(db, workspaceId, number, status === "rejected_veto" || status === "rejected_quorum", at);
}

/** Mail to each member with bonded stake who has not voted, once, VOTE_REMINDER_SECONDS before voting ends. */
export async function sendVoteReminders(db: Db, workspaceId: string, number: number): Promise<void> {
  await run(db, "UPDATE proposals SET reminder_sent = true WHERE workspace_id = $1 AND number = $2", [workspaceId, number]);
  const proposal = (await proposalOf(db, workspaceId, number)) as ProposalRow;
  const name = await workspaceName(db, workspaceId);
  const closes = formatTime(proposal.votingEndsAt as Date, config.timeZone);
  for (const member of await membersOf(db, workspaceId)) {
    const voted = await maybeOne(db, "SELECT 1 FROM votes WHERE workspace_id = $1 AND number = $2 AND voter = $3", [workspaceId, number, `member:${member.id}`]);
    if (voted || (await delegationsOf(db, workspaceId, member.id)).length === 0) continue;
    await enqueueMail(db, member.email, `Reminder: proposal ${number} closes at ${closes}`, `Proposal ${number}: ${proposal.title} in ${name} closes at ${closes}. You have bonded stake and have not voted yet.`);
  }
}
