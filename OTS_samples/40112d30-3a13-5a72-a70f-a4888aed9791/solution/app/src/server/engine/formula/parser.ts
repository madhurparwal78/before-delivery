import { exactDecimal } from '../decimal.ts';
import { FUNCTIONS, isFunctionName } from './ast.ts';
import type { BinaryOperator, Expression } from './ast.ts';
import { lex } from './lexer.ts';
import type { Token, Tokens } from './lexer.ts';
import { atColumn, Refusal } from './refusal.ts';

export interface FormulaLimits {
  maxChars: number;
  maxDepth: number;
}

type ParsedFormula = { ok: true; expression: Expression } | { ok: false; refusal: string };

const COMPARISONS = ['=', '<>', '<', '<=', '>', '>='] as const;
type Comparison = (typeof COMPARISONS)[number];

const isComparison = (text: string): text is Comparison => COMPARISONS.some((candidate) => candidate === text);

function bracketDepth(tokens: readonly Token[]): number {
  let depth = 0;
  let deepest = 0;
  for (const token of tokens) {
    if (token.kind !== 'symbol') continue;
    if (token.text === '(') {
      depth += 1;
      deepest = Math.max(deepest, depth);
    } else if (token.text === ')') {
      depth = Math.max(depth - 1, 0);
    }
  }
  return deepest;
}

function arityRefusal(name: string, arity: (typeof FUNCTIONS)[keyof typeof FUNCTIONS]): string {
  const count = 'exactly' in arity ? arity.exactly : arity.atLeast;
  const values = `${count} value${count === 1 ? '' : 's'}`;
  return `${name} takes ${'exactly' in arity ? '' : 'at least '}${values}.`;
}

/** Turns the tokens into an expression by precedence climbing, loosest operator first. */
function parseTokens({ tokens, endColumn }: Tokens): Expression {
  let index = 0;

  const peek = (): Token | null => tokens[index] ?? null;
  const advance = (): Token | null => {
    const token = peek();
    index += 1;
    return token;
  };
  const isSymbol = (text: string): boolean => {
    const token = peek();
    return token?.kind === 'symbol' && token.text === text;
  };
  const isWord = (name: string): boolean => {
    const token = peek();
    return token?.kind === 'word' && token.text.toUpperCase() === name;
  };
  const unexpected = (token: Token): Refusal => new Refusal(atColumn(token.column, `unexpected ${token.text}.`));

  const parseBinaryLevel = (
    operators: readonly BinaryOperator[], parseOperand: () => Expression,
  ): Expression => {
    let left = parseOperand();
    for (;;) {
      const token = peek();
      const operator = operators.find((candidate) => token?.kind === 'symbol' && token.text === candidate);
      if (operator === undefined) return left;
      advance();
      left = { kind: 'binary', operator, left, right: parseOperand() };
    }
  };

  const parseOr = (): Expression => {
    let left = parseAnd();
    while (isWord('OR')) {
      advance();
      left = { kind: 'binary', operator: 'OR', left, right: parseAnd() };
    }
    return left;
  };

  const parseAnd = (): Expression => {
    let left = parseNot();
    while (isWord('AND')) {
      advance();
      left = { kind: 'binary', operator: 'AND', left, right: parseNot() };
    }
    return left;
  };

  const parseNot = (): Expression => {
    if (!isWord('NOT')) return parseComparison();
    advance();
    return { kind: 'not', operand: parseNot() };
  };

  const parseComparison = (): Expression => {
    const left = parseJoin();
    const token = peek();
    if (token?.kind !== 'symbol' || !isComparison(token.text)) return left;
    advance();
    return { kind: 'binary', operator: token.text, left, right: parseJoin() };
  };

  const parseJoin = (): Expression => parseBinaryLevel(['&'], parseSum);
  const parseSum = (): Expression => parseBinaryLevel(['+', '-'], parseProduct);
  const parseProduct = (): Expression => parseBinaryLevel(['*', '/', '%'], parseUnary);

  const parseUnary = (): Expression => {
    if (!isSymbol('-')) return parsePower();
    advance();
    return { kind: 'negate', operand: parseUnary() };
  };

  const parsePower = (): Expression => {
    const base = parsePrimary();
    if (!isSymbol('^')) return base;
    advance();
    return { kind: 'binary', operator: '^', left: base, right: parseUnary() };
  };

  const expectClosingBracket = (): void => {
    const token = advance();
    if (token === null) throw new Refusal(atColumn(endColumn, 'a closing bracket is missing.'));
    if (token.kind !== 'symbol' || token.text !== ')') throw unexpected(token);
  };

  const parseCall = (word: Token): Expression => {
    const name = word.text.toUpperCase();
    if (!isFunctionName(name)) {
      throw new Refusal(atColumn(word.column, `there is no function called ${word.text}.`));
    }
    advance();
    const args: Expression[] = [];
    if (!isSymbol(')')) {
      args.push(parseOr());
      while (isSymbol(',')) {
        advance();
        args.push(parseOr());
      }
    }
    expectClosingBracket();
    const arity = FUNCTIONS[name];
    const accepted = 'exactly' in arity ? args.length === arity.exactly : args.length >= arity.atLeast;
    if (!accepted) throw new Refusal(atColumn(word.column, arityRefusal(name, arity)));
    return { kind: 'call', name, args };
  };

  const parsePrimary = (): Expression => {
    const token = advance();
    if (token === null) throw new Refusal(atColumn(endColumn, 'the formula ends too early.'));
    switch (token.kind) {
      case 'number':
        return { kind: 'number', value: exactDecimal(token.text) };
      case 'text':
        return { kind: 'text', value: token.value };
      case 'reference':
        return { kind: 'reference', key: token.key, row: token.row, text: token.text, column: token.column };
      case 'word': {
        const upper = token.text.toUpperCase();
        if (upper === 'TRUE' || upper === 'FALSE') return { kind: 'boolean', value: upper === 'TRUE' };
        if (isSymbol('(')) return parseCall(token);
        throw unexpected(token);
      }
      case 'symbol': {
        if (token.text !== '(') throw unexpected(token);
        const inner = parseOr();
        expectClosingBracket();
        return inner;
      }
    }
  };

  const expression = parseOr();
  const rest = peek();
  if (rest !== null) throw unexpected(rest);
  return expression;
}

/**
 * Reads a formula in the published order: characters first, then the length and bracket caps, then the
 * grammar. The refusal is the exact published sentence.
 */
export function parseFormula(text: string, limits: FormulaLimits): ParsedFormula {
  try {
    const lexed = lex(text);
    if (lexed.tokens.length === 0) throw new Refusal(atColumn(1, 'the formula is empty.'));
    if (lexed.endColumn - 1 > limits.maxChars) {
      throw new Refusal(`The formula is longer than ${limits.maxChars} characters.`);
    }
    if (bracketDepth(lexed.tokens) > limits.maxDepth) {
      throw new Refusal(`The formula has more than ${limits.maxDepth} levels of brackets.`);
    }
    return { ok: true, expression: parseTokens(lexed) };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, refusal: error.message };
    throw error;
  }
}
