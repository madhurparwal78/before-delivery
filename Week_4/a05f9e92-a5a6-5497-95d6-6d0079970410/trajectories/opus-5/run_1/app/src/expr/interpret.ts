/**
 * The interpreter. A parsed tree is walked; user text never becomes code.
 */

import { ApiError } from '../errors';
import type { Node, ParsedExpression } from './ast';
import { pathsOf } from './ast';
import { ExpressionSyntaxError } from './lexer';
import { parse } from './parser';
import {
  asInstant,
  isEmptyValue,
  isList,
  sameValue,
  TimeValue,
  unknownPath,
  valueToText,
  type Lookup,
  type Value,
} from './value';

/** What an expression may read. Each context supplies its own roots. */
export interface Scope {
  /** A path's value, or `unknownPath` when the context does not know it. */
  lookup(path: readonly string[]): Lookup;
  /** The value this save started from, for change detection. */
  previous?(path: readonly string[]): Lookup;
  /** The signed-in username, for me(). */
  me(): string | null;
  hasRole(role: string): boolean;
  now(): number;
  businessDaysSince(value: Value): number;
}

/** Raised when a path cannot be read, which is an error at save time. */
export class ExpressionFieldError extends Error {
  constructor(readonly path: readonly string[]) {
    super(`Unknown field "${path.join('.')}".`);
    this.name = 'ExpressionFieldError';
  }
}

function read(scope: Scope, path: readonly string[]): Value {
  const found = scope.lookup(path);
  if (found === unknownPath) throw new ExpressionFieldError(path);
  return found;
}

function readPrevious(scope: Scope, path: readonly string[]): Value {
  const found = scope.previous ? scope.previous(path) : unknownPath;
  if (found === unknownPath) throw new ExpressionFieldError(path);
  return found;
}

function pathOfArgument(node: Node): readonly string[] {
  if (node.kind !== 'path') throw new ExpressionFieldError([valueToText(null)]);
  return node.path;
}

function numeric(v: Value): number | null {
  if (typeof v === 'number') return v;
  return null;
}

function compare(op: string, left: Value, right: Value): boolean {
  if (op === '=') return sameValue(left, right);
  if (op === '!=') return !sameValue(left, right);
  if (op === 'in') {
    if (isList(right)) return right.some((item) => sameValue(item, left));
    if (typeof right === 'string' && typeof left === 'string') return right.includes(left);
    return false;
  }
  if (op === 'contains') {
    if (isList(left)) return left.some((item) => sameValue(item, right));
    if (typeof left === 'string' && typeof right === 'string') {
      return left.toLowerCase().includes(right.toLowerCase());
    }
    return false;
  }
  if (op === 'startswith') {
    if (typeof left === 'string' && typeof right === 'string') {
      return left.toLowerCase().startsWith(right.toLowerCase());
    }
    return false;
  }
  // Ordered comparisons: numbers, strings, or an instant against an ISO string.
  if (left instanceof TimeValue || right instanceof TimeValue) {
    const a = asInstant(left);
    const b = asInstant(right);
    if (a === null || b === null) return false;
    return ordered(op, a, b);
  }
  if (typeof left === 'number' && typeof right === 'number') return ordered(op, left, right);
  if (typeof left === 'string' && typeof right === 'string') {
    return ordered(op, left < right ? -1 : left > right ? 1 : 0, 0);
  }
  return false;
}

function ordered(op: string, a: number, b: number): boolean {
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    default:
      return false;
  }
}

export function evaluate(node: Node, scope: Scope): Value {
  switch (node.kind) {
    case 'number':
    case 'string':
    case 'boolean':
      return node.value;
    case 'null':
      return null;
    case 'list':
      return node.items.map((item) => evaluate(item, scope));
    case 'path':
      return read(scope, node.path);
    case 'not':
      return !truthy(evaluate(node.operand, scope));
    case 'negate': {
      const n = numeric(evaluate(node.operand, scope));
      return n === null ? null : -n;
    }
    case 'binary':
      return evaluateBinary(node, scope);
    case 'call':
      return evaluateCall(node, scope);
  }
}

function evaluateBinary(
  node: Extract<Node, { kind: 'binary' }>,
  scope: Scope,
): Value {
  if (node.op === 'and') {
    return truthy(evaluate(node.left, scope)) ? truthy(evaluate(node.right, scope)) : false;
  }
  if (node.op === 'or') {
    return truthy(evaluate(node.left, scope)) ? true : truthy(evaluate(node.right, scope));
  }
  const left = evaluate(node.left, scope);
  const right = evaluate(node.right, scope);
  if (node.op === '+' || node.op === '-' || node.op === '*' || node.op === '/') {
    if (node.op === '+' && typeof left === 'string' && typeof right === 'string') return left + right;
    const a = numeric(left);
    const b = numeric(right);
    if (a === null || b === null) return null;
    switch (node.op) {
      case '+':
        return a + b;
      case '-':
        return a - b;
      case '*':
        return a * b;
      default:
        return b === 0 ? null : a / b;
    }
  }
  return compare(node.op, left, right);
}

function evaluateCall(node: Extract<Node, { kind: 'call' }>, scope: Scope): Value {
  switch (node.name) {
    case 'now':
      return new TimeValue(scope.now());
    case 'me':
      return scope.me();
    case 'has_role':
      return scope.hasRole(valueToText(evaluate(node.args[0], scope)));
    case 'is_empty':
      return isEmptyValue(evaluate(node.args[0], scope));
    case 'len': {
      const v = evaluate(node.args[0], scope);
      if (isList(v)) return v.length;
      if (typeof v === 'string') return v.length;
      return 0;
    }
    case 'lower':
      return valueToText(evaluate(node.args[0], scope)).toLowerCase();
    case 'upper':
      return valueToText(evaluate(node.args[0], scope)).toUpperCase();
    case 'business_days_since':
      return scope.businessDaysSince(evaluate(node.args[0], scope));
    case 'changes': {
      const path = pathOfArgument(node.args[0]);
      return !sameValue(read(scope, path), readPrevious(scope, path));
    }
    case 'changes_to': {
      const path = pathOfArgument(node.args[0]);
      const target = evaluate(node.args[1], scope);
      const current = read(scope, path);
      return !sameValue(current, readPrevious(scope, path)) && sameValue(current, target);
    }
    case 'changes_from': {
      const path = pathOfArgument(node.args[0]);
      const target = evaluate(node.args[1], scope);
      const before = readPrevious(scope, path);
      return !sameValue(read(scope, path), before) && sameValue(before, target);
    }
  }
}

export function truthy(v: Value): boolean {
  if (v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (v instanceof TimeValue) return true;
  return v.length > 0;
}

const cache = new Map<string, ParsedExpression>();

/** Parses with a small cache; syntax errors become the published 422. */
export function parseOrThrow(text: string): ParsedExpression {
  const hit = cache.get(text);
  if (hit) return hit;
  let parsed: ParsedExpression;
  try {
    parsed = parse(text);
  } catch (e) {
    if (e instanceof ExpressionSyntaxError) {
      throw new ApiError(422, 'expression_error', e.message);
    }
    throw e;
  }
  if (cache.size > 2000) cache.clear();
  cache.set(text, parsed);
  return parsed;
}

/** True when a path is one this context knows. */
export type PathChecker = (path: readonly string[]) => boolean;

/**
 * Refuses a malformed expression with the published column error. Syntax errors
 * come before unknown fields and functions, and only the leftmost is reported.
 */
export function validateExpression(text: string, known?: PathChecker): ParsedExpression {
  const parsed = parseOrThrow(text);
  const issues = [...parsed.issues];
  if (known) {
    for (const { path, col } of pathsOf(parsed.node)) {
      if (!known(path)) issues.push({ col, reason: `unknown field "${path.join('.')}"` });
    }
  }
  issues.sort((a, b) => a.col - b.col);
  const first = issues[0];
  if (first) {
    throw new ApiError(422, 'expression_error', `Expression error at column ${first.col}: ${first.reason}.`);
  }
  return parsed;
}

export function evaluateText(text: string, scope: Scope): Value {
  return evaluate(parseOrThrow(text).node, scope);
}

export function condition(text: string, scope: Scope): boolean {
  return truthy(evaluateText(text, scope));
}
