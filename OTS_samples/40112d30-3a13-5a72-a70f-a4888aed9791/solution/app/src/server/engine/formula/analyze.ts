import { findReferenced } from '../outline.ts';
import type { Outline } from '../outline.ts';
import type { Expression, FunctionName } from './ast.ts';
import { atColumn } from './refusal.ts';

/** Which questions a formula may use: those whose position is below `limit`, and what its owner is called. */
export interface ReferenceScope {
  limit: number;
  /** The question the formula belongs to, with the refusal for naming it. */
  own: { position: number; message: string } | null;
}

/** What a position in a formula accepts: a plain value, a tick list (HAS, TICKED) or any answer (BLANK, COUNT). */
type Usage = 'value' | 'ticks' | 'anything';

const ARGUMENT_USAGE: Partial<Record<FunctionName, Usage>> = {
  BLANK: 'anything',
  COUNT: 'anything',
  HAS: 'ticks',
  TICKED: 'ticks',
};

/** The first refusal for the questions a parsed formula refers to, or null when every reference is usable. */
export function referenceProblem(expression: Expression, scope: ReferenceScope, outline: Outline): string | null {
  const check = (node: Expression, usage: Usage): string | null => {
    switch (node.kind) {
      case 'number':
      case 'text':
      case 'boolean':
        return null;
      case 'reference':
        return checkReference(node, usage);
      case 'negate':
      case 'not':
        return check(node.operand, 'value');
      case 'binary':
        return check(node.left, 'value') ?? check(node.right, 'value');
      case 'call': {
        const argumentUsage = ARGUMENT_USAGE[node.name] ?? 'value';
        for (const argument of node.args) {
          const problem = check(argument, argumentUsage);
          if (problem !== null) return problem;
        }
        return null;
      }
    }
  };

  const checkReference = (node: Extract<Expression, { kind: 'reference' }>, usage: Usage): string | null => {
    const target = findReferenced(outline, node.key, node.row);
    if (target === undefined) {
      return atColumn(node.column, `there is no question called ${node.text}.`);
    }
    if (scope.own !== null && target.position === scope.own.position) return atColumn(node.column, scope.own.message);
    if (target.position >= scope.limit) {
      return atColumn(node.column, `${node.text} comes later in the form, so it cannot be used here.`);
    }
    if (node.row !== null) return null;
    const { type } = target.question;
    if (type === 'checkbox' && usage === 'value') {
      return atColumn(node.column, `${node.text} can only be used inside HAS, TICKED, BLANK or COUNT.`);
    }
    if ((type === 'ranking' || type === 'file' || type === 'grid') && usage !== 'anything') {
      return atColumn(node.column, `${node.text} can only be used inside BLANK or COUNT.`);
    }
    return null;
  };

  return check(expression, 'value');
}

/** The keys of the questions a parsed formula refers to, in the order they are written. */
export function referencedKeys(expression: Expression): string[] {
  switch (expression.kind) {
    case 'number':
    case 'text':
    case 'boolean':
      return [];
    case 'reference':
      return [expression.key];
    case 'negate':
    case 'not':
      return referencedKeys(expression.operand);
    case 'binary':
      return [...referencedKeys(expression.left), ...referencedKeys(expression.right)];
    case 'call':
      return expression.args.flatMap(referencedKeys);
  }
}
