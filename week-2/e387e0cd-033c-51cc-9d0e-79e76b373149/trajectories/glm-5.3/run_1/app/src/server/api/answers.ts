import { errors, ApiError } from './errors.js';

// The one rule that covers a network answer message and a data request page
// answer for a case whose data went to that counterparty.
export type AnswerOutcome =
  | { kind: 'applied'; decision: 'accepted' | 'rejected'; late: boolean; status: string }
  | { kind: 'refused'; error: ApiError };

export function applyAnswerToCase(
  caseRow: { status: string; outcome: string | null; answer_decision: string | null; path: string; answer_due_at: Date | null },
  decision: 'accepted' | 'rejected',
  now: Date,
  _via: 'network' | 'request_page',
): AnswerOutcome {
  if (caseRow.outcome !== null || caseRow.answer_decision !== null || caseRow.status === 'released' || caseRow.status === 'returned') {
    return { kind: 'refused', error: notExpected() };
  }
  if (caseRow.path === 'sunrise' && caseRow.status === 'cleared') {
    return { kind: 'applied', decision, late: false, status: 'cleared' };
  }
  if (caseRow.status === 'awaiting_answer') {
    const due = caseRow.answer_due_at;
    if (due !== null && now.getTime() < due.getTime()) {
      return { kind: 'applied', decision, late: false, status: decision === 'accepted' ? 'accepted' : 'rejected' };
    }
    return { kind: 'applied', decision, late: true, status: 'no_response' };
  }
  if (caseRow.status === 'no_response') {
    return { kind: 'applied', decision, late: true, status: 'no_response' };
  }
  return { kind: 'refused', error: notExpected() };
}

function notExpected(): ApiError {
  return errors.conflict('answer_not_expected', 'This case is not waiting for your answer.');
}
