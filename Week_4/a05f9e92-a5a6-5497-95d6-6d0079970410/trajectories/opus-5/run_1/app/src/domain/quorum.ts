/**
 * Quorum rules. Each approval step is decided here as soon as its outcome is
 * certain, and the tally copy is built from the same numbers.
 */

export type QuorumRule = 'all' | 'any' | 'n_of_m' | 'weighted';

export type StepStatus = 'not_started' | 'open' | 'approved' | 'rejected';

export type Decision = 'approve' | 'reject';

export interface Voter {
  readonly username: string;
  readonly weight: number;
  readonly decision: Decision | null;
  readonly votedBy: string | null;
}

export interface Tally {
  readonly approve: number;
  readonly reject: number;
  readonly waiting: number;
  readonly needed: number;
  readonly of: number;
  readonly approveWeight: number;
  readonly rejectWeight: number;
  readonly waitingWeight: number;
  readonly totalWeight: number;
}

export interface QuorumSetup {
  readonly rule: QuorumRule;
  readonly n: number | null;
  readonly thresholdPercent: number | null;
}

export function tallyOf(voters: readonly Voter[], setup: QuorumSetup): Tally {
  const approve = voters.filter((v) => v.decision === 'approve').length;
  const reject = voters.filter((v) => v.decision === 'reject').length;
  const waiting = voters.length - approve - reject;
  const totalWeight = voters.reduce((sum, v) => sum + v.weight, 0);
  const approveWeight = weightOf(voters, 'approve');
  const rejectWeight = weightOf(voters, 'reject');
  return {
    approve,
    reject,
    waiting,
    needed: neededOf(voters, setup, totalWeight),
    of: setup.rule === 'weighted' ? totalWeight : voters.length,
    approveWeight,
    rejectWeight,
    waitingWeight: totalWeight - approveWeight - rejectWeight,
    totalWeight,
  };
}

function weightOf(voters: readonly Voter[], decision: Decision): number {
  return voters.filter((v) => v.decision === decision).reduce((sum, v) => sum + v.weight, 0);
}

function neededOf(voters: readonly Voter[], setup: QuorumSetup, totalWeight: number): number {
  switch (setup.rule) {
    case 'all':
      return voters.length;
    case 'any':
      return 1;
    case 'n_of_m':
      return setup.n ?? voters.length;
    case 'weighted': {
      const threshold = setup.thresholdPercent ?? 100;
      // The smallest whole weight N with 100 * N >= t * T.
      return Math.ceil((threshold * totalWeight) / 100);
    }
  }
}

/** The step's outcome once it is certain, or null while it is still open. */
export function decide(voters: readonly Voter[], setup: QuorumSetup): 'approved' | 'rejected' | null {
  const a = voters.filter((v) => v.decision === 'approve').length;
  const r = voters.filter((v) => v.decision === 'reject').length;
  const m = voters.length;
  if (m === 0) return null;
  switch (setup.rule) {
    case 'all':
      if (r >= 1) return 'rejected';
      return a === m ? 'approved' : null;
    case 'any':
      if (a >= 1) return 'approved';
      return r === m ? 'rejected' : null;
    case 'n_of_m': {
      const n = setup.n ?? m;
      if (a >= n) return 'approved';
      return r > m - n ? 'rejected' : null;
    }
    case 'weighted': {
      const t = setup.thresholdPercent ?? 100;
      const total = voters.reduce((sum, v) => sum + v.weight, 0);
      const approveWeight = weightOf(voters, 'approve');
      const rejectWeight = weightOf(voters, 'reject');
      if (100 * approveWeight >= t * total) return 'approved';
      if (100 * (total - rejectWeight) < t * total) return 'rejected';
      return null;
    }
  }
}

/** The published tally copy. */
export function tallyText(tally: Tally, rule: QuorumRule, status: StepStatus): string {
  const base =
    rule === 'weighted'
      ? `Approve weight ${tally.approveWeight}, reject weight ${tally.rejectWeight}, waiting weight ${tally.waitingWeight}. Needs ${tally.needed} of ${tally.totalWeight}.`
      : `Approve ${tally.approve}, reject ${tally.reject}, waiting ${tally.waiting}. Needs ${tally.needed} of ${tally.of}.`;
  if (status === 'approved') return `${base} Closed: approved`;
  if (status === 'rejected') return `${base} Closed: rejected`;
  return base;
}
