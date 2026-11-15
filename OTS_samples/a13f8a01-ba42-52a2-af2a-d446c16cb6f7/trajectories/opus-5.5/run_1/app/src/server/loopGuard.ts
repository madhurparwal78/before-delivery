import { parse, type Node } from "acorn";

interface Insertion {
  position: number;
  text: string;
  closing: boolean;
  depth: number;
}

interface LoopNode extends Node {
  body: Node;
  loc: { start: { line: number; column: number }; end: { line: number; column: number } };
}

const loopTypes = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);

function children(node: Node): Node[] {
  const found: Node[] = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item === "object" && typeof (item as Node).type === "string") found.push(item as Node);
    } else if (value && typeof value === "object" && typeof (value as Node).type === "string") {
      found.push(value as Node);
    }
  }
  return found;
}

/**
 * Counts every for, while and do…while loop separately each time it starts; on the iteration after
 * the limit it reports the loop's first line and leaves the loop. Insertions never add line breaks,
 * so line numbers in the JS pane stay true.
 */
export function guardLoops(source: string, limit: number, reporter: string): string {
  let program: Node;
  try {
    program = parse(source, { ecmaVersion: "latest", sourceType: "script", locations: true, allowHashBang: true, allowAwaitOutsideFunction: true });
  } catch {
    return source;
  }
  const insertions: Insertion[] = [];
  let counter = 0;
  const visit = (node: Node, depth: number, wrapperStart: number | null): void => {
    if (loopTypes.has(node.type)) {
      const loop = node as LoopNode;
      counter += 1;
      const name = `__ashlarLoop${counter}`;
      const start = wrapperStart ?? loop.start;
      insertions.push({ position: start, text: `{let ${name}=0;`, closing: false, depth });
      insertions.push({ position: loop.end, text: "}", closing: true, depth });
      const check = `if(++${name}>${limit}){${reporter}(${loop.loc.start.line});break;}`;
      if (loop.body.type === "BlockStatement") {
        insertions.push({ position: loop.body.start + 1, text: check, closing: false, depth: depth + 1 });
      } else {
        insertions.push({ position: loop.body.start, text: `{${check}`, closing: false, depth: depth + 1 });
        insertions.push({ position: loop.body.end, text: "}", closing: true, depth: depth + 1 });
      }
      for (const child of children(loop)) visit(child, depth + 2, null);
      return;
    }
    if (node.type === "LabeledStatement") {
      const body = (node as Node & { body: Node }).body;
      visit(body, depth, wrapperStart ?? node.start);
      return;
    }
    for (const child of children(node)) visit(child, depth + 1, null);
  };
  visit(program, 0, null);
  insertions.sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    if (a.closing !== b.closing) return a.closing ? -1 : 1;
    return a.closing ? b.depth - a.depth : a.depth - b.depth;
  });
  let output = "";
  let cursor = 0;
  for (const insertion of insertions) {
    output += source.slice(cursor, insertion.position) + insertion.text;
    cursor = insertion.position;
  }
  return output + source.slice(cursor);
}
