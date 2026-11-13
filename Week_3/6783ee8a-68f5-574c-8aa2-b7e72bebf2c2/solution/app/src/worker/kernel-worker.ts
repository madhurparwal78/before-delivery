import { cleanSeconds, TABLE_MIME } from "../shared/api";
import type { ErrorOutput, Output } from "../shared/api";
import { consoleText, formatValue } from "./format";
import { HALT_FLAG } from "./protocol";
import type { FromKernel, Halt, ToKernel } from "./protocol";
import { CellSyntaxError, transformCell } from "./transform";

declare const self: DedicatedWorkerGlobalScope;

let flag: Int32Array | null = null;
let outputs: Output[] = [];
let wake: ((reason: Halt) => void) | null = null;

/** Thrown by a loop guard (or the awaiting race) when the page interrupts or the time limit passes. */
class Stopped {
  readonly stack = new Error().stack ?? "";
  constructor(readonly reason: Halt) {}
}

function guard(): void {
  if (!flag) return;
  const value = Atomics.load(flag, 0);
  if (value !== 0) throw new Stopped(value === HALT_FLAG.limit ? "limit" : "interrupt");
}

function stream(name: "stdout" | "stderr", args: unknown[]): void {
  const text = `${args.map(consoleText).join(" ")}\n`;
  const last = outputs[outputs.length - 1];
  if (last && last.output_type === "stream" && last.name === name) last.text = `${last.text as string}${text}`;
  else outputs.push({ output_type: "stream", name, text });
}

const MIMES = ["text/plain", "text/markdown", "text/html", "image/svg+xml", TABLE_MIME];

function display(value: unknown, mime = "text/plain"): void {
  if (!MIMES.includes(mime)) throw new TypeError(`display(): unsupported type ${mime}`);
  let data: unknown;
  if (mime === "text/plain") data = formatValue(value);
  else if (mime === TABLE_MIME) {
    const table = value as { columns?: unknown; rows?: unknown } | null;
    if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) throw new TypeError("display(): a table needs columns and rows");
    data = JSON.parse(JSON.stringify({ columns: table.columns, rows: table.rows }));
  } else data = String(value);
  outputs.push({ output_type: "display_data", data: { [mime]: data }, metadata: {} });
}

Object.assign(globalThis, {
  __guard: guard,
  display,
  console: {
    log: (...args: unknown[]) => stream("stdout", args),
    info: (...args: unknown[]) => stream("stdout", args),
    debug: (...args: unknown[]) => stream("stdout", args),
    error: (...args: unknown[]) => stream("stderr", args),
    warn: (...args: unknown[]) => stream("stderr", args),
  },
});

const post = (message: FromKernel): void => self.postMessage(message);

function lineIn(stack: string | undefined, id: string): number {
  const match = new RegExp(`bp-cell-${id}:(\\d+):\\d+`).exec(stack ?? "");
  return match ? Number(match[1]) : 1;
}

function errorOutput(name: string, message: string, line: number): ErrorOutput {
  return { output_type: "error", ename: name, evalue: message, traceback: [`${name}: ${message}`, `line ${line}`] };
}

async function run(id: string, source: string, limitMs: number): Promise<void> {
  outputs = [];
  let status: "finished" | "failed" | "interrupted" = "finished";
  try {
    const code = transformCell(source);
    const cell = (0, eval)(`(async function(){${code}\n})\n//# sourceURL=bp-cell-${id}`) as () => Promise<unknown>;
    const stopped = new Promise<never>((_, reject) => {
      wake = (reason) => reject(new Stopped(reason));
    });
    const value = await Promise.race([cell.call(globalThis), stopped]);
    if (value !== undefined) outputs.push({ output_type: "execute_result", execution_count: null, data: { "text/plain": formatValue(value) }, metadata: {} });
  } catch (caught) {
    if (caught instanceof Stopped) {
      status = "interrupted";
      const message = caught.reason === "limit" ? `Execution time limit reached (${cleanSeconds(limitMs)} s)` : "Run interrupted";
      outputs.push(errorOutput("Interrupted", message, lineIn(caught.stack, id)));
    } else if (caught instanceof CellSyntaxError) {
      status = "failed";
      outputs.push(errorOutput("SyntaxError", caught.message, caught.line));
    } else {
      status = "failed";
      const error = caught instanceof Error ? caught : new Error(String(caught));
      outputs.push(errorOutput(error.name || "Error", error.message, lineIn(error.stack, id)));
    }
  } finally {
    wake = null;
  }
  const finished = outputs;
  outputs = [];
  post({ type: "result", id, status, outputs: finished });
}

self.onmessage = (event: MessageEvent<ToKernel>) => {
  const message = event.data;
  if (message.type === "init") {
    flag = message.flag ? new Int32Array(message.flag) : null;
    post({ type: "ready" });
  } else if (message.type === "run") {
    void run(message.id, message.source, message.limitMs);
  } else {
    wake?.(message.reason);
  }
};
