import { characterCount } from '../answers.ts';
import { dayNumber, isoFromDayNumber, validRealDate } from '../dates.ts';
import {
  absoluteDecimal, addDecimals, ceilDecimal, compareDecimals, divideDecimals, fitsDigitLimit, floorDecimal,
  integerDecimal, isWhole, isZero, multiplyDecimals, negateDecimal, powerDecimal, QUOTIENT_PLACES,
  remainderDecimals, roundDecimal, subtractDecimals, truncatedInteger, ZERO,
} from '../decimal.ts';
import type { Decimal } from '../decimal.ts';
import type { Expression, FunctionName } from './ast.ts';
import {
  BLANK, booleanValue, CalculationFailure, dateValue, isBlankValue, isTruthy, joinedText, numberValue, REASON,
  textValue, toNumber,
} from './value.ts';
import type { Value } from './value.ts';

export interface EvaluationContext {
  /** The effective value of `{key}` or `{key.row}`: blank when hidden or unanswered. */
  read(key: string, row: string | null): Value;
  /** TODAY(), as YYYY-MM-DD. */
  today: string;
}

export type Outcome = { ok: true; value: Value } | { ok: false; reason: string };

const LARGEST_POWER = 64;
/** Beyond these the result is the same whatever the number is, so the argument is clamped before use. */
const ROUND_PLACES_BOUND = 10_000;
const ADD_DAYS_BOUND = 10_000_000;

const fail = (reason: string): never => {
  throw new CalculationFailure(reason);
};

function power(base: Decimal, exponent: Decimal): Decimal {
  const inRange = isWhole(exponent) && exponent.n >= 0n && exponent.n <= BigInt(LARGEST_POWER);
  if (!inRange) return fail(REASON.badPower);
  return powerDecimal(base, Number(exponent.n)) ?? fail(REASON.tooLarge);
}

function arithmetic(operator: '+' | '-' | '*' | '/' | '%' | '^', left: Decimal, right: Decimal): Decimal {
  switch (operator) {
    case '+':
      return addDecimals(left, right);
    case '-':
      return subtractDecimals(left, right);
    case '*':
      return multiplyDecimals(left, right);
    case '^':
      return power(left, right);
    case '/':
      return isZero(right) ? fail(REASON.divisionByZero) : divideDecimals(left, right, QUOTIENT_PLACES);
    case '%':
      return isZero(right) ? fail(REASON.divisionByZero) : remainderDecimals(left, right);
  }
}

/** Two answers are equal when they are the same kind and the same value, text without regard to case. */
function valuesEqual(left: Value, right: Value): boolean {
  switch (left.kind) {
    case 'number':
      return right.kind === 'number' && compareDecimals(left.value, right.value) === 0;
    case 'text':
      return right.kind === 'text' && left.value.toLowerCase() === right.value.toLowerCase();
    case 'boolean':
      return right.kind === 'boolean' && left.value === right.value;
    case 'date':
      return right.kind === 'date' && left.value === right.value;
    case 'blank':
    case 'ticks':
    case 'collection':
      return false;
  }
}

/** Orders two answers of the same orderable kind: numbers, text (without regard to case) and dates. */
function orderValues(left: Value, right: Value): number {
  if (left.kind === 'number' && right.kind === 'number') return compareDecimals(left.value, right.value);
  if (left.kind === 'text' && right.kind === 'text') {
    const [a, b] = [left.value.toLowerCase(), right.value.toLowerCase()];
    return a < b ? -1 : Number(a > b);
  }
  if (left.kind === 'date' && right.kind === 'date') return left.value < right.value ? -1 : Number(left.value > right.value);
  return fail(REASON.notComparable);
}

function compare(operator: '=' | '<>' | '<' | '<=' | '>' | '>=', left: Value, right: Value): boolean {
  const bothBlank = isBlankValue(left) && isBlankValue(right);
  if (operator === '=') return bothBlank || valuesEqual(left, right);
  if (operator === '<>') return !(bothBlank || valuesEqual(left, right));
  if (isBlankValue(left) || isBlankValue(right)) return false;
  const order = orderValues(left, right);
  switch (operator) {
    case '<':
      return order < 0;
    case '<=':
      return order <= 0;
    case '>':
      return order > 0;
    case '>=':
      return order >= 0;
  }
}

function toDate(value: Value): string {
  return value.kind === 'date' ? value.value : fail(REASON.needsDate);
}

function dateFrom(value: Value): Value {
  if (value.kind === 'blank' || value.kind === 'date') return value;
  return value.kind === 'text' && validRealDate(value.value) ? dateValue(value.value) : fail(REASON.needsDate);
}

/** IF evaluates only the side it picks. The parser has already checked that it was given three values. */
function conditional(args: readonly Expression[], context: EvaluationContext): Value {
  const [test, whenTrue, whenFalse] = args as [Expression, Expression, Expression];
  return evaluateNode(isTruthy(evaluateNode(test, context)) ? whenTrue : whenFalse, context);
}

function callFunction(name: Exclude<FunctionName, 'IF'>, args: readonly Expression[], context: EvaluationContext): Value {
  const values = args.map((argument) => evaluateNode(argument, context));
  const [first = BLANK, second = BLANK] = values;
  const present = values.filter((value) => !isBlankValue(value));
  const numbers = (): Decimal[] => present.map(toNumber);
  const anyBlank = values.some(isBlankValue);

  switch (name) {
    case 'SUM':
      return numberValue(numbers().reduce(addDecimals, ZERO));
    case 'MIN':
    case 'MAX': {
      const sign = name === 'MIN' ? -1 : 1;
      const chosen = numbers().reduce<Decimal | null>(
        (best, value) => (best === null || compareDecimals(value, best) === sign ? value : best), null,
      );
      return chosen === null ? BLANK : numberValue(chosen);
    }
    case 'AVG': {
      const all = numbers();
      if (all.length === 0) return BLANK;
      return numberValue(divideDecimals(all.reduce(addDecimals, ZERO), integerDecimal(all.length), QUOTIENT_PLACES));
    }
    case 'COUNT':
      return numberValue(integerDecimal(present.length));
    case 'ROUND':
      return anyBlank ? BLANK
        : numberValue(roundDecimal(toNumber(first), truncatedInteger(toNumber(second), ROUND_PLACES_BOUND)));
    case 'FLOOR':
      return anyBlank ? BLANK : numberValue(floorDecimal(toNumber(first)));
    case 'CEIL':
      return anyBlank ? BLANK : numberValue(ceilDecimal(toNumber(first)));
    case 'ABS':
      return anyBlank ? BLANK : numberValue(absoluteDecimal(toNumber(first)));
    case 'BLANK':
      return booleanValue(isBlankValue(first));
    case 'LEN':
      return numberValue(integerDecimal(characterCount(joinedText(first))));
    case 'UPPER':
      return textValue(joinedText(first).toUpperCase());
    case 'LOWER':
      return textValue(joinedText(first).toLowerCase());
    case 'TRIM':
      return textValue(joinedText(first).trim().replace(/\s+/g, ' '));
    case 'DATE':
      return dateFrom(first);
    case 'DAYS':
      return anyBlank ? BLANK
        : numberValue(integerDecimal(dayNumber(toDate(first)) - dayNumber(toDate(second))));
    case 'ADD_DAYS': {
      if (anyBlank) return BLANK;
      const days = dayNumber(toDate(first)) + truncatedInteger(toNumber(second), ADD_DAYS_BOUND);
      const result = isoFromDayNumber(days);
      return result === null ? fail(REASON.needsDate) : dateValue(result);
    }
    case 'TODAY':
      return dateValue(context.today);
    case 'HAS':
      return booleanValue(first.kind === 'ticks' && first.values.includes(joinedText(second)));
    case 'TICKED':
      return numberValue(integerDecimal(first.kind === 'ticks' ? first.values.length : 0));
  }
}

function evaluateNode(expression: Expression, context: EvaluationContext): Value {
  const value = evaluateStep(expression, context);
  if (value.kind === 'number' && !fitsDigitLimit(value.value)) return fail(REASON.tooLarge);
  return value;
}

function evaluateStep(expression: Expression, context: EvaluationContext): Value {
  switch (expression.kind) {
    case 'number':
      return numberValue(expression.value);
    case 'text':
      return textValue(expression.value);
    case 'boolean':
      return booleanValue(expression.value);
    case 'reference':
      return context.read(expression.key, expression.row);
    case 'negate':
      return numberValue(negateDecimal(toNumber(evaluateNode(expression.operand, context))));
    case 'not':
      return booleanValue(!isTruthy(evaluateNode(expression.operand, context)));
    case 'call':
      return expression.name === 'IF'
        ? conditional(expression.args, context)
        : callFunction(expression.name, expression.args, context);
    case 'binary': {
      const { operator, left, right } = expression;
      if (operator === 'AND') {
        return booleanValue(isTruthy(evaluateNode(left, context)) && isTruthy(evaluateNode(right, context)));
      }
      if (operator === 'OR') {
        return booleanValue(isTruthy(evaluateNode(left, context)) || isTruthy(evaluateNode(right, context)));
      }
      const leftValue = evaluateNode(left, context);
      const rightValue = evaluateNode(right, context);
      switch (operator) {
        case '&':
          return textValue(joinedText(leftValue) + joinedText(rightValue));
        case '=':
        case '<>':
        case '<':
        case '<=':
        case '>':
        case '>=':
          return booleanValue(compare(operator, leftValue, rightValue));
        default:
          return numberValue(arithmetic(operator, toNumber(leftValue), toNumber(rightValue)));
      }
    }
  }
}

/** Runs a parsed formula; a failed calculation comes back as its published reason, never as an exception. */
export function evaluateExpression(expression: Expression, context: EvaluationContext): Outcome {
  try {
    return { ok: true, value: evaluateNode(expression, context) };
  } catch (error) {
    if (error instanceof CalculationFailure) return { ok: false, reason: error.reason };
    throw error;
  }
}
