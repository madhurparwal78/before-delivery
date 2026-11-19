export type ProposalStatus =
  | 'deposit'
  | 'voting'
  | 'passed'
  | 'rejected'
  | 'rejected_with_veto'
  | 'rejected_quorum'
  | 'failed_deposit';

export const PROPOSAL_STATUS_TEXT: Record<ProposalStatus, string> = {
  deposit: 'Deposit period',
  voting: 'Voting period',
  passed: 'Passed',
  rejected: 'Rejected',
  rejected_with_veto: 'Rejected with veto',
  rejected_quorum: 'Rejected — quorum not reached',
  failed_deposit: 'Failed — deposit not met',
};

export type VoteOption = 'yes' | 'no' | 'no_with_veto' | 'abstain';

export const VOTE_OPTION_LABELS: Record<VoteOption, string> = {
  yes: 'Yes',
  no: 'No',
  no_with_veto: 'No with veto',
  abstain: 'Abstain',
};

export interface TallyCounts {
  yes: bigint;
  no: bigint;
  noWithVeto: bigint;
  abstain: bigint;
}

export function totalVotes(counts: TallyCounts): bigint {
  return counts.yes + counts.no + counts.noWithVeto + counts.abstain;
}

const QUORUM_PER_MILLE = 334n;
const VETO_PER_MILLE = 334n;

/** The published tally rule, decided on exact fractions. */
export function tallyOutcome(counts: TallyCounts, totalBonded: bigint): ProposalStatus {
  const votes = totalVotes(counts);
  if (votes * 1000n < QUORUM_PER_MILLE * totalBonded) return 'rejected_quorum';
  if (counts.noWithVeto * 1000n > VETO_PER_MILLE * votes) return 'rejected_with_veto';
  const decisive = votes - counts.abstain;
  if (counts.yes * 2n > decisive) return 'passed';
  return 'rejected';
}

/** Deposits are burned on a quorum failure and on a veto. */
export function depositsBurned(status: ProposalStatus): boolean {
  return status === 'rejected_quorum' || status === 'rejected_with_veto';
}
