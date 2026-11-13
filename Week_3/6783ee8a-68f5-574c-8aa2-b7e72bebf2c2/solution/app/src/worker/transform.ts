import { parse } from "acorn";
import type { Node } from "acorn";

/** Rewrites one cell so that top-level declarations persist across cells, the last expression becomes the
 *  result and every loop checks for an interrupt. Edits only insert or replace text on a single line, so
 *  line numbers in errors stay the cell's own. */

export class CellSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = "SyntaxError";
  }
}

interface Edit {
  at: number;
  remove: number;
  insert: string;
}

type Ast = Node & Record<string, unknown>;

const LOOPS = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);

function children(node: Ast): Ast[] {
  const found: Ast[] = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) found.push(...value.filter((v): v is Ast => typeof v === "object" && v !== null && "type" in v));
    else if (typeof value === "object" && value !== null && "type" in value) found.push(value as Ast);
  }
  return found;
}

function guardLoops(node: Ast, edits: Edit[]): void {
  if (LOOPS.has(node.type)) {
    const body = node.body as unknown as Ast;
    if (body.type === "BlockStatement") edits.push({ at: body.start + 1, remove: 0, insert: "__guard();" });
    else edits.push({ at: body.start, remove: 0, insert: "{__guard();" }, { at: body.end, remove: 0, insert: "}" });
  }
  for (const child of children(node)) guardLoops(child, edits);
}

function persistDeclaration(source: string, node: Ast, edits: Edit[]): void {
  if (node.type === "VariableDeclaration") {
    const kind = node.kind as string;
    edits.push({ at: node.start, remove: kind.length, insert: "(" });
    for (const declarator of node.declarations as Ast[]) {
      if (!declarator.init) edits.push({ at: (declarator.id as Ast).end, remove: 0, insert: " = undefined" });
    }
    edits.push({ at: source[node.end - 1] === ";" ? node.end - 1 : node.end, remove: 0, insert: ")" });
  } else if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
    const name = (node.id as Ast & { name: string }).name;
    edits.push({ at: node.start, remove: 0, insert: `${name} = ` }, { at: node.end, remove: 0, insert: ";" });
  }
}

export function transformCell(source: string): string {
  let program: Ast;
  try {
    program = parse(source, { ecmaVersion: "latest", sourceType: "script", allowAwaitOutsideFunction: true, locations: true }) as unknown as Ast;
  } catch (error) {
    const fault = error as { message: string; loc?: { line: number } };
    throw new CellSyntaxError(fault.message.replace(/\s*\(\d+:\d+\)$/, ""), fault.loc?.line ?? 1);
  }
  const edits: Edit[] = [];
  guardLoops(program, edits);
  const body = program.body as Ast[];
  for (const statement of body) persistDeclaration(source, statement, edits);
  const last = body[body.length - 1];
  if (last && last.type === "ExpressionStatement") {
    const expression = last.expression as unknown as Ast;
    edits.push({ at: expression.start, remove: 0, insert: "return (" }, { at: expression.end, remove: 0, insert: ")" });
  }
  // Apply from the end so earlier offsets stay valid; at one offset, later-added edits go first.
  const order = edits.map((edit, index) => ({ edit, index })).sort((a, b) => b.edit.at - a.edit.at || b.index - a.index);
  let out = source;
  for (const { edit } of order) out = out.slice(0, edit.at) + edit.insert + out.slice(edit.at + edit.remove);
  return out;
}
