import { parse } from 'acorn';
import type {
  AnyNode,
  Expression,
  FunctionDeclaration,
  Node,
  Pattern,
  Program,
  VariableDeclaration,
} from 'acorn';
import { ancestor } from 'acorn-walk';
import { formatConsoleArgument, formatValue } from '../shared/valueformat.js';
import { DISPLAY_MIMES, TABLE_MIME } from '../shared/outputs.js';
import type { NotebookOutput } from '../shared/types.js';

export interface RunRequest {
  type: 'run';
  run_id: string;
  source: string;
  exec_limit_ms: number;
}

export interface InterruptRequest {
  type: 'interrupt';
}

export type KernelRequest = RunRequest | InterruptRequest;

export interface RunDone {
  type: 'done';
  run_id: string;
  status: 'finished' | 'failed' | 'interrupted';
  outputs: NotebookOutput[];
}

const AsyncFunction = Object.getPrototypeOf(async function placeholder() {
  /* the constructor of async functions */
}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;

type InterruptKind = 'interrupt' | 'limit';

class Interrupted extends Error {
  readonly kind: InterruptKind;

  constructor(kind: InterruptKind) {
    super(kind === 'limit' ? 'limit' : 'interrupt');
    this.kind = kind;
  }
}

const scope: Record<string, unknown> = {};

let interruptRequested: InterruptKind | null = null;
let failRun: ((error: Error) => void) | null = null;

function patternNames(pattern: Pattern, found: string[]): void {
  switch (pattern.type) {
    case 'Identifier':
      found.push(pattern.name);
      return;
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        if (property.type === 'RestElement') patternNames(property.argument, found);
        else patternNames(property.value, found);
      }
      return;
    case 'ArrayPattern':
      for (const element of pattern.elements) if (element) patternNames(element, found);
      return;
    case 'AssignmentPattern':
      patternNames(pattern.left, found);
      return;
    case 'RestElement':
      patternNames(pattern.argument, found);
      return;
    default:
      return;
  }
}

function declaredNames(program: Program): string[] {
  const names: string[] = [];
  for (const statement of program.body) {
    if (statement.type === 'VariableDeclaration') {
      for (const declarator of (statement as VariableDeclaration).declarations) {
        patternNames(declarator.id, names);
      }
    } else if (statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration') {
      const declaration = statement as FunctionDeclaration;
      if (declaration.id) names.push(declaration.id.name);
    }
  }
  return names;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

function inAsyncContext(ancestors: readonly Node[]): boolean {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const node = ancestors[index] as AnyNode;
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      return node.async === true;
    }
  }
  return true;
}

/**
 * Adds an interrupt and time-limit check to the start of every loop body, so a
 * runaway loop can be stopped without losing the kernel's variables.
 */
function loopEdits(program: Program): Edit[] {
  const edits: Edit[] = [];
  const visitLoop = (node: { body: Node }, _state: unknown, ancestors: readonly Node[]): void => {
    const body = node.body;
    const check = inAsyncContext(ancestors.slice(0, -1)) ? 'await __tick();' : '__tickSync();';
    if (body.type === 'BlockStatement') {
      edits.push({ start: body.start + 1, end: body.start + 1, text: check });
    } else {
      edits.push({ start: body.start, end: body.start, text: `{${check}` });
      edits.push({ start: body.end, end: body.end, text: '}' });
    }
  };
  ancestor(program, {
    WhileStatement: visitLoop,
    DoWhileStatement: visitLoop,
    ForStatement: visitLoop,
    ForInStatement: visitLoop,
    ForOfStatement: visitLoop,
  });
  return edits;
}

interface Prepared {
  body: string;
  names: string[];
}

function prepare(source: string): Prepared {
  const program = parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: false,
  });
  const declared = declaredNames(program);
  const edits = loopEdits(program);

  const last = program.body[program.body.length - 1];
  if (last && last.type === 'ExpressionStatement') {
    const expression = last.expression as Expression;
    edits.push({
      start: last.start,
      end: last.end,
      text: `__bp_result = (${source.slice(expression.start, expression.end)});`,
    });
  }

  let transformed = source;
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    transformed = transformed.slice(0, edit.start) + edit.text + transformed.slice(edit.end);
  }

  const carried = Object.keys(scope).filter((name) => !declared.includes(name));
  const prologue = `let __bp_result;${carried.length > 0 ? ` let {${carried.join(', ')}} = __scope;` : ''} `;
  const synced = [...new Set([...carried, ...declared])];
  const epilogue = `\n__bp_sync({${synced.map((name) => `${JSON.stringify(name)}: ${name}`).join(', ')}});\nreturn __bp_result;`;
  return { body: `${prologue}${transformed}${epilogue}`, names: synced };
}

/**
 * The line a stack reports inside the compiled cell. Frames of the kernel's own
 * code are skipped, so only the cell's own frames count.
 */
function stackLine(error: unknown): number | null {
  const stack = error instanceof Error && typeof error.stack === 'string' ? error.stack : '';
  for (const frame of stack.split('\n')) {
    const match = /(?:<anonymous>|Function|eval code):(\d+):\d+/.exec(frame);
    if (match) return Number(match[1]);
  }
  return null;
}

/** The body line this engine reports for the first line of a compiled body. */
let baseLine = 1;
void (async () => {
  try {
    await new AsyncFunction('throw new Error("probe")')();
  } catch (error) {
    const line = stackLine(error);
    if (line !== null) baseLine = line;
  }
})();

function errorLine(error: unknown): number {
  const line = stackLine(error);
  if (line === null) return 1;
  const within = line - baseLine + 1;
  return within >= 1 ? within : 1;
}

function limitSeconds(execLimitMs: number): string {
  return String(execLimitMs / 1000);
}

class OutputCollector {
  readonly outputs: NotebookOutput[] = [];

  stream(name: 'stdout' | 'stderr', text: string): void {
    const last = this.outputs[this.outputs.length - 1];
    if (last && last.output_type === 'stream' && last.name === name) {
      last.text = `${String(last.text)}${text}`;
      return;
    }
    this.outputs.push({ output_type: 'stream', name, text });
  }

  display(value: unknown, mimeType: string): void {
    if (!(DISPLAY_MIMES as readonly string[]).includes(mimeType)) {
      throw new TypeError(`display(): unsupported type ${mimeType}`);
    }
    const payload: unknown = mimeType === 'text/plain' ? formatValue(value) : mimeType === TABLE_MIME ? value : String(value);
    this.outputs.push({ output_type: 'display_data', data: { [mimeType]: payload }, metadata: {} });
  }

  result(value: unknown): void {
    this.outputs.push({
      output_type: 'execute_result',
      execution_count: null,
      data: { 'text/plain': formatValue(value) },
      metadata: {},
    });
  }

  error(ename: string, evalue: string, line: number): void {
    this.outputs.push({
      output_type: 'error',
      ename,
      evalue,
      traceback: [`${ename}: ${evalue}`, `line ${line}`],
    });
  }
}

async function runCell(request: RunRequest): Promise<void> {
  const collector = new OutputCollector();
  interruptRequested = null;
  const deadline = Date.now() + request.exec_limit_ms;

  const consoleShim = {
    log: (...values: unknown[]): void => {
      collector.stream('stdout', `${values.map(formatConsoleArgument).join(' ')}\n`);
    },
    error: (...values: unknown[]): void => {
      collector.stream('stderr', `${values.map(formatConsoleArgument).join(' ')}\n`);
    },
  };

  const tickSync = (): void => {
    if (interruptRequested !== null) throw new Interrupted(interruptRequested);
    if (Date.now() >= deadline) throw new Interrupted('limit');
  };

  let lastYield = Date.now();
  const tick = async (): Promise<void> => {
    tickSync();
    if (Date.now() - lastYield < 20) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
    lastYield = Date.now();
    tickSync();
  };

  const sync = (values: Record<string, unknown>): void => {
    Object.assign(scope, values);
  };

  let status: RunDone['status'] = 'finished';
  try {
    const prepared = prepare(request.source);
    const compiled = new AsyncFunction(
      '__scope',
      '__bp_sync',
      '__tick',
      '__tickSync',
      'console',
      'display',
      prepared.body,
    );
    const interruptSignal = new Promise<never>((_resolve, reject) => {
      failRun = reject;
    });
    const timer = setTimeout(() => {
      interruptRequested = 'limit';
      failRun?.(new Interrupted('limit'));
    }, request.exec_limit_ms);
    const running = compiled(
      scope,
      sync,
      tick,
      tickSync,
      consoleShim,
      (value: unknown, mimeType = 'text/plain') => collector.display(value, mimeType),
    );
    running.catch(() => undefined);
    try {
      const value = await Promise.race([running, interruptSignal]);
      if (value !== undefined) collector.result(value);
    } finally {
      clearTimeout(timer);
      failRun = null;
    }
  } catch (error) {
    if (error instanceof Interrupted) {
      status = 'interrupted';
      collector.error(
        'Interrupted',
        error.kind === 'limit'
          ? `Execution time limit reached (${limitSeconds(request.exec_limit_ms)} s)`
          : 'Run interrupted',
        errorLine(error),
      );
    } else if (error instanceof SyntaxError && 'loc' in error) {
      status = 'failed';
      const location = (error as SyntaxError & { loc: { line: number } }).loc;
      collector.error('SyntaxError', error.message.replace(/\s*\(\d+:\d+\)$/, ''), location.line);
    } else {
      status = 'failed';
      const failure = error as Error;
      collector.error(failure.name ?? 'Error', failure.message ?? String(error), errorLine(error));
    }
  }

  const done: RunDone = {
    type: 'done',
    run_id: request.run_id,
    status,
    outputs: collector.outputs,
  };
  self.postMessage(done);
}

self.onmessage = (event: MessageEvent<KernelRequest>): void => {
  const request = event.data;
  if (request.type === 'interrupt') {
    interruptRequested = 'interrupt';
    failRun?.(new Interrupted('interrupt'));
    return;
  }
  void runCell(request);
};
