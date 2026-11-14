import type { AnswerValue, Answers, Question } from '../../shared/types.ts';

const MAX_TEXT_CHARACTERS = 10_000;

/** The stored answer for a question key, ignoring anything inherited by the answers object. */
export function answerOf(answers: Answers, key: string): AnswerValue | undefined {
  return Object.hasOwn(answers, key) ? answers[key] : undefined;
}

/** The answer as text; empty when it is not a text answer. */
export const textOf = (answer: AnswerValue | undefined): string => (typeof answer === 'string' ? answer : '');

/** The answer as a list of values; empty when it is not a list. */
export const listOf = (answer: AnswerValue | undefined): string[] => (Array.isArray(answer) ? answer : []);

export function characterCount(text: string): number {
  return Array.from(text).length;
}

/** Unanswered: undefined, null, empty or whitespace-only text, an empty list or an empty object. */
export function isBlank(value: AnswerValue | null | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return Object.keys(value).length === 0;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every((item) => typeof item === 'string');
}

function isShortText(value: unknown): value is string {
  return typeof value === 'string' && characterCount(value) <= MAX_TEXT_CHARACTERS;
}

/** Whether `value` may be committed as the answer to `question` (null clears an answer). */
export function answerFits(question: Question, value: unknown): boolean {
  if (value === null) return true;
  const optionValues = (question.options ?? []).map((option) => option.value);
  switch (question.type) {
    case 'short_text':
    case 'long_text':
    case 'number':
    case 'date':
    case 'scale':
      return isShortText(value);
    case 'choice':
    case 'dropdown':
      return typeof value === 'string' && optionValues.includes(value);
    case 'checkbox':
      return isStringList(value) && new Set(value).size === value.length
        && value.every((item) => optionValues.includes(item));
    case 'grid': {
      const rows = (question.rows ?? []).map((row) => row.value);
      const columns = (question.columns ?? []).map((column) => column.value);
      return isStringRecord(value)
        && Object.entries(value).every(([row, column]) => rows.includes(row) && columns.includes(column));
    }
    case 'ranking':
      return isStringList(value) && value.length === optionValues.length && new Set(value).size === value.length
        && value.every((item) => optionValues.includes(item));
    case 'file':
    case 'calculated':
      return false;
  }
}

type Merged = { answers: Answers; invalid: null } | { answers: null; invalid: string };

/** Fold answers sent by a person into the stored ones: null or blank text clears, anything else must fit its question. */
export function mergeAnswers(questions: Question[], base: Answers, incoming: Record<string, unknown>): Merged {
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const answers: Answers = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    const question = byKey.get(key);
    if (!question) return { answers: null, invalid: key };
    if (value === null || (typeof value === 'string' && value.trim() === '')) {
      delete answers[key];
    } else if (answerFits(question, value)) {
      answers[key] = value as AnswerValue;
    } else {
      return { answers: null, invalid: key };
    }
  }
  return { answers, invalid: null };
}
