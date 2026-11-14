import type { Question } from '../../shared/types.ts';
import { M11 } from '../../shared/messages.ts';
import { shortDate } from './dates.ts';
import { fixedDecimal, formatDecimal } from './decimal.ts';
import type { Outcome } from './formula/evaluate.ts';
import { BLANK, joinedText } from './formula/value.ts';
import type { Value } from './formula/value.ts';

/** How a calculated field shows its result. */
export interface CalculatedDisplay {
  /** The unrounded Number text, ISO date, text or `true`/`false`; null when blank or failed. */
  value: string | null;
  /** The shown text: prefix and suffix around a number, M11 when blank, the Cannot-calculate sentence when failed. */
  text: string;
  /** The shown text without prefix or suffix; empty when blank or failed. */
  body: string;
  numeric: boolean;
  hidden: boolean;
  failed: boolean;
}

export interface CalculatedResult {
  /** What later formulas see: blank when the calculation failed. */
  value: Value;
  display: CalculatedDisplay;
}

function unavailable(question: Question, text: string, failed: boolean): CalculatedResult {
  return {
    value: BLANK,
    display: { value: null, text, body: '', numeric: false, hidden: question.hidden === true, failed },
  };
}

/** A calculated field that its rule or page skipped. */
export function skippedCalculated(question: Question): CalculatedResult {
  return unavailable(question, M11, false);
}

/** Turns the outcome of a calculated field's formula into its value and its shown text. */
export function showCalculated(question: Question, outcome: Outcome): CalculatedResult {
  if (!outcome.ok) return unavailable(question, `Cannot calculate: ${outcome.reason}`, true);
  const { value } = outcome;
  const hidden = question.hidden === true;
  switch (value.kind) {
    case 'blank':
      return unavailable(question, M11, false);
    case 'number': {
      const body = question.places === undefined ? formatDecimal(value.value) : fixedDecimal(value.value, question.places);
      const text = `${question.prefix ?? ''}${body}${question.suffix ?? ''}`;
      return { value, display: { value: formatDecimal(value.value), text, body, numeric: true, hidden, failed: false } };
    }
    case 'date': {
      const body = shortDate(value.value);
      return { value, display: { value: value.value, text: body, body, numeric: false, hidden, failed: false } };
    }
    case 'boolean':
    case 'text':
    case 'ticks':
    case 'collection': {
      const body = joinedText(value);
      return { value, display: { value: body, text: body, body, numeric: false, hidden, failed: false } };
    }
  }
}
