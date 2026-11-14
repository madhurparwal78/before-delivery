import type { Question } from '../../shared/types.ts';
import { characterCount } from './answers.ts';
import { validRealDate } from './dates.ts';
import { compareDecimals, isWhole, parseDecimal } from './decimal.ts';
import type { Decimal } from './decimal.ts';

/** The limits a question's own definition puts on an answer, decided here and nowhere else. */

function boundDecimal(bound: number | string | undefined): Decimal | null {
  return bound === undefined ? null : parseDecimal(String(bound));
}

export function dateBound(bound: number | string | undefined): string | null {
  return typeof bound === 'string' ? bound : null;
}

/** Decimal places as typed: "3.50" has two. */
function typedDecimals(text: string): number {
  return (text.trim().split('.')[1] ?? '').length;
}

export function numberProblem(question: Question, text: string): 'format' | 'decimals' | 'range' | null {
  const value = parseDecimal(text);
  if (value === null) return 'format';
  if (question.decimals !== undefined && typedDecimals(text) > question.decimals) return 'decimals';
  const min = boundDecimal(question.min);
  const max = boundDecimal(question.max);
  const belowMin = min !== null && compareDecimals(value, min) < 0;
  const aboveMax = max !== null && compareDecimals(value, max) > 0;
  return belowMin || aboveMax ? 'range' : null;
}

export function dateProblem(question: Question, text: string): 'format' | 'range' | null {
  const date = text.trim();
  if (!validRealDate(date)) return 'format';
  const min = dateBound(question.min);
  const max = dateBound(question.max);
  return (min !== null && date < min) || (max !== null && date > max) ? 'range' : null;
}

/** A scale answer is a whole number from `min` to `max`. */
export function scaleFits(question: Question, text: string): boolean {
  const value = parseDecimal(text);
  if (value === null || !isWhole(value)) return false;
  const min = boundDecimal(question.min);
  const max = boundDecimal(question.max);
  return (min === null || compareDecimals(value, min) >= 0) && (max === null || compareDecimals(value, max) <= 0);
}

/** Length is counted in characters after trimming outside spaces. */
export function lengthProblem(question: Question, text: string): 'min' | 'max' | null {
  const length = characterCount(text.trim());
  if (question.min_length !== undefined && length < question.min_length) return 'min';
  return question.max_length !== undefined && length > question.max_length ? 'max' : null;
}
