import { parse, type Node, type SourceLocation } from "acorn";

const LOOPS = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);

interface Loop extends Node {
  loc: SourceLocation;
  body: Node;
}

interface Edit {
  at: number;
  text: string;
}

function children(node: Node): Node[] {
  const found: Node[] = [];
  for (const value of Object.values(node)) {
    const items: unknown[] = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (item !== null && typeof item === "object" && typeof (item as Node).type === "string") found.push(item as Node);
    }
  }
  return found;
}

export function guardLoops(source: string, limit: number): string {
  let program: Node;
  try {
    program = parse(source, { ecmaVersion: "latest", sourceType: "script", locations: true, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
  } catch {
    return source;
  }
  const edits: Edit[] = [];
  let counter = 0;

  const visit = (node: Node, wrapper: Node | null): void => {
    const labelled = node.type === "LabeledStatement";
    if (LOOPS.has(node.type)) {
      const loop = node as Loop;
      const name = `__ashlar${++counter}`;
      const outer = wrapper ?? node;
      const check = `if(++${name}>${limit}){__ashlarLoop(${loop.loc.start.line});break;}`;
      edits.push({ at: outer.start, text: `{let ${name}=0;` });
      const body = loop.body;
      if (body.type === "BlockStatement") {
        edits.push({ at: body.start + 1, text: check });
      } else {
        edits.push({ at: body.start, text: `{${check}` }, { at: body.end, text: "}" });
      }
      edits.push({ at: outer.end, text: "}" });
    }
    for (const child of children(node)) visit(child, labelled ? (wrapper ?? node) : null);
  };
  visit(program, null);

  const ordered = edits.map((edit, index) => ({ ...edit, index })).sort((a, b) => a.at - b.at || a.index - b.index);
  let guarded = "";
  let cursor = 0;
  for (const edit of ordered) {
    guarded += source.slice(cursor, edit.at) + edit.text;
    cursor = edit.at;
  }
  return guarded + source.slice(cursor);
}
