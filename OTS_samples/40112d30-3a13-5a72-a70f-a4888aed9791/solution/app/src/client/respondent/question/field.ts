import type { AnswerValue, Evaluation, EvalQuestion } from '../../../shared/types.ts';

/** What a question needs from the page it sits on. */
export interface FieldEnv {
  readonly responseId: string;
  readonly today: string;
  commit(key: string, value: AnswerValue | null): void;
  /** Enter in a short box: commit, then press Next (or Submit). */
  advance(): void;
  refuse(error: unknown): void;
  track(work: Promise<unknown>): void;
}

/** One question block on the page. The page patches it in place when a commit reply arrives, so focus and typed text survive. */
export interface Field {
  readonly key: string;
  readonly element: HTMLElement;
  update(item: EvalQuestion, evaluation: Evaluation): void;
  showError(message: string): void;
  clearError(): void;
  /** Where the error summary's link takes focus (brief: Error summary). */
  focusTarget(): HTMLElement;
  /** Commits a box that is still being typed in. */
  flush?(): void;
}
