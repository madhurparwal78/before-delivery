import type { NodeDefinition } from './graph.js';

export interface ConsoleLine {
  scriptName: string;
  text: string;
  error: boolean;
}

export interface ScriptRun {
  consoleLines: ConsoleLine[];
  registeredNodes: NodeDefinition[];
  onBeat: ((ctx: BeatContext) => void) | undefined;
  stopped: boolean;
}

export interface BeatContext {
  beat: number;
  bar: number;
  bpm: number;
  set: (layerName: string, property: string, value: number) => void;
}

const TIMEOUT_MS = 50;

function stringify (value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || value === null || value === undefined) return String(value);
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// Runs the script's top level in an isolated scope with only registerNode and
// console.log, and returns its onBeat if it declared one. A throw stops the
// script; the stage keeps drawing.
export function runScript (scriptName: string, source: string, hooks: {
  registerNode: (definition: NodeDefinition) => void;
  consoleLine: (line: ConsoleLine) => void;
}): ScriptRun {
  const run: ScriptRun = { consoleLines: [], registeredNodes: [], onBeat: undefined, stopped: false };
  const sandbox = {
    console: {
      log: (...values: unknown[]): void => {
        const line: ConsoleLine = { scriptName, text: `${scriptName}: ${values.map(stringify).join(' ')}`, error: false };
        run.consoleLines.push(line);
        hooks.consoleLine(line);
      },
    },
    registerNode: (typeName: unknown, definition: unknown): void => {
      if (typeof typeName !== 'string' || typeName.length < 1 || typeName.length > 40) return;
      const def = definition as { inputs?: unknown; outputs?: unknown; run?: unknown };
      const inputs = Array.isArray(def.inputs) ? def.inputs.filter((p): p is string => typeof p === 'string') : [];
      const outputs = Array.isArray(def.outputs) ? def.outputs.filter((p): p is string => typeof p === 'string') : [];
      const runFn = typeof def.run === 'function' ? def.run as (inputs: Record<string, number>) => Record<string, number> : () => ({});
      const nodeDefinition: NodeDefinition = { typeName, inputs, outputs, run: runFn };
      run.registeredNodes.push(nodeDefinition);
      hooks.registerNode(nodeDefinition);
    },
  };
  // The strict-mode wrapper keeps the script off the page's globals. Line
  // numbers in thrown errors are one less than the wrapper's own offset.
  const factory = new Function('console', 'registerNode', `"use strict";\n${source}\n;return typeof onBeat === "function" ? onBeat : undefined;`);
  try {
    run.onBeat = (factory(sandbox.console, sandbox.registerNode) ?? undefined) as ((ctx: BeatContext) => void) | undefined;
  } catch (error) {
    run.stopped = true;
    const line = lineOf(error);
    const text = `${scriptName}: line ${line}: ${error instanceof Error ? error.message : String(error)}`;
    run.consoleLines.push({ scriptName, text, error: true });
    hooks.consoleLine({ scriptName, text, error: true });
  }
  return run;
}

function lineOf (error: unknown): number {
  if (error instanceof Error) {
    const match = /<anonymous>:(\d+):/.exec(error.stack ?? '');
    if (match !== null) return Math.max(1, Number(match[1]) - 1);
  }
  return 1;
}

// Wraps onBeat so a throw or a long run stops only that script.
export function beatRunner (scriptName: string, onBeat: ((ctx: BeatContext) => void) | undefined, hooks: {
  consoleLine: (line: ConsoleLine) => void;
  onStop: () => void;
}): (ctx: BeatContext) => void {
  return (ctx: BeatContext) => {
    if (onBeat === undefined) return;
    const start = performance.now();
    try {
      onBeat(ctx);
    } catch (error) {
      hooks.onStop();
      hooks.consoleLine({ scriptName, text: `${scriptName}: line ${lineOf(error)}: ${error instanceof Error ? error.message : String(error)}`, error: true });
      return;
    }
    if (performance.now() - start > TIMEOUT_MS) {
      hooks.onStop();
      hooks.consoleLine({ scriptName, text: `${scriptName} stopped: onBeat took longer than 50 ms`, error: true });
    }
  };
}
