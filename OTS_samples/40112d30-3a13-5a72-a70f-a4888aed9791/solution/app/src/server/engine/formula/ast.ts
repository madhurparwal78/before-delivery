import type { Decimal } from '../decimal.ts';

type Arity = { exactly: number } | { atLeast: number };

/** Every function of the formula language with the number of values it takes. */
export const FUNCTIONS = {
  SUM: { atLeast: 1 },
  MIN: { atLeast: 1 },
  MAX: { atLeast: 1 },
  AVG: { atLeast: 1 },
  COUNT: { atLeast: 1 },
  ROUND: { exactly: 2 },
  FLOOR: { exactly: 1 },
  CEIL: { exactly: 1 },
  ABS: { exactly: 1 },
  IF: { exactly: 3 },
  BLANK: { exactly: 1 },
  LEN: { exactly: 1 },
  UPPER: { exactly: 1 },
  LOWER: { exactly: 1 },
  TRIM: { exactly: 1 },
  DATE: { exactly: 1 },
  DAYS: { exactly: 2 },
  ADD_DAYS: { exactly: 2 },
  TODAY: { exactly: 0 },
  HAS: { exactly: 2 },
  TICKED: { exactly: 1 },
} as const satisfies Record<string, Arity>;

export type FunctionName = keyof typeof FUNCTIONS;

export function isFunctionName(name: string): name is FunctionName {
  return Object.hasOwn(FUNCTIONS, name);
}

export type BinaryOperator =
  | '+' | '-' | '*' | '/' | '%' | '^' | '&'
  | '=' | '<>' | '<' | '<=' | '>' | '>='
  | 'AND' | 'OR';

export type Expression =
  | { kind: 'number'; value: Decimal }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'reference'; key: string; row: string | null; text: string; column: number }
  | { kind: 'negate'; operand: Expression }
  | { kind: 'not'; operand: Expression }
  | { kind: 'binary'; operator: BinaryOperator; left: Expression; right: Expression }
  | { kind: 'call'; name: FunctionName; args: Expression[] };
