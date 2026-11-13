export type ParameterKind = 'length' | 'angle' | 'count' | 'boolean' | 'enum';

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'ref'; name: string }
  | { k: 'bin'; op: '+' | '-' | '*' | '/'; a: Expr; b: Expr }
  | { k: 'neg'; a: Expr }
  | { k: 'pick'; enumName: string; options: { option: string; value: number }[] };

/** An argument keeps its source text so diagnostics can name its first parameter. */
export type Argument = { expr: Expr; text: string; role: ArgumentRole };

export type ArgumentRole = 'Width' | 'Depth' | 'Height' | 'Diameter' | 'Length';

export type ParamStatement = {
  k: 'param';
  line: number;
  name: string;
  kind: ParameterKind;
  defaultNumber?: number;
  defaultBoolean?: boolean;
  defaultOption?: string;
  options?: string[];
  min?: number;
  max?: number;
  stepText?: string;
  group: string;
};

export type LetStatement = {
  k: 'let';
  line: number;
  name: string;
  expr: Expr;
  group: string;
};

export type BodyStatement = {
  k: 'body';
  line: number;
  verb: 'box' | 'cylinder';
  args: Argument[];
};

export type CutStatement = {
  k: 'cut';
  line: number;
  verb: 'hole' | 'slot' | 'boss';
  args: Argument[];
  at: [Argument, Argument];
  condition: string | null;
};

export type RepeatStatement = {
  k: 'repeat';
  line: number;
  count: Argument;
  pitch: Argument;
  body: (CutStatement | BodyStatement)[];
};

export type Statement = ParamStatement | LetStatement | BodyStatement | CutStatement | RepeatStatement;

export type TineProgram = {
  statements: Statement[];
  parameters: (ParamStatement | LetStatement)[];
  source: string;
};

export class TineSourceError extends Error {
  constructor(
    readonly line: number,
    readonly reason: string,
  ) {
    super(`Line ${line}: ${reason}`);
  }
}
