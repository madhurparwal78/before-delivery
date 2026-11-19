// The parsed shape of a formula. `pos` is the node's own token (an operator's symbol, a function's name, a
// level-of-detail expression's opening brace); `start` is where the node's text begins.
import type { Pos } from './lexer.ts';

export type BinaryOp = 'OR' | 'AND' | '=' | '<>' | '<' | '<=' | '>' | '>=' | '+' | '-' | '&' | '*' | '/' | '%';
export type LodForm = 'AT' | 'PLUS' | 'MINUS' | 'ALL';

interface At {
  pos: Pos;
  start: Pos;
}

export interface FieldNode extends At {
  type: 'field';
  name: string;
}

export type Node =
  | (At & { type: 'number'; value: number })
  | (At & { type: 'string'; value: string })
  | (At & { type: 'boolean'; value: boolean })
  | (At & { type: 'null' })
  | FieldNode
  | (At & { type: 'param'; name: string })
  | (At & { type: 'unary'; op: '-' | 'NOT'; arg: Node })
  | (At & { type: 'binary'; op: BinaryOp; left: Node; right: Node })
  | (At & { type: 'call'; name: string; args: Node[] })
  | (At & { type: 'lod'; form: LodForm; dims: FieldNode[]; body: Node });

export interface FormulaError {
  message: string;
  line: number | null;
  column: number | null;
}

export const errorAt = (pos: Pos, text: string): FormulaError => ({
  message: `Line ${pos.line}, column ${pos.column}: ${text}`,
  line: pos.line,
  column: pos.column,
});
