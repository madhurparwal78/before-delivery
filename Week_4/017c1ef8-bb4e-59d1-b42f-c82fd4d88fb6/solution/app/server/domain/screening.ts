import { newId } from '../ids.js';
import { lengthOutside } from './text.js';

type QuestionType = 'short_answer' | 'yes_no' | 'single_choice' | 'number';

export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  required: boolean;
  knock_out: boolean;
  ideal: 'yes' | 'no' | null;
  options: string[] | null;
  accepted: string[] | null;
  minimum: number | null;
  maximum: number | null;
}

/** What a member who is not an admin of the company sees of a question. */
export function publicQuestion(question: Question): Pick<Question, 'id' | 'type' | 'text' | 'required' | 'options'> {
  return { id: question.id, type: question.type, text: question.text, required: question.required, options: question.options };
}

export const MAX_QUESTIONS = 10;
const QUESTION_TEXT_MAX = 200;
const SHORT_ANSWER_MAX = 500;
const TYPES: QuestionType[] = ['short_answer', 'yes_no', 'single_choice', 'number'];

const isBlank = (value: unknown): boolean => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);

/** A question as the builder submits it: an existing one carries its id, a new one omits it. */
export interface QuestionInput {
  id?: unknown;
  type?: unknown;
  text?: unknown;
  required?: unknown;
  knock_out?: unknown;
  ideal?: unknown;
  options?: unknown;
  accepted?: unknown;
  minimum?: unknown;
  maximum?: unknown;
}

/**
 * The builder checks, reported as `questions.<position>.<field>`. Returns the questions to store, with
 * the fields a type does not use set to null and the ids the builder gave kept.
 */
export function checkQuestions(list: QuestionInput[]): { questions: Question[]; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const questions = list.map((input, index): Question => {
    const at = `questions.${index + 1}`;
    const type = TYPES.find((candidate) => candidate === input.type) ?? 'short_answer';
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    const knockOut = input.knock_out === true;
    if (lengthOutside(text, 1, QUESTION_TEXT_MAX)) fields[`${at}.text`] = 'Write the question in 1 to 200 characters.';
    const question: Question = {
      id: typeof input.id === 'string' ? input.id : '',
      type,
      text,
      required: input.required === true,
      knock_out: knockOut,
      ideal: null,
      options: null,
      accepted: null,
      minimum: null,
      maximum: null,
    };
    if (type === 'yes_no') {
      question.ideal = input.ideal === 'yes' || input.ideal === 'no' ? input.ideal : null;
      if (knockOut && question.ideal === null) fields[`${at}.ideal`] = 'Pick the ideal answer.';
    }
    if (type === 'single_choice') {
      const options = (Array.isArray(input.options) ? input.options : []).filter((option): option is string => typeof option === 'string').map((option) => option.trim()).filter((option) => option !== '');
      question.options = options;
      question.accepted = (Array.isArray(input.accepted) ? input.accepted : []).filter((option): option is string => typeof option === 'string' && options.includes(option));
      if (options.length < 2) fields[`${at}.options`] = 'Add at least two options.';
      else if (new Set(options.map((option) => option.toLowerCase())).size < options.length) fields[`${at}.options`] = 'Options must differ.';
      if (knockOut && question.accepted.length === 0) fields[`${at}.accepted`] = 'Accept at least one option.';
    }
    if (type === 'number') {
      question.minimum = isWhole(input.minimum) ? input.minimum : null;
      question.maximum = isWhole(input.maximum) ? input.maximum : null;
      if (knockOut && question.minimum === null && question.maximum === null) fields[`${at}.minimum`] = 'Set a minimum or a maximum.';
      else if (question.minimum !== null && question.maximum !== null && question.minimum > question.maximum) fields[`${at}.minimum`] = 'Minimum must not exceed maximum.';
    }
    return question;
  });
  return { questions, fields };
}

/** Gives every new question an id. */
export const withIds = (questions: Question[]): Question[] => questions.map((question) => ({ ...question, id: question.id || newId() }));

/**
 * Checks an application's answers. Each question gets the first check it fails; every failing question is named.
 * Answers to question ids the job does not have are refused under `answers`.
 */
export function checkAnswers(questions: Question[], answers: unknown): Record<string, string> {
  const fields: Record<string, string> = {};
  const given = answers && typeof answers === 'object' && !Array.isArray(answers) ? (answers as Record<string, unknown>) : {};
  if (Object.keys(given).some((id) => !questions.some((question) => question.id === id))) fields.answers = "Answer only this job's questions.";
  for (const question of questions) {
    const answer = given[question.id];
    const message = answerProblem(question, answer);
    if (message) fields[`answers.${question.id}`] = message;
  }
  return fields;
}

function answerProblem(question: Question, answer: unknown): string | null {
  if (isBlank(answer)) return question.required ? 'Answer this question.' : null;
  if (question.type === 'number') return isWhole(answer) ? null : 'Enter a whole number.';
  if (question.type === 'single_choice') return typeof answer === 'string' && question.options?.includes(answer) ? null : 'Choose one of the options.';
  if (question.type === 'yes_no') return answer === 'yes' || answer === 'no' ? null : 'Choose Yes or No.';
  if (typeof answer !== 'string') return 'Answer this question.';
  return lengthOutside(answer, 0, SHORT_ANSWER_MAX) ? 'Keep this under 500 characters.' : null;
}

/** The text of the first knock-out question the (already valid) answers miss, or null. */
export function firstKnockOutMiss(questions: Question[], answers: unknown): string | null {
  const given = (answers && typeof answers === 'object' ? answers : {}) as Record<string, unknown>;
  const miss = questions.find((question) => question.knock_out && missed(question, given[question.id]));
  return miss ? miss.text : null;
}

function missed(question: Question, answer: unknown): boolean {
  if (isBlank(answer)) return true;
  if (question.type === 'yes_no') return answer !== question.ideal;
  if (question.type === 'single_choice') return !(typeof answer === 'string' && question.accepted?.includes(answer));
  if (question.type === 'number' && isWhole(answer)) {
    return (question.minimum !== null && answer < question.minimum) || (question.maximum !== null && answer > question.maximum);
  }
  return false;
}

export const tooManyQuestions = (count: number): boolean => count > MAX_QUESTIONS;
