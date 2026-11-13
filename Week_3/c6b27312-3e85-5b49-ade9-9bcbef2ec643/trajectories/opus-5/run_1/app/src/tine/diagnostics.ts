import { displayAtMost, withUnit } from '../shared/numbers';

export type DiagnosticCode =
  | 'E_TOO_LARGE'
  | 'E_NONPOSITIVE'
  | 'E_TOO_MANY_OPERATIONS'
  | 'E_CUT_OUTSIDE'
  | 'E_CUT_OVERLAP'
  | 'E_TIMEOUT';

export type Diagnostic = { code: DiagnosticCode; message: string; parameter: string | null };

export const MAX_LENGTH_MM = 10000;
export const MAX_OPERATIONS = 256;

export function tooLarge(label: string, value: number, parameter: string | null): Diagnostic {
  return {
    code: 'E_TOO_LARGE',
    message: `${label} is ${withUnit(displayAtMost(value, 2), 'mm')}; Tine allows at most ${withUnit(
      displayAtMost(MAX_LENGTH_MM, 2),
      'mm',
    )}.`,
    parameter,
  };
}

export function nonPositive(label: string, parameter: string | null): Diagnostic {
  return {
    code: 'E_NONPOSITIVE',
    message: `${label} must be greater than ${withUnit('0', 'mm')}.`,
    parameter,
  };
}

export function tooManyOperations(count: number): Diagnostic {
  return {
    code: 'E_TOO_MANY_OPERATIONS',
    message: `Part has ${displayAtMost(count, 0)} operations after repeats; Tine allows at most ${MAX_OPERATIONS}.`,
    parameter: null,
  };
}

export function cutOutside(
  cutLabel: string,
  size: number,
  bodyWidth: number,
  bodyDepth: number,
  parameter: string | null,
): Diagnostic {
  return {
    code: 'E_CUT_OUTSIDE',
    message: `${cutLabel} (Ø ${withUnit(displayAtMost(size, 2), 'mm')}) does not fit inside the ${displayAtMost(
      bodyWidth,
      2,
    )} × ${withUnit(displayAtMost(bodyDepth, 2), 'mm')} body.`,
    parameter,
  };
}

export function cutOverlap(cutLabel: string, earlierLabel: string, parameter: string | null): Diagnostic {
  return {
    code: 'E_CUT_OVERLAP',
    message: `${cutLabel} overlaps ${earlierLabel}.`,
    parameter,
  };
}

export function timeout(timeoutMs: number): Diagnostic {
  return {
    code: 'E_TIMEOUT',
    message: `Evaluation stopped after ${withUnit(displayAtMost(timeoutMs / 1000, 2), 's')}.`,
    parameter: null,
  };
}
