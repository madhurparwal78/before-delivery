import type { Answers, CalcValue, EvalPage, Evaluation, FormDefinition } from '../../shared/types.ts';
import { M05, M45, M46 } from '../../shared/messages.ts';
import { answerOf, isBlank } from './answers.ts';
import type { EngineEnv } from './env.ts';
import { questionsByKey, resolve } from './resolve.ts';
import type { Resolved } from './resolve.ts';

interface EvaluationOptions {
  /** 'respondent' leaves hidden calculated fields out; 'owner' (a trial of the draft) keeps them. */
  audience: 'owner' | 'respondent';
  seq: number;
  /** The page the respondent is on; page_number and the respondent's announcement follow it. */
  currentPage?: string;
  /** The answers before this commit: fills hidden_now and restored. */
  prior?: Answers;
}

/** Counts the answers this commit hid (`hidden_now`) and the hidden answers it brought back (`restored`). */
function pathChanges(before: Resolved, after: Resolved, prior: Answers, answers: Answers): { hidden: number; restored: number } {
  const earlier = questionsByKey(before);
  const later = questionsByKey(after);
  const hidden = before.counting.filter((key) => later.get(key)?.state === 'skipped' && !isBlank(answerOf(answers, key)));
  const restored = after.counting.filter((key) => earlier.get(key)?.state === 'skipped' && !isBlank(answerOf(prior, key)));
  return { hidden: hidden.length, restored: restored.length };
}

/** The Evaluation object returned by commits, trials, page moves and resume. */
export function evaluate(
  definition: FormDefinition, answers: Answers, env: EngineEnv, options: EvaluationOptions,
): Evaluation {
  const resolved = resolve(definition, answers, env);
  const respondent = options.audience === 'respondent';
  const included = resolved.questions.filter((question) => !(respondent && question.calc?.hidden === true));

  const pages: EvalPage[] = resolved.pages.map((page) => ({
    key: page.key,
    title: page.title,
    state: page.state,
    skipped_by: page.skipped_by,
    questions: included
      .filter((question) => question.page === page.key)
      .map(({ key, state, skipped_by, label, help }) => ({ key, state, skipped_by, label, help })),
  }));

  const values: Record<string, CalcValue> = {};
  for (const question of included) {
    if (question.calc !== null) values[question.key] = { value: question.calc.value, text: question.calc.text };
  }

  const shownPages = resolved.shownPageKeys.length;
  const current = resolved.pages.find((page) => page.key === options.currentPage && page.state === 'lit');
  const pageNumber = current === undefined ? 0 : resolved.shownPageKeys.indexOf(current.key) + 1;

  const changes = options.prior === undefined
    ? { hidden: 0, restored: 0 }
    : pathChanges(resolve(definition, options.prior, env), resolved, options.prior, answers);

  return {
    seq: options.seq,
    pages,
    shown_pages: shownPages,
    page_number: pageNumber,
    values,
    hidden_now: changes.hidden,
    restored: changes.restored,
    announce: respondent
      ? (current === undefined ? '' : M05(pageNumber, shownPages, current.title))
      : trialAnnouncement(definition, resolved),
  };
}

/** M45, naming the form's last calculated field that respondents can see, or M46 when there is none. */
function trialAnnouncement(definition: FormDefinition, resolved: Resolved): string {
  const lit = resolved.shownPageKeys.length;
  const all = definition.pages.length;
  const last = resolved.questions.findLast((question) => question.calc !== null && !question.calc.hidden);
  return last?.calc ? M45(lit, all, last.label, last.calc.text) : M46(lit, all);
}
