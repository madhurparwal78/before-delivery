import type { Answers, AnswerValue, FormDefinition, Pattern, Question } from '../../shared/types.ts';
import { CHECK } from '../../shared/messages.ts';
import { isBlank, listOf, textOf } from './answers.ts';
import { dateBound, dateProblem, lengthProblem, numberProblem } from './constraints.ts';
import { shortDate } from './dates.ts';
import { formulaLimits } from './env.ts';
import type { EngineEnv } from './env.ts';
import { referencedKeys } from './formula/analyze.ts';
import { parseFormula } from './formula/parser.ts';
import { numberText } from './formats.ts';
import { questionsByKey, walkForm } from './resolve.ts';
import type { Walked } from './resolve.ts';

interface CheckError {
  key: string;
  message: string;
  page: string;
}

/** An email address: also the pattern of the sign-up, resume, invitation and settings email fields. */
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const PATTERNS: Record<Pattern, { matches: RegExp; message: (label: string) => string }> = {
  email: { matches: EMAIL_PATTERN, message: CHECK.email },
  phone: { matches: /^\+?[0-9 ]{7,20}$/, message: CHECK.phone },
  digits: { matches: /^[0-9]+$/, message: CHECK.digits },
  letters: { matches: /^[A-Za-z]+$/, message: CHECK.letters },
};

function requiredMessage(question: Question, label: string): string {
  switch (question.type) {
    case 'choice':
    case 'dropdown':
    case 'scale':
      return CHECK.requiredChoice(label);
    case 'checkbox':
      return CHECK.requiredCheckbox(label);
    case 'grid':
      return CHECK.requiredGrid(label);
    case 'ranking':
      return CHECK.requiredRanking(label);
    case 'date':
      return CHECK.requiredDate(label);
    case 'file':
      return CHECK.requiredFile(label);
    case 'short_text':
    case 'long_text':
    case 'number':
    case 'calculated':
      return CHECK.requiredText(label);
  }
}

function numberMessage(question: Question, label: string, text: string): string | null {
  const problem = numberProblem(question, text);
  if (problem === 'format') return CHECK.numberFormat(label);
  if (problem === 'decimals') {
    return question.decimals === 0 ? CHECK.wholeNumber(label) : CHECK.decimals(label, question.decimals ?? 0);
  }
  if (problem === null) return null;
  const min = question.min === undefined ? null : numberText(String(question.min));
  const max = question.max === undefined ? null : numberText(String(question.max));
  if (min !== null && max !== null) return CHECK.numberRange(label, min, max);
  return min !== null ? CHECK.numberMin(label, min) : CHECK.numberMax(label, max ?? '');
}

function dateMessage(question: Question, label: string, text: string): string | null {
  const problem = dateProblem(question, text);
  if (problem === 'format') return CHECK.dateFormat(label);
  if (problem === null) return null;
  const min = dateBound(question.min);
  const max = dateBound(question.max);
  if (min !== null && max !== null) return CHECK.dateRange(label, shortDate(min), shortDate(max));
  return min !== null ? CHECK.dateMin(label, shortDate(min)) : CHECK.dateMax(label, shortDate(max ?? ''));
}

function textMessage(question: Question, label: string, text: string): string | null {
  const length = lengthProblem(question, text);
  if (length === 'min') return CHECK.minLength(label, question.min_length ?? 0);
  if (length === 'max') return CHECK.maxLength(label, question.max_length ?? 0);
  const pattern = question.pattern === undefined ? null : PATTERNS[question.pattern];
  return pattern !== null && !pattern.matches.test(text.trim()) ? pattern.message(label) : null;
}

function ticksMessage(question: Question, label: string, ticks: number): string | null {
  const { min_selected: min, max_selected: max } = question;
  if ((min === undefined || ticks >= min) && (max === undefined || ticks <= max)) return null;
  if (min !== undefined && max !== undefined) return CHECK.ticksRange(label, min, max);
  return min !== undefined ? CHECK.ticksMin(label, min) : CHECK.ticksMax(label, max ?? 0);
}

/** The first failing check of a shown question for its effective answer, in the published order; null when it passes. */
function fieldMessage(question: Question, label: string, answer: AnswerValue | undefined): string | null {
  if (answer === undefined || isBlank(answer)) return question.required === true ? requiredMessage(question, label) : null;
  switch (question.type) {
    case 'short_text':
    case 'long_text':
      return textMessage(question, label, textOf(answer));
    case 'number':
      return numberMessage(question, label, textOf(answer));
    case 'date':
      return dateMessage(question, label, textOf(answer));
    case 'checkbox':
      return ticksMessage(question, label, listOf(answer).length);
    case 'grid': {
      const cells = typeof answer === 'object' && !Array.isArray(answer) ? answer : {};
      const everyRowAnswered = (question.rows ?? []).every((row) => Object.hasOwn(cells, row.value));
      return question.required === true && !everyRowAnswered ? requiredMessage(question, label) : null;
    }
    case 'choice':
    case 'dropdown':
    case 'scale':
    case 'ranking':
    case 'file':
    case 'calculated':
      return null;
  }
}

/**
 * Whether every question a check formula refers to, directly or through calculated fields, is shown, answered
 * and free of errors.
 */
function inputsReady(
  formula: string, walked: Walked, fieldErrors: ReadonlyMap<string, string>, env: EngineEnv, seen: Set<string>,
): boolean {
  const parsed = parseFormula(formula, formulaLimits(env));
  if (!parsed.ok) return false;
  const shown = questionsByKey(walked.resolved);
  return referencedKeys(parsed.expression).every((key) => {
    const entry = walked.outline.byKey.get(key);
    if (entry === undefined || shown.get(key)?.state !== 'lit') return false;
    if (entry.question.type !== 'calculated') return walked.effective.has(key) && !fieldErrors.has(key);
    if (seen.has(key)) return true;
    seen.add(key);
    return inputsReady(entry.question.formula ?? '', walked, fieldErrors, env, seen);
  });
}

/**
 * The errors on the shown questions of one page (`scope.kind` 'page') or of every shown page (`'all'`), in
 * form order, at most one per question: field checks first, then the form-level checks.
 */
export function checkAnswers(
  definition: FormDefinition, answers: Answers, env: EngineEnv,
  scope: { kind: 'page'; page: string } | { kind: 'all' },
): CheckError[] {
  const walked = walkForm(definition, answers, env);
  const shown = questionsByKey(walked.resolved);
  const pagesShown = new Set(walked.resolved.shownPageKeys);
  const messages = new Map<string, string>();

  for (const { question } of walked.outline.questions) {
    const resolved = shown.get(question.key);
    if (resolved?.state !== 'lit' || question.type === 'calculated') continue;
    const message = fieldMessage(question, resolved.label, walked.effective.get(question.key));
    if (message !== null) messages.set(question.key, message);
  }

  for (const check of definition.checks) {
    const failed = shown.get(check.target)?.state === 'lit' && pagesShown.has(check.page) && !messages.has(check.target)
      && inputsReady(check.fail_when, walked, messages, env, new Set())
      && walked.isMet(check.fail_when);
    if (failed) messages.set(check.target, walked.fill(check.message));
  }

  return walked.outline.questions
    .filter(({ question, page }) => messages.has(question.key) && (scope.kind === 'all' || scope.page === page.key))
    .map(({ question, page }) => ({ key: question.key, message: messages.get(question.key) ?? '', page: page.key }));
}
