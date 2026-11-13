/** Reading request fields, with the published field error values. */

import { checkText, LIMITS } from '../shared/text.js';
import type { SubmitItem } from './answers.js';
import { invalidFields, type FieldVerdict } from './errors.js';

export function field(body: unknown, name: string): unknown {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined;
  return (body as Record<string, unknown>)[name];
}

export function asPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return null;
  return value;
}

export function asPoints(value: unknown): 0 | 1 | null {
  if (value === 0) return 0;
  if (value === 1) return 1;
  return null;
}

/** A field that is missing or null is `required`; anything else that fails is `invalid`. */
export function verdictFor(value: unknown): FieldVerdict {
  return value === undefined || value === null ? 'required' : 'invalid';
}

/** A submit's answers list: 1 to 8 answers, each for a different question. */
export function readSubmitItems(body: unknown): SubmitItem[] {
  const list = field(body, 'answers');
  if (list === undefined || list === null) throw invalidFields({ answers: 'required' });
  if (!Array.isArray(list)) throw invalidFields({ answers: 'invalid' });
  if (list.length === 0) throw invalidFields({ answers: 'required' });
  if (list.length > 8) throw invalidFields({ answers: 'invalid' });

  const questions = new Set<number>();
  const items: SubmitItem[] = [];
  const texts: Record<string, FieldVerdict> = {};
  for (const held of list) {
    const question = field(held, 'question');
    if (typeof question !== 'number' || !Number.isInteger(question) || question < 1 || question > 8) {
      throw invalidFields({ answers: 'invalid' });
    }
    if (questions.has(question)) throw invalidFields({ answers: 'invalid' });
    questions.add(question);
    const text = field(held, 'text');
    const name = `question_${question}`;
    if (text === undefined || text === null) {
      texts[name] = 'required';
      continue;
    }
    if (typeof text !== 'string') {
      texts[name] = 'invalid';
      continue;
    }
    const verdict = checkText(text, LIMITS.answerText);
    if (verdict !== 'ok') {
      texts[name] = verdict;
      continue;
    }
    items.push({ question, text });
  }
  if (Object.keys(texts).length > 0) throw invalidFields(texts);
  return items;
}
