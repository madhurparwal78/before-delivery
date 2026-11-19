import { STANDING_CHIPS } from '../shared/copy';

/**
 * The one place that derives the season's tape standing. Nothing here is stored:
 * every answer comes from one consistent snapshot of submission decisions.
 */

export type SubmissionStatus = 'pending' | 'accepted' | 'rejected' | 'reversed';

export interface StandingSubmission {
  readonly id: string;
  readonly owner_email: string;
  readonly owner_name: string;
  readonly status: SubmissionStatus;
  readonly decided_at: string | null;
}

export interface StandingRow {
  readonly rank: number;
  readonly owner_email: string;
  readonly owner_name: string;
  readonly counted: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly reversed: number;
  readonly streak: number;
  readonly standing: string;
}

/** Ids that end in a number compare by that number. */
function idOrder(id: string): [number, string] {
  const match = /(\d+)$/.exec(id);
  return [match ? Number(match[1]) : Number.MAX_SAFE_INTEGER, id];
}

function compareDecided(a: StandingSubmission, b: StandingSubmission): number {
  const left = a.decided_at ?? '';
  const right = b.decided_at ?? '';
  if (left !== right) return left < right ? -1 : 1;
  const [an, as] = idOrder(a.id);
  const [bn, bs] = idOrder(b.id);
  if (an !== bn) return an - bn;
  return as < bs ? -1 : as > bs ? 1 : 0;
}

/**
 * The run of consecutive decided submissions ending at the newest, ordered by
 * `decided_at` and then id. Accepted and reversed both count toward it, a
 * rejection ends the run, and pending submissions are skipped.
 */
function streakOf(decided: readonly StandingSubmission[]): number {
  let streak = 0;
  for (let i = decided.length - 1; i >= 0; i -= 1) {
    const status = (decided[i] as StandingSubmission).status;
    if (status === 'rejected') break;
    streak += 1;
  }
  return streak;
}

function standingChip(accepted: number, streak: number): string {
  if (accepted >= 15 && streak >= 10) return STANDING_CHIPS.true_tape;
  if (accepted >= 10) return STANDING_CHIPS.steady_tape;
  return STANDING_CHIPS.new_tape;
}

export function deriveStanding(submissions: readonly StandingSubmission[]): StandingRow[] {
  const byOwner = new Map<string, StandingSubmission[]>();
  for (const submission of submissions) {
    const list = byOwner.get(submission.owner_email);
    if (list) list.push(submission);
    else byOwner.set(submission.owner_email, [submission]);
  }

  const rows = [...byOwner.entries()].map(([email, own]) => {
    const decided = own.filter((item) => item.status !== 'pending').sort(compareDecided);
    const accepted = own.filter((item) => item.status === 'accepted').length;
    const rejected = own.filter((item) => item.status === 'rejected').length;
    const reversed = own.filter((item) => item.status === 'reversed').length;
    const streak = streakOf(decided);
    const earliestAccepted = decided
      .filter((item) => item.status === 'accepted')
      .map((item) => item.decided_at ?? '')
      .sort()[0] ?? '';
    return {
      owner_email: email,
      owner_name: (own[0] as StandingSubmission).owner_name,
      counted: own.length,
      accepted,
      rejected,
      reversed,
      streak,
      standing: standingChip(accepted, streak),
      earliestAccepted,
    };
  });

  rows.sort((a, b) => {
    if (a.accepted !== b.accepted) return b.accepted - a.accepted;
    const left = a.earliestAccepted === '' ? '\uffff' : a.earliestAccepted;
    const right = b.earliestAccepted === '' ? '\uffff' : b.earliestAccepted;
    if (left !== right) return left < right ? -1 : 1;
    return a.owner_email < b.owner_email ? -1 : a.owner_email > b.owner_email ? 1 : 0;
  });

  return rows.map((row, index) => ({
    rank: index + 1,
    owner_email: row.owner_email,
    owner_name: row.owner_name,
    counted: row.counted,
    accepted: row.accepted,
    rejected: row.rejected,
    reversed: row.reversed,
    streak: row.streak,
    standing: row.standing,
  }));
}
