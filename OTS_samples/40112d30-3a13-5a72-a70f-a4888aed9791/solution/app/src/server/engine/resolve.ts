import type { AnswerValue, Answers, FormDefinition, Page, Question, QuestionType } from '../../shared/types.ts';
import { M10 } from '../../shared/messages.ts';
import { answerOf, isBlank } from './answers.ts';
import { showCalculated, skippedCalculated } from './calculated.ts';
import type { CalculatedDisplay, CalculatedResult } from './calculated.ts';
import { validRealDate } from './dates.ts';
import { parseDecimal } from './decimal.ts';
import { answerText, gridCell, gridRowText } from './display.ts';
import { formulaLimits } from './env.ts';
import type { EngineEnv } from './env.ts';
import { evaluateExpression } from './formula/evaluate.ts';
import type { EvaluationContext } from './formula/evaluate.ts';
import { parseFormula } from './formula/parser.ts';
import { BLANK, dateValue, isTruthy, numberValue, textValue } from './formula/value.ts';
import type { Value } from './formula/value.ts';
import { fillInsertions } from './insertion.ts';
import { outlineOf } from './outline.ts';
import type { Outline } from './outline.ts';

export interface ResolvedQuestion {
  key: string;
  type: QuestionType;
  page: string;
  state: 'lit' | 'skipped';
  skipped_by: string | null;
  /** Label and help with insertions filled. */
  label: string;
  help: string | null;
  /** Effective answer: null when the question is skipped, blank, or calculated. */
  value: AnswerValue | null;
  /** Answer text; empty when blank. For a calculated field, the shown text. */
  text: string;
  note: string | null;
  calc: CalculatedDisplay | null;
}

export interface Resolved {
  /** Every question in form order, hidden calculated fields included. */
  questions: ResolvedQuestion[];
  pages: { key: string; title: string; state: 'lit' | 'skipped'; skipped_by: string | null }[];
  shownPageKeys: string[];
  /** Keys of the shown, non-calculated questions with a non-blank effective answer: the answers that count. */
  counting: string[];
}

/** The result of walking a form once, with what the checks need to ask further questions of the same walk. */
export interface Walked {
  resolved: Resolved;
  outline: Outline;
  /** The answers to shown, non-calculated questions; blank answers and hidden answers are left out. */
  effective: ReadonlyMap<string, AnswerValue>;
  /** Whether a rule, jump or check formula is true for these answers; an error counts as not met. */
  isMet(when: string): boolean;
  /** Label, help, page title or check message with its insertions filled. */
  fill(text: string): string;
}

interface Standing {
  state: 'lit' | 'skipped';
  skippedBy: string | null;
}

const LIT: Standing = { state: 'lit', skippedBy: null };
const skippedBy = (name: string): Standing => ({ state: 'skipped', skippedBy: name });

/** What a formula sees for an effective answer to a non-calculated question. */
function answerValue(question: Question, answer: AnswerValue | undefined): Value {
  if (answer === undefined) return BLANK;
  switch (question.type) {
    case 'short_text':
    case 'long_text':
    case 'choice':
    case 'dropdown':
      return typeof answer === 'string' ? textValue(answer) : BLANK;
    case 'number':
    case 'scale': {
      const number = typeof answer === 'string' ? parseDecimal(answer) : null;
      return number === null ? BLANK : numberValue(number);
    }
    case 'date': {
      const date = typeof answer === 'string' ? answer.trim() : '';
      return validRealDate(date) ? dateValue(date) : BLANK;
    }
    case 'checkbox':
      return Array.isArray(answer) ? { kind: 'ticks', values: answer } : BLANK;
    case 'grid':
    case 'ranking':
    case 'file':
      return { kind: 'collection' };
    case 'calculated':
      return BLANK;
  }
}

/** Walks the form once, in order: rules, jumps, calculated fields and insertions, all from the same answers. */
export function walkForm(definition: FormDefinition, answers: Answers, env: EngineEnv): Walked {
  const outline = outlineOf(definition);
  const limits = formulaLimits(env);
  const pageIndexByKey = new Map(definition.pages.map((page, index) => [page.key, index]));
  const pageStanding = new Map<string, Standing>();
  const questionStanding = new Map<string, Standing>();
  const effective = new Map<string, AnswerValue>();
  const calculated = new Map<string, CalculatedResult>();

  const context: EvaluationContext = {
    today: env.today,
    read(key, row) {
      const entry = outline.byKey.get(key);
      if (entry === undefined) return BLANK;
      if (entry.question.type === 'calculated') return calculated.get(key)?.value ?? BLANK;
      const answer = effective.get(key);
      if (row === null) return answerValue(entry.question, answer);
      const column = answer === undefined ? undefined : gridCell(answer, row);
      return column === undefined ? BLANK : textValue(column);
    },
  };

  const isMet = (when: string): boolean => {
    const parsed = parseFormula(when, limits);
    if (!parsed.ok) return false;
    const outcome = evaluateExpression(parsed.expression, context);
    return outcome.ok && isTruthy(outcome.value);
  };

  const calculate = (question: Question): CalculatedResult => {
    const parsed = parseFormula(question.formula ?? '', limits);
    return showCalculated(question, parsed.ok ? evaluateExpression(parsed.expression, context) : { ok: true, value: BLANK });
  };

  const skipQuestion = (question: Question, standing: Standing): void => {
    questionStanding.set(question.key, standing);
    if (question.type === 'calculated') calculated.set(question.key, skippedCalculated(question));
  };

  const skipPage = (page: Page, standing: Standing): void => {
    pageStanding.set(page.key, standing);
    for (const question of page.questions) skipQuestion(question, standing);
  };

  const walkQuestions = (page: Page): void => {
    pageStanding.set(page.key, LIT);
    for (const question of page.questions) {
      const rule = question.show_rule;
      if (rule !== undefined && !isMet(rule.when)) {
        skipQuestion(question, skippedBy(rule.name));
        continue;
      }
      questionStanding.set(question.key, LIT);
      if (question.type === 'calculated') {
        calculated.set(question.key, calculate(question));
      } else {
        const answer = answerOf(answers, question.key);
        if (answer !== undefined && !isBlank(answer)) effective.set(question.key, answer);
      }
    }
  };

  /** The first jump of a shown page that is met and goes forward: the page it reaches and its name. */
  const firstJump = (page: Page, index: number): { until: number; name: string } | null => {
    for (const jump of page.jumps ?? []) {
      const until = pageIndexByKey.get(jump.to);
      if (until !== undefined && until > index && isMet(jump.when)) return { until, name: jump.name };
    }
    return null;
  };

  let jump: { until: number; name: string } | null = null;
  for (const [index, page] of definition.pages.entries()) {
    if (jump !== null && index < jump.until) {
      skipPage(page, skippedBy(jump.name));
    } else if (page.show_rule !== undefined && !isMet(page.show_rule.when)) {
      skipPage(page, skippedBy(page.show_rule.name));
    } else {
      walkQuestions(page);
      jump = firstJump(page, index);
    }
  }

  const standingOf = (map: Map<string, Standing>, key: string): Standing => map.get(key) ?? LIT;

  /** What `{{key}}` shows: the effective answer, or M10 when it is blank or hidden. */
  const insertionText = (key: string, row: string | null): string => {
    const entry = outline.byKey.get(key);
    if (entry === undefined) return M10;
    if (entry.question.type === 'calculated') {
      return standingOf(questionStanding, key).state === 'lit' ? calculated.get(key)?.display.text ?? M10 : M10;
    }
    const answer = effective.get(key);
    if (answer === undefined) return M10;
    return row === null ? answerText(entry.question, answer) : gridRowText(entry.question, answer, row) ?? M10;
  };
  const fill = (text: string): string => fillInsertions(text, insertionText);

  const questions = outline.questions.map(({ question, page }): ResolvedQuestion => {
    const standing = standingOf(questionStanding, question.key);
    const calc = calculated.get(question.key)?.display ?? null;
    const answer = effective.get(question.key);
    return {
      key: question.key,
      type: question.type,
      page: page.key,
      state: standing.state,
      skipped_by: standing.skippedBy,
      label: fill(question.label),
      help: question.help ? fill(question.help) : null,
      value: answer ?? null,
      text: calc !== null ? calc.text : answer === undefined ? '' : answerText(question, answer),
      note: question.note ?? null,
      calc,
    };
  });

  const pages = definition.pages.map((page) => {
    const standing = standingOf(pageStanding, page.key);
    return { key: page.key, title: fill(page.title), state: standing.state, skipped_by: standing.skippedBy };
  });

  return {
    outline,
    effective,
    isMet,
    fill,
    resolved: {
      questions,
      pages,
      shownPageKeys: pages.filter((page) => page.state === 'lit').map((page) => page.key),
      counting: questions.filter((question) => effective.has(question.key)).map((question) => question.key),
    },
  };
}

export function questionsByKey(resolved: Resolved): Map<string, ResolvedQuestion> {
  return new Map(resolved.questions.map((question) => [question.key, question]));
}

export function resolve(definition: FormDefinition, answers: Answers, env: EngineEnv): Resolved {
  return walkForm(definition, answers, env).resolved;
}
