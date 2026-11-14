import { formatDecimal, isZero, ZERO } from '../decimal.ts';
import type { Decimal } from '../decimal.ts';
import { shortDate } from '../dates.ts';

/** What a formula works with. Answers that only BLANK and COUNT may look at are an opaque `collection`. */
export type Value =
  | { kind: 'blank' }
  | { kind: 'number'; value: Decimal }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'date'; value: string }
  | { kind: 'ticks'; values: string[] }
  | { kind: 'collection' };

export const BLANK: Value = { kind: 'blank' };

/** The reasons a calculation can fail, as they follow "Cannot calculate: ". */
export const REASON = {
  divisionByZero: 'division by zero.',
  needsNumber: 'it needs a number.',
  notComparable: 'these answers cannot be compared.',
  badPower: 'the power must be a whole number from 0 to 64.',
  tooLarge: 'the number is too large.',
  needsDate: 'it needs a date written YYYY-MM-DD.',
} as const;

export class CalculationFailure extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

export const numberValue = (value: Decimal): Value => ({ kind: 'number', value });
export const booleanValue = (value: boolean): Value => ({ kind: 'boolean', value });
export const dateValue = (value: string): Value => ({ kind: 'date', value });

/** Empty text is blank. */
export const textValue = (value: string): Value => (value === '' ? BLANK : { kind: 'text', value });

export const isBlankValue = (value: Value): boolean => value.kind === 'blank';

/** Blank counts as 0 in arithmetic; anything else that is not a number cannot be calculated with. */
export function toNumber(value: Value): Decimal {
  if (value.kind === 'blank') return ZERO;
  if (value.kind === 'number') return value.value;
  throw new CalculationFailure(REASON.needsNumber);
}

/** True: true, a non-zero number, non-empty text, a date and a tick list with a tick. */
export function isTruthy(value: Value): boolean {
  switch (value.kind) {
    case 'blank':
      return false;
    case 'number':
      return !isZero(value.value);
    case 'text':
      return value.value !== '';
    case 'boolean':
      return value.value;
    case 'date':
    case 'collection':
      return true;
    case 'ticks':
      return value.values.length > 0;
  }
}

/** The text a value gives when it is joined with `&` or handed to a text function. */
export function joinedText(value: Value): string {
  switch (value.kind) {
    case 'blank':
    case 'collection':
      return '';
    case 'number':
      return formatDecimal(value.value);
    case 'text':
      return value.value;
    case 'boolean':
      return value.value ? 'true' : 'false';
    case 'date':
      return shortDate(value.value);
    case 'ticks':
      return value.values.join(', ');
  }
}
