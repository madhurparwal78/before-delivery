import type { Parameter } from './model.js';

export class ExpressionError extends Error {}

type Token = { kind: 'number'; value: number } | { kind: 'name'; value: string } | { kind: 'symbol'; value: string };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      let end = index;
      while (end < text.length && /[0-9.]/.test(text[end])) end += 1;
      const raw = text.slice(index, end);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new ExpressionError(`That isn\u2019t a number.`);
      tokens.push({ kind: 'number', value });
      index = end;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      let end = index;
      while (end < text.length && /[A-Za-z0-9_]/.test(text[end])) end += 1;
      tokens.push({ kind: 'name', value: text.slice(index, end) });
      index = end;
      continue;
    }
    if ('+-*/()'.includes(char)) {
      tokens.push({ kind: 'symbol', value: char });
      index += 1;
      continue;
    }
    throw new ExpressionError(`That isn\u2019t a number.`);
  }
  return tokens;
}

interface Resolver {
  (name: string): number;
}

function parse(tokens: Token[], resolve: Resolver, context: string): number {
  let position = 0;

  const peek = (): Token | undefined => tokens[position];
  const eat = (value: string): boolean => {
    const token = peek();
    if (token && token.kind === 'symbol' && token.value === value) {
      position += 1;
      return true;
    }
    return false;
  };

  const primary = (): number => {
    if (eat('(')) {
      const value = expression();
      if (!eat(')')) throw new ExpressionError(`That isn\u2019t a number.`);
      return value;
    }
    if (eat('-')) return -primary();
    if (eat('+')) return primary();
    const token = peek();
    if (!token) throw new ExpressionError(`That isn\u2019t a number.`);
    position += 1;
    if (token.kind === 'number') return token.value;
    if (token.kind === 'name') return resolve(token.value);
    throw new ExpressionError(`That isn\u2019t a number.`);
  };

  const term = (): number => {
    let value = primary();
    for (;;) {
      if (eat('*')) {
        value *= primary();
      } else if (eat('/')) {
        const divisor = primary();
        if (divisor === 0) throw new ExpressionError(`Expression divides by zero: ${context}.`);
        value /= divisor;
      } else {
        return value;
      }
    }
  };

  const expression = (): number => {
    let value = term();
    for (;;) {
      if (eat('+')) value += term();
      else if (eat('-')) value -= term();
      else return value;
    }
  };

  const result = expression();
  if (position !== tokens.length) throw new ExpressionError(`That isn\u2019t a number.`);
  return result;
}

/** Evaluate an expression over the drawing's parameters, naming cycles and unknown names exactly. */
export function evaluateExpression(expression: string, parameters: Parameter[], context: string): number {
  const byName = new Map(parameters.map((parameter) => [parameter.name, parameter.expression]));
  const stack: string[] = [];

  const resolve = (name: string): number => {
    if (!byName.has(name)) throw new ExpressionError(`Unknown parameter: ${name}.`);
    if (stack.includes(name)) {
      const start = stack.indexOf(name);
      throw new ExpressionError(`Expression cycle: ${[...stack.slice(start), name].join(' -> ')}.`);
    }
    stack.push(name);
    const value = parse(tokenize(byName.get(name) as string), resolve, name);
    stack.pop();
    return value;
  };

  return parse(tokenize(expression), resolve, context);
}

export function parameterValue(parameters: Parameter[], name: string): number {
  return evaluateExpression(name, parameters, name);
}
