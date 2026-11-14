import type { Answers, Evaluation, EvalPage, EvalQuestion, RespondentState, StructureQuestion } from '../../shared/types.ts';

/** The one response this page is filling in: what the server last said, and what this browser has sent since. */
export interface Run {
  readonly id: string;
  readonly formTitle: string;
  readonly today: string;
  readonly structure: Record<string, StructureQuestion>;
  /** One idempotency key per page load, reused by every attempt to submit. */
  readonly submitKey: string;
  readonly answers: Answers;
  evaluation: Evaluation;
  page: string;
}

const KEY_BYTES = 16;

function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createRun(state: RespondentState): Run {
  return {
    id: state.id,
    formTitle: state.title,
    today: state.today,
    structure: state.structure,
    submitKey: newKey(),
    answers: { ...state.answers },
    evaluation: state.evaluation,
    page: state.page,
  };
}

export const litQuestions = (page: EvalPage): EvalQuestion[] => page.questions.filter((question) => question.state === 'lit');
