// Parameter expressions: numbers, parameter names `d<digits>`, + - * / and parentheses.
import * as copy from '../copy.ts';
import type { Parameter } from '../types.ts';

export type ExpressionOutcome = { ok: true; value: number } | { ok: false; message: string };

/** `d` plus digits. */
export function isParameterName(name: string): boolean {
  return /^d\d+$/.test(name);
}

const SYMBOLS = ['+', '-', '*', '/', '(', ')'] as const;
type Token = { kind: 'number'; value: number } | { kind: 'name'; name: string } | { kind: 'symbol'; symbol: (typeof SYMBOLS)[number] };

function tokenize(expression: string): Token[] | null {
  const tokens: Token[] = [];
  const pattern = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([A-Za-z_]\w*)|([-+*/()]))\s*/y;
  while (pattern.lastIndex < expression.length) {
    const match = pattern.exec(expression);
    if (match === null) return null;
    const symbol = SYMBOLS.find((candidate) => candidate === match[3]);
    if (match[1] !== undefined) tokens.push({ kind: 'number', value: Number(match[1]) });
    else if (match[2] !== undefined) tokens.push({ kind: 'name', name: match[2] });
    else if (symbol !== undefined) tokens.push({ kind: 'symbol', symbol });
  }
  return tokens;
}

/** Parentheses, signs and chains of parameters nest this deep at most; deeper would only end in a stack overflow. */
const MAX_NESTING = 200;

class Failure {
  constructor(readonly message: string) {}
}

/** Evaluates one expression; names resolve through `lookup`, which throws a Failure for unknown names and cycles. */
function evaluateTokens(tokens: readonly Token[], subject: string, lookup: (name: string) => number): number {
  let at = 0;
  const peek = (): Token | undefined => tokens[at];
  const takeSymbol = (symbol: string): boolean => {
    const token = peek();
    if (token?.kind === 'symbol' && token.symbol === symbol) {
      at += 1;
      return true;
    }
    return false;
  };
  let nesting = 0;
  const primary = (): number => {
    if (nesting === MAX_NESTING) throw new Failure(copy.EXPRESSION_TOO_DEEP);
    nesting += 1;
    try {
      return operand();
    } finally {
      nesting -= 1;
    }
  };
  const operand = (): number => {
    const token = tokens[at++];
    if (token === undefined) throw new Failure(copy.NOT_A_NUMBER);
    if (token.kind === 'number') return token.value;
    if (token.kind === 'name') return lookup(token.name);
    if (token.symbol === '(') {
      const inner = sum();
      if (!takeSymbol(')')) throw new Failure(copy.NOT_A_NUMBER);
      return inner;
    }
    if (token.symbol === '-') return -primary();
    if (token.symbol === '+') return primary();
    throw new Failure(copy.NOT_A_NUMBER);
  };
  const product = (): number => {
    let value = primary();
    for (;;) {
      if (takeSymbol('*')) value *= primary();
      else if (takeSymbol('/')) {
        const divisor = primary();
        if (Math.abs(divisor) < 1e-12) throw new Failure(copy.divideByZero(subject));
        value /= divisor;
      } else return value;
    }
  };
  const sum = (): number => {
    let value = product();
    for (;;) {
      if (takeSymbol('+')) value += product();
      else if (takeSymbol('-')) value -= product();
      else return value;
    }
  };
  const result = sum();
  if (at !== tokens.length) throw new Failure(copy.NOT_A_NUMBER);
  return result;
}

/** Resolves parameters on demand, remembering values and the chain of names being evaluated (for the cycle sentence). */
class Resolver {
  private readonly values = new Map<string, number>();
  private readonly chain: string[] = [];

  constructor(private readonly parameters: Readonly<Record<string, Parameter>>) {}

  value(name: string): number {
    const known = this.values.get(name);
    if (known !== undefined) return known;
    const parameter = this.parameters[name];
    if (parameter === undefined) throw new Failure(copy.unknownParameter(name));
    const at = this.chain.indexOf(name);
    if (at >= 0) throw new Failure(copy.expressionCycle([...this.chain.slice(at), name]));
    if (this.chain.length === MAX_NESTING) throw new Failure(copy.EXPRESSION_TOO_DEEP);
    this.chain.push(name);
    const value = this.evaluate(parameter.expression, name);
    this.chain.pop();
    this.values.set(name, value);
    return value;
  }

  evaluate(expression: string, subject: string): number {
    const tokens = tokenize(expression);
    if (tokens === null || tokens.length === 0) throw new Failure(copy.NOT_A_NUMBER);
    return evaluateTokens(tokens, subject, (name) => this.value(name));
  }
}

function attempt(run: () => number): ExpressionOutcome {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    if (error instanceof Failure) return { ok: false, message: error.message };
    throw error;
  }
}

/** Numbers, parameter names, + - * / and parentheses. Errors carry the published sentences; `subject` names the thing being evaluated in the divide-by-zero text. */
export function evaluateExpression(expression: string, parameters: Readonly<Record<string, Parameter>>, subject: string): ExpressionOutcome {
  return attempt(() => new Resolver(parameters).evaluate(expression, subject));
}

/** Every parameter's value, or the first error (cycle, unknown name, division by zero). Pass the set as it would be after an edit to check an edit. */
export function evaluateParameters(parameters: Readonly<Record<string, Parameter>>): { ok: true; values: Record<string, number> } | { ok: false; message: string } {
  const resolver = new Resolver(parameters);
  const values: Record<string, number> = {};
  for (const name of Object.keys(parameters)) {
    const outcome = attempt(() => resolver.value(name));
    if (!outcome.ok) return outcome;
    values[name] = outcome.value;
  }
  return { ok: true, values };
}
