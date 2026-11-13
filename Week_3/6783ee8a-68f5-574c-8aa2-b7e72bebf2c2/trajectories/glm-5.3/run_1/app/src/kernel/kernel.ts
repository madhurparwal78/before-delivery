import * as acorn from "acorn";
import type { KernelOutput, RunOutcome } from "./protocol.ts";

const DISPLAY_TYPES = ["text/plain", "text/markdown", "text/html", "image/svg+xml", "application/vnd.brackenpad.table+json"];

/** The interrupt flag lives in shared memory so the main thread can set it while a busy
 *  loop keeps the worker's message queue blocked. */
const interruptBuffer: SharedArrayBuffer | null =
  typeof SharedArrayBuffer !== "undefined" ? new SharedArrayBuffer(4) : null;
const interruptView: Int32Array | null = interruptBuffer === null ? null : new Int32Array(interruptBuffer);

export function sharedInterruptBuffer(): SharedArrayBuffer | null {
  return interruptBuffer;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Result and console formatting in one place, exactly as published. */
export function formatValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return `[Function ${value.name === "" ? "anonymous" : value.name}]`;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value) || isPlainObject(value)) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  if (value === undefined) return "undefined";
  return String(value);
}

class InterruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Interrupted";
  }
}

type LoopState = { flag: boolean; deadline: number; limitMessage: string };

function makeCheck(state: LoopState): () => void {
  return () => {
    if (interruptView !== null && Atomics.load(interruptView, 0) === 1) {
      throw new InterruptError("Run interrupted");
    }
    if (state.flag) throw new InterruptError("Run interrupted");
    if (Date.now() >= state.deadline) throw new InterruptError(state.limitMessage);
  };
}

/** Clears the shared interrupt flag before a run starts. */
export function clearSharedInterrupt(): void {
  if (interruptView !== null) Atomics.store(interruptView, 0, 0);
}

/** Sets the shared interrupt flag from any thread. */
export function raiseSharedInterrupt(): void {
  if (interruptView !== null) Atomics.store(interruptView, 0, 1);
}

/** Puts an interrupt check at the head of every loop body. The rewrite keeps line count. */
export function guardLoops(code: string, check: string): string {
  if (code === "") return "";
  let out = "";
  let i = 0;
  while (i < code.length) {
    const at = findLoopStart(code, i);
    if (at >= code.length) {
      out += code.slice(i);
      break;
    }
    if (at !== i) {
      out += code.slice(i, at);
      i = at;
      continue;
    }
    const isFor = code.startsWith("for", i);
    const isWhile = code.startsWith("while", i);
    const isDo = code.startsWith("do", i);
    if (isFor || isWhile) {
      const afterKeyword = skipWs(code, i + (isWhile ? 5 : 3));
      if (code[afterKeyword] !== "(") {
        out += code.slice(i, afterKeyword);
        i = afterKeyword;
        continue;
      }
      const parens = readParens(code, afterKeyword);
      const afterHeader = skipWs(code, parens.end + 1);
      if (code[afterHeader] === "{") {
        const body = readBraced(code, afterHeader);
        out += code.slice(i, afterHeader + 1) + check + body.inner + code[body.end];
        i = body.end + 1;
        continue;
      }
      const stmt = readSimpleStatement(code, afterHeader);
      out += code.slice(i, parens.end + 1) + `{${check}${code.slice(afterHeader, stmt.end)}}`;
      i = stmt.end;
      continue;
    }
    if (isDo) {
      const braceIndex = skipWs(code, i + 2);
      if (code[braceIndex] !== "{") {
        out += code.slice(i, braceIndex);
        i = braceIndex;
        continue;
      }
      const body = readBraced(code, braceIndex);
      const after = skipWs(code, body.end + 1);
      const whileMatch = code.slice(after).match(/^while\s*\(/);
      if (whileMatch === null) {
        out += code.slice(i, after);
        i = after;
        continue;
      }
      const cond = readParens(code, after + whileMatch[0].length - 1);
      out += `do{${check}${body.inner}}while(${code.slice(after + whileMatch[0].length, cond.end)});`;
      i = cond.end + 2;
      continue;
    }
    out += code[i];
    i += 1;
  }
  return out;
}

function findLoopStart(code: string, from: number): number {
  const rest = code.slice(from);
  const match = /\b(?:for|while)\s*\(|\bdo\s*\{/.exec(rest);
  return match === null ? code.length : from + match.index;
}

function skipWs(code: string, from: number): number {
  let i = from;
  while (i < code.length && /\s/.test(code[i])) i += 1;
  return i;
}

function readParens(code: string, openIndex: number): { end: number } {
  let depth = 0;
  let mode: string | null = null;
  for (let i = openIndex; i < code.length; i++) {
    const ch = code[i];
    if (mode !== null) {
      if (ch === "\\") i += 1;
      else if (ch === mode) mode = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      mode = ch;
      continue;
    }
    if (ch === "/" && code[i + 1] === "/") {
      while (i < code.length && code[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      const close = code.indexOf("*/", i + 2);
      i = close === -1 ? code.length : close + 1;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) return { end: i };
    }
  }
  return { end: code.length };
}

function readBraced(code: string, openIndex: number): { inner: string; end: number } {
  let depth = 0;
  let mode: string | null = null;
  for (let i = openIndex; i < code.length; i++) {
    const ch = code[i];
    if (mode !== null) {
      if (ch === "\\") i += 1;
      else if (ch === mode) mode = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      mode = ch;
      continue;
    }
    if (ch === "/" && code[i + 1] === "/") {
      while (i < code.length && code[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      const close = code.indexOf("*/", i + 2);
      i = close === -1 ? code.length : close + 1;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { inner: code.slice(openIndex + 1, i), end: i };
    }
  }
  return { inner: code.slice(openIndex + 1), end: code.length };
}

function readSimpleStatement(code: string, from: number): { end: number } {
  let depth = 0;
  let mode: string | null = null;
  for (let i = from; i < code.length; i++) {
    const ch = code[i];
    if (mode !== null) {
      if (ch === "\\") i += 1;
      else if (ch === mode) mode = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      mode = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return { end: i };
      depth -= 1;
    }
    if (ch === ";" && depth === 0) return { end: i + 1 };
    if (ch === "\n" && depth === 0) return { end: i };
  }
  return { end: code.length };
}

type ParsedCell = { head: string; tail: string | null; declared: string[] };

/** Parses a cell: the result expression tail and the names of top-level declarations. */
function parseCell(code: string): ParsedCell {
  let head = code;
  let tail: string | null = null;
  const declared: string[] = [];
  try {
    const parsed = acorn.parse(code, { ecmaVersion: "latest", allowAwaitOutsideFunction: true, locations: true });
    const body = parsed.body;
    if (body.length > 0) {
      const last = body[body.length - 1];
      if (last.type === "ExpressionStatement") {
        tail = code.slice(last.start, last.end);
        head = code.slice(0, last.start);
      }
    }
    for (const stmt of body) {
      if (stmt.type === "VariableDeclaration") {
        for (const decl of stmt.declarations) {
          collectNames(decl.id, declared);
        }
      } else if (stmt.type === "FunctionDeclaration" && stmt.id !== null) {
        declared.push(stmt.id.name);
      } else if (stmt.type === "ClassDeclaration" && stmt.id !== null) {
        declared.push(stmt.id.name);
      }
    }
  } catch {
    // Syntax errors become run failures.
  }
  return { head, tail, declared };
}

/** Rewrites top-level let/const declarations to var, so replaying earlier values and
 *  re-declaring a name in a later cell are both legal. Positions stay stable. */
export function loosenDeclarations(source: string): string {
  try {
    const parsed = acorn.parse(source, { ecmaVersion: "latest", allowAwaitOutsideFunction: true, locations: true });
    const replacements: { start: number; end: number }[] = [];
    for (const stmt of parsed.body) {
      if (stmt.type === "VariableDeclaration" && stmt.kind !== "var") {
        replacements.push({ start: stmt.start, end: stmt.start + stmt.kind.length });
      }
    }
    let out = source;
    for (let i = replacements.length - 1; i >= 0; i--) {
      const r = replacements[i];
      out = out.slice(0, r.start) + "var" + " ".repeat(Math.max(0, r.end - r.start - 3)) + out.slice(r.end);
    }
    return out;
  } catch {
    return source;
  }
}

function collectNames(pattern: acorn.Node, into: string[]): void {
  const node = pattern as { type: string; name?: string; properties?: unknown[]; elements?: unknown[]; left?: unknown };
  if (node.type === "Identifier" && node.name !== undefined) {
    into.push(node.name);
  } else if (node.type === "ObjectPattern" && node.properties !== undefined) {
    for (const prop of node.properties) {
      const p = prop as { type: string; value?: { name?: string }; argument?: { name?: string } };
      if (p.type === "Property" && p.value?.name !== undefined) into.push(p.value.name);
      else if (p.type === "RestElement" && p.argument?.name !== undefined) into.push(p.argument.name);
    }
  } else if (node.type === "ArrayPattern" && node.elements !== undefined) {
    for (const element of node.elements) {
      const el = element as { name?: string } | null;
      if (el !== null && el.name !== undefined) into.push(el.name);
    }
  } else if (node.type === "AssignmentPattern") {
    const left = node.left as { name?: string };
    if (left.name !== undefined) into.push(left.name);
  }
}

/** The kernel's persistent variables. Values captured from each successful cell replay
 *  as var statements, so a later declaration of the same name overwrites it. */
const bindings = new Map<string, unknown>();

export function restartKernel(): void {
  bindings.clear();
}

/** Error lines depend on where the evaluated program starts inside the generated function,
 *  which differs between engines. The offset is measured once, at kernel start, with a
 *  known failing cell, so `line <N>` is the 1-based line in the user's own cell either way. */
let measuredOffset: number | null = null;

async function calibrateOffset(): Promise<void> {
  // The calibration cell uses the same shape as a real run: a head with a declaration
  // and a tail expression, so the frame it reports lands exactly like a user's error.
  const code = "const a = 1;\nnull.__bp_missing__";
  const parsed = parseCell(code);
  const checkCall = "__bp_check__();";
  const guardedHead = guardLoops(loosenDeclarations(parsed.head), checkCall);
  const guardedTail = parsed.tail === null ? null : guardLoops(parsed.tail, checkCall);
  const prologue = [
    "const console = __bp_console__;",
    "const display = __bp_display__;",
    "const __bp_check__ = __bp_check_fn__;",
  ];
  const bodyLines = [guardedHead];
  if (guardedTail !== null) {
    bodyLines.push(`return [(${guardedTail}), false];`);
  }
  bodyLines.push("return [undefined, true];");
  const program = [...prologue, ...bodyLines].join("\n");
  const factory = new Function(
    "__bp_console__",
    "__bp_display__",
    "__bp_check_fn__",
    "__bp_bag__",
    `"use strict";\nreturn (async () => {\n${program}\n})();`,
  );
  const noop = (): void => undefined;
  try {
    await (factory(noop, noop, noop, {}) as Promise<unknown>);
  } catch (err) {
    const reported = deepestUserFrame((err as { stack?: string }).stack ?? "");
    // The throw is in the tail, which is user line 2 here.
    if (reported !== null) measuredOffset = reported - prologue.length - 2;
  }
}

const calibrated = calibrateOffset();

function deepestUserFrame(stack: string): number | null {
  const frames = stack.split("\n").filter((line) => /<anonymous>:\d+/.test(line));
  if (frames.length === 0) return null;
  // The first anonymous frame is the one inside the evaluated program.
  const reported = Number(frames[0].match(/<anonymous>:(\d+)/)?.[1] ?? "0");
  return reported > 0 ? reported : null;
}

function errorLine(err: unknown, prologueLines: number, code: string): number {
  const stack = (err as { stack?: string }).stack ?? "";
  const reported = deepestUserFrame(stack);
  if (reported !== null && measuredOffset !== null) {
    return Math.max(1, reported - prologueLines - measuredOffset);
  }
  if (err instanceof SyntaxError) {
    const syntaxLine = syntaxErrorLine(code);
    if (syntaxLine !== null) return Math.max(1, syntaxLine);
  }
  return 1;
}

function syntaxErrorLine(code: string): number | null {
  try {
    acorn.parse(code, { ecmaVersion: "latest", allowAwaitOutsideFunction: true, locations: true });
    return null;
  } catch (err) {
    const loc = (err as { loc?: { line: number } }).loc;
    return loc?.line ?? null;
  }
}

function errorOutput(name: string, message: string, line: number): KernelOutput {
  return { output_type: "error", ename: name, evalue: message, traceback: [`${name}: ${message}`, `line ${line}`] };
}

function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  const text = String(seconds);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

let activeInterrupt: (() => void) | null = null;

export function requestInterrupt(): void {
  activeInterrupt?.();
}

export async function runCell(code: string, execLimitMs: number, quiet = false): Promise<RunOutcome> {
  await calibrated;
  const state: LoopState = {
    flag: false,
    deadline: Date.now() + execLimitMs,
    limitMessage: `Execution time limit reached (${formatSeconds(execLimitMs)} s)`,
  };
  let interruptedByUser = false;
  activeInterrupt = () => {
    interruptedByUser = true;
    state.flag = true;
    // The loop check reads Date.now() every iteration, so pulling the deadline to now
    // stops a running loop even when the worker thread was mid-spin.
    state.deadline = 0;
  };
  const timer = setTimeout(() => {
    state.flag = true;
  }, execLimitMs);

  const outputs: KernelOutput[] = [];
  const streamParts: { name: "stdout" | "stderr"; parts: string[] }[] = [];
  const displays: KernelOutput[] = [];
  const emitStream = (name: "stdout" | "stderr", text: string): void => {
    const last = streamParts[streamParts.length - 1];
    if (last !== undefined && last.name === name) {
      last.parts.push(text);
    } else {
      streamParts.push({ name, parts: [text] });
    }
  };
  const quietStream = quiet ? () => undefined : emitStream;
  const consoleShim = {
    log: (...args: unknown[]) => quietStream("stdout", `${args.map(arg => typeof arg === "string" ? arg : formatValue(arg)).join(" ")}\n`),
    error: (...args: unknown[]) => quietStream("stderr", `${args.map(arg => typeof arg === "string" ? arg : formatValue(arg)).join(" ")}\n`),
    warn: (...args: unknown[]) => quietStream("stderr", `${args.map(arg => typeof arg === "string" ? arg : formatValue(arg)).join(" ")}\n`),
    info: (...args: unknown[]) => quietStream("stdout", `${args.map(arg => typeof arg === "string" ? arg : formatValue(arg)).join(" ")}\n`),
    debug: (...args: unknown[]) => quietStream("stdout", `${args.map(arg => typeof arg === "string" ? arg : formatValue(arg)).join(" ")}\n`),
  };
  const displayFn = (value: unknown, mimeType?: string): void => {
    if (quiet) return;
    const type = mimeType ?? "text/plain";
    if (!DISPLAY_TYPES.includes(type)) {
      throw new TypeError(`display(): unsupported type ${type}`);
    }
    if (type === "application/vnd.brackenpad.table+json") {
      displays.push({ output_type: "display_data", data: { "application/vnd.brackenpad.table+json": value }, metadata: {} });
      return;
    }
    if (type === "image/svg+xml") {
      displays.push({ output_type: "display_data", data: { "image/svg+xml": String(value) }, metadata: {} });
      return;
    }
    if (type === "text/plain") {
      displays.push({ output_type: "display_data", data: { "text/plain": typeof value === "string" ? value : formatValue(value) }, metadata: {} });
      return;
    }
    displays.push({ output_type: "display_data", data: { [type]: String(value) }, metadata: {} });
  };

  const parsed = parseCell(code);
  const checkCall = "__bp_check__();";
  const loosenedHead = loosenDeclarations(parsed.head);
  const guardedHead = guardLoops(loosenedHead, checkCall);
  const guardedTail = parsed.tail === null ? null : guardLoops(parsed.tail, checkCall);
  // Earlier values replay as var statements, so a later declaration of the same name overwrites.
  const replay = [...bindings.entries()].map(([name]) => `var ${name} = __bp_bag__[${JSON.stringify(name)}];`);
  const bag: Record<string, unknown> = Object.fromEntries(bindings);
  const prologue = [
    "const console = __bp_console__;",
    "const display = __bp_display__;",
    "const __bp_check__ = __bp_check_fn__;",
    ...replay,
  ];
  const prologueLines = prologue.length;
  const bodyLines = [guardedHead];
  if (guardedTail !== null) {
    bodyLines.push(`return [(${guardedTail}), false];`);
  }
  bodyLines.push("return [undefined, true];");
  const program = [...prologue, ...bodyLines].join("\n");

  let outcome: RunOutcome;
  try {
    const factory = new Function(
      "__bp_console__",
      "__bp_display__",
      "__bp_check_fn__",
      "__bp_bag__",
      `"use strict";\nreturn (async () => {\n${program}\n})();`,
    );
    const check = makeCheck(state);
    const [resultValue, noResult] = (await factory(consoleShim, displayFn, check, bag)) as [unknown, boolean];
    for (const part of streamParts) {
      outputs.push({ output_type: "stream", name: part.name, text: part.parts.join("") });
    }
    outputs.push(...displays);
    if (noResult !== true && resultValue !== undefined) {
      outputs.push({
        output_type: "execute_result",
        execution_count: null,
        data: { "text/plain": formatResultValue(resultValue) },
        metadata: {},
      });
    }
    await captureDeclarations(parsed.declared, loosenedHead, consoleShim, displayFn, check, bag);
    outcome = { status: "finished", outputs };
  } catch (err) {
    if ((err as Error).name === "Interrupted") {
      for (const part of streamParts) {
        outputs.push({ output_type: "stream", name: part.name, text: part.parts.join("") });
      }
      outputs.push(errorOutput("Interrupted", interruptedByUser ? "Run interrupted" : state.limitMessage, 1));
      outcome = { status: "interrupted", reason: interruptedByUser ? "interrupt" : "limit", outputs };
    } else {
      for (const part of streamParts) {
        outputs.push({ output_type: "stream", name: part.name, text: part.parts.join("") });
      }
      outputs.push(...displays);
      const name = (err as Error).name || "Error";
      const line = errorLine(err, prologueLines, code);
      outputs.push(errorOutput(name, (err as Error).message ?? String(err), line));
      outcome = { status: "failed", outputs };
    }
  } finally {
    clearTimeout(timer);
    activeInterrupt = null;
  }
  return outcome;
}

/** Re-runs the cell's declaration code quietly and records each declared name's value. */
async function captureDeclarations(
  declared: string[],
  loosenedHead: string,
  consoleShim: unknown,
  displayFn: unknown,
  check: () => void,
  bag: Record<string, unknown>,
): Promise<void> {
  if (declared.length === 0) return;
  const replay = [...bindings.entries()].map(([name]) => `var ${name} = __bp_bag__[${JSON.stringify(name)}];`);
  const captureProgram = [
    "const console = __bp_console__;",
    "const display = __bp_display__;",
    "const __bp_check__ = __bp_check_fn__;",
    ...replay,
    loosenedHead,
    `return { ${declared.map((name) => `${JSON.stringify(name)}: (() => { try { return ${name}; } catch { return undefined; } })()`).join(", ")} };`,
  ].join("\n");
  const capture = new Function(
    "__bp_console__",
    "__bp_display__",
    "__bp_check_fn__",
    "__bp_bag__",
    `"use strict";\nreturn (async () => {\n${captureProgram}\n})();`,
  );
  const values = (await capture(consoleShim, displayFn, check, bag)) as Record<string, unknown>;
  for (const name of declared) {
    bindings.set(name, values[name]);
  }
}

/** A result value's own .name is read before any assignment-name heuristic can apply. */
function formatResultValue(value: unknown): string {
  if (typeof value === "function") {
    return `[Function ${value.name === "" ? "anonymous" : value.name}]`;
  }
  return formatValue(value);
}
