import { parse } from 'acorn';

interface Node {
  type: string;
  start: number;
  end: number;
  loc?: { start: { line: number } };
  [key: string]: unknown;
}

const LOOPS = new Set([
  'ForStatement',
  'WhileStatement',
  'DoWhileStatement',
  'ForInStatement',
  'ForOfStatement',
]);

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && typeof (value as Node).type === 'string';

type Side = 'close' | 'open';
type Part = 'body' | 'wrapper';

interface Insertion {
  at: number;
  text: string;
  side: Side;
  part: Part;
  depth: number;
}

/**
 * At one position closers run before openers, deeper loops close first and enclosing bodies open
 * first, so nested loops keep their brace nesting.
 */
const compare = (a: Insertion, b: Insertion): number => {
  if (a.at !== b.at) return a.at - b.at;
  if (a.side !== b.side) return a.side === 'close' ? -1 : 1;
  if (a.depth !== b.depth) return a.side === 'close' ? b.depth - a.depth : a.depth - b.depth;
  if (a.part !== b.part) return a.part === 'body' ? -1 : 1;
  return 0;
};

/**
 * Counts every for, while and do…while loop separately for each time it runs, so a loop that
 * passes the iteration limit breaks out and the script carries on after it. Every inserted
 * fragment is free of newlines, so line numbers in the JS pane are unchanged.
 */
export const guardLoops = (js: string): string => {
  let program: Node;
  try {
    program = parse(js, {
      ecmaVersion: 'latest',
      locations: true,
      sourceType: 'script',
    }) as unknown as Node;
  } catch {
    return js;
  }

  const insertions: Insertion[] = [];
  let loopCount = 0;

  const walk = (node: Node, parent: Node | null, depth: number): void => {
    let nextDepth = depth;
    if (LOOPS.has(node.type)) {
      nextDepth = depth + 1;
      const id = (loopCount += 1);
      const line = node.loc?.start.line ?? 1;
      const labelled = parent?.type === 'LabeledStatement' && parent.body === node;
      const target = labelled ? (parent as Node) : node;
      insertions.push({
        at: target.start,
        text: `{__ashlarEnterLoop(${id});`,
        side: 'open',
        part: 'wrapper',
        depth: nextDepth,
      });
      insertions.push({ at: target.end, text: '}', side: 'close', part: 'wrapper', depth: nextDepth });

      const body = node.body as Node;
      const tick = `if(!__ashlarTickLoop(${id},${line}))break;`;
      if (body.type === 'BlockStatement') {
        insertions.push({
          at: body.start + 1,
          text: tick,
          side: 'open',
          part: 'body',
          depth: nextDepth,
        });
      } else {
        insertions.push({
          at: body.start,
          text: `{${tick}`,
          side: 'open',
          part: 'body',
          depth: nextDepth,
        });
        insertions.push({ at: body.end, text: '}', side: 'close', part: 'body', depth: nextDepth });
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) walk(item, node, nextDepth);
      } else if (isNode(value)) {
        walk(value, node, nextDepth);
      }
    }
  };

  walk(program, null, 0);
  if (insertions.length === 0) return js;

  insertions.sort(compare);
  let result = '';
  let cursor = 0;
  for (const insertion of insertions) {
    result += js.slice(cursor, insertion.at) + insertion.text;
    cursor = insertion.at;
  }
  return result + js.slice(cursor);
};
