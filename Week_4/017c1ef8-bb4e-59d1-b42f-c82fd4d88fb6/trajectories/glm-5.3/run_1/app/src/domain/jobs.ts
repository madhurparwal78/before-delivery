import { businessMs } from '../clock.js';

export const STAGES = [
  { state: 'applied', label: 'Applied', status_text: 'Application submitted', moved_by: 'applicant' },
  { state: 'viewed', label: 'Viewed', status_text: 'Viewed by the hiring team', moved_by: 'system' },
  { state: 'interviewing', label: 'Interviewing', status_text: 'Interviewing', moved_by: 'poster' },
  { state: 'offered', label: 'Offered', status_text: 'Offer extended', moved_by: 'poster' },
  { state: 'rejected', label: 'Rejected', status_text: 'Not selected', moved_by: 'poster' },
  { state: 'withdrawn', label: 'Withdrawn', status_text: 'Withdrawn', moved_by: 'applicant' },
] as const;

export type StageState = typeof STAGES[number]['state'];

const ALLOWED: Record<StageState, StageState[]> = {
  applied: ['viewed', 'rejected', 'withdrawn'],
  viewed: ['interviewing', 'rejected', 'withdrawn'],
  interviewing: ['offered', 'rejected', 'withdrawn'],
  offered: ['rejected'],
  rejected: [],
  withdrawn: [],
};

export const stageLabel = (state: string): string =>
  STAGES.find((s) => s.state === state)?.label ?? state;

export const statusText = (state: string): string =>
  STAGES.find((s) => s.state === state)?.status_text ?? state;

export const isLegalMove = (from: string, to: string): boolean =>
  (ALLOWED[from as StageState] ?? []).includes(to as StageState);

export type QuestionInput = {
  id?: string; type: string; text: string; required: boolean; knock_out: boolean;
  ideal: string | null; options: string[] | null; accepted: string[] | null;
  minimum: number | null; maximum: number | null;
};

/** Builder checks, reported under the control each names. */
export const validateQuestions = (questions: QuestionInput[]): Record<string, string> => {
  const fields: Record<string, string> = {};
  questions.forEach((question, index) => {
    const base = `questions.${index + 1}`;
    const text = question.text ?? '';
    if ([...text].length < 1 || [...text].length > 200) {
      fields[`${base}.text`] = 'Write the question in 1 to 200 characters.';
    }
    if (question.type === 'single_choice') {
      const options = question.options ?? [];
      if (options.length < 2) fields[`${base}.options`] = 'Add at least two options.';
      const lower = options.map((o) => o.toLowerCase());
      if (new Set(lower).size !== lower.length) fields[`${base}.options`] = 'Options must differ.';
      if (question.knock_out && !(question.accepted ?? []).some((a) => lower.includes(a.toLowerCase()))) {
        fields[`${base}.knock_out`] = 'Accept at least one option.';
      }
    }
    if (question.type === 'yes_no' && question.knock_out && !question.ideal) {
      fields[`${base}.ideal`] = 'Pick the ideal answer.';
    }
    if (question.type === 'number' && question.knock_out && question.minimum === null && question.maximum === null) {
      fields[`${base}.knock_out`] = 'Set a minimum or a maximum.';
    }
    if (question.type === 'number' && question.minimum !== null && question.maximum !== null && question.minimum > question.maximum) {
      fields[`${base}.minimum`] = 'Minimum must not exceed maximum.';
    }
    if (question.type === 'single_choice' && optionsCount(question) > 10) {
      fields[`${base}.options`] = 'A question can have up to 10 options.';
    }
  });
  return fields;
};

const optionsCount = (question: QuestionInput): number => (question.options ?? []).length;

export const checkAnswers = (
  questions: { id: string; type: string; text: string; required: boolean; ideal: string | null; options: string[] | null; accepted: string[] | null; minimum: number | null; maximum: number | null }[],
  answers: Record<string, unknown>,
): { fields: Record<string, string>; missed: string | null } => {
  const fields: Record<string, string> = {};
  let missed: string | null = null;
  const questionIds = new Set(questions.map((q) => q.id));
  for (const questionId of Object.keys(answers)) {
    if (!questionIds.has(questionId)) {
      fields.answers = 'Answer only this job\'s questions.';
    }
  }
  for (const question of questions) {
    const answer = answers[question.id];
    const has = answer !== undefined && answer !== null && answer !== '';
    if (question.required && !has) {
      fields[`answers.${question.id}`] = 'Answer this question.';
      continue;
    }
    if (!has) continue;
    if (question.type === 'number') {
      if (typeof answer !== 'number' || !Number.isInteger(answer)) {
        fields[`answers.${question.id}`] = 'Enter a whole number.';
      }
    } else if (question.type === 'single_choice') {
      if (typeof answer !== 'string' || !(question.options ?? []).includes(answer)) {
        fields[`answers.${question.id}`] = 'Choose one of the options.';
      }
    } else if (question.type === 'yes_no') {
      if (answer !== 'yes' && answer !== 'no') {
        fields[`answers.${question.id}`] = 'Choose Yes or No.';
      }
    } else if (question.type === 'short_answer') {
      if (typeof answer === 'string' && [...answer].length > 500) {
        fields[`answers.${question.id}`] = 'Keep this under 500 characters.';
      }
    }
  }
  return { fields, missed };
};

/** Knock-outs: the first missed question's text in question order. */
export const firstMissedKnockOut = (
  questions: { id: string; type: string; text: string; knock_out: boolean; ideal: string | null; options: string[] | null; accepted: string[] | null; minimum: number | null; maximum: number | null }[],
  answers: Record<string, unknown>,
): string | null => {
  for (const question of questions) {
    if (!question.knock_out) continue;
    const answer = answers[question.id];
    const missed = (() => {
      if (question.type === 'yes_no') return answer !== question.ideal;
      if (question.type === 'single_choice') return !((question.accepted ?? []).includes(String(answer)));
      if (question.type === 'number') {
        if (typeof answer !== 'number') return true;
        if (question.minimum !== null && answer < question.minimum) return true;
        if (question.maximum !== null && answer > question.maximum) return true;
        return false;
      }
      return answer === undefined || answer === null || answer === '';
    })();
    if (missed) return question.text;
  }
  return null;
};

export const jobOpen = (closesAt: Date): boolean => businessMs() < closesAt.getTime();

export type FunnelRow = { stage: string; count: number; rate: string | null };

export const funnelFor = (
  applications: {
    id: string; state: string; created_at: Date;
    history: { state: string; at: Date; by: string }[];
  }[],
): { rows: FunnelRow[]; median_first_view_minutes: number | null; automaticCount: number } => {
  const countReached = (state: string): number =>
    applications.filter((a) => a.history.some((h) => h.state === state)).length;
  const rateOf = (count: number, previous: number): string | null => {
    if (previous === 0) return null;
    return `${Math.round((count / previous) * 100)}%`;
  };
  const applied = applications.length;
  const viewed = countReached('viewed');
  const interviewing = countReached('interviewing');
  const offered = countReached('offered');
  const rows: FunnelRow[] = [
    { stage: 'applied', count: applied, rate: applied === 0 ? null : '100%' },
    { stage: 'viewed', count: viewed, rate: rateOf(viewed, applied) },
    { stage: 'interviewing', count: interviewing, rate: rateOf(interviewing, viewed) },
    { stage: 'offered', count: offered, rate: rateOf(offered, interviewing) },
  ];
  const rejected = applications.filter((a) => a.state === 'rejected');
  const automaticCount = rejected.filter((a) => a.history.some((h) => h.state === 'rejected' && h.by === 'automatic')).length;
  const withdrawn = applications.filter((a) => a.state === 'withdrawn');
  rows.push({ stage: 'rejected', count: rejected.length, rate: null });
  rows.push({ stage: 'withdrawn', count: withdrawn.length, rate: null });
  const viewMinutes = applications
    .map((a) => {
      const appliedAt = a.history.find((h) => h.state === 'applied')?.at ?? a.created_at;
      const viewedAt = a.history.find((h) => h.state === 'viewed')?.at;
      return viewedAt ? Math.floor((viewedAt.getTime() - appliedAt.getTime()) / 60000) : null;
    })
    .filter((m): m is number => m !== null)
    .sort((a, b) => a - b);
  let median: number | null = null;
  if (viewMinutes.length > 0) {
    const mid = Math.floor(viewMinutes.length / 2);
    median = viewMinutes.length % 2 === 1 ? viewMinutes[mid] : viewMinutes[mid - 1];
  }
  return { rows, median_first_view_minutes: median, automaticCount };
};
