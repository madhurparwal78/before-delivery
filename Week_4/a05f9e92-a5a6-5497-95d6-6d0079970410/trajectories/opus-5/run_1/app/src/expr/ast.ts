/** The parsed tree of an expression. It is interpreted, never made executable. */

export type Node =
  | { readonly kind: 'number'; readonly value: number; readonly col: number }
  | { readonly kind: 'string'; readonly value: string; readonly col: number }
  | { readonly kind: 'boolean'; readonly value: boolean; readonly col: number }
  | { readonly kind: 'null'; readonly col: number }
  | { readonly kind: 'list'; readonly items: readonly Node[]; readonly col: number }
  | { readonly kind: 'path'; readonly path: readonly string[]; readonly col: number }
  | { readonly kind: 'call'; readonly name: FunctionName; readonly args: readonly Node[]; readonly col: number }
  | { readonly kind: 'not'; readonly operand: Node; readonly col: number }
  | { readonly kind: 'negate'; readonly operand: Node; readonly col: number }
  | {
      readonly kind: 'binary';
      readonly op: BinaryOperator;
      readonly left: Node;
      readonly right: Node;
      readonly col: number;
    };

export type BinaryOperator =
  | 'or'
  | 'and'
  | '='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'in'
  | 'contains'
  | 'startswith'
  | '+'
  | '-'
  | '*'
  | '/';

export const comparisonOperators = ['=', '!=', '<', '<=', '>', '>=', 'in', 'contains', 'startswith'] as const;

export const functionNames = [
  'changes',
  'changes_to',
  'changes_from',
  'is_empty',
  'len',
  'lower',
  'upper',
  'now',
  'me',
  'has_role',
  'business_days_since',
] as const;

export type FunctionName = (typeof functionNames)[number];

export const functionArity: Readonly<Record<FunctionName, number>> = {
  changes: 1,
  changes_to: 2,
  changes_from: 2,
  is_empty: 1,
  len: 1,
  lower: 1,
  upper: 1,
  now: 0,
  me: 0,
  has_role: 1,
  business_days_since: 1,
};

export function isFunctionName(name: string): name is FunctionName {
  return (functionNames as readonly string[]).includes(name);
}

/** A field or function that the grammar accepted but the context does not know. */
export interface SemanticIssue {
  readonly col: number;
  readonly reason: string;
}

export interface ParsedExpression {
  readonly text: string;
  readonly node: Node;
  /** Unknown functions found while parsing, leftmost first. */
  readonly issues: readonly SemanticIssue[];
}

/** Every path the tree reads, for field validation. */
export function pathsOf(node: Node, out: { path: readonly string[]; col: number }[] = []): {
  path: readonly string[];
  col: number;
}[] {
  switch (node.kind) {
    case 'path':
      out.push({ path: node.path, col: node.col });
      break;
    case 'list':
      for (const item of node.items) pathsOf(item, out);
      break;
    case 'call':
      for (const arg of node.args) pathsOf(arg, out);
      break;
    case 'not':
    case 'negate':
      pathsOf(node.operand, out);
      break;
    case 'binary':
      pathsOf(node.left, out);
      pathsOf(node.right, out);
      break;
    default:
      break;
  }
  return out;
}
