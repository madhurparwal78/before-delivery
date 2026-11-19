import { isKeyableProperty } from '../shared/domain.js';
import type { ScriptDoc } from '../shared/types.js';
import type { Overrides, PluginNodeType } from './graph.js';

/** Scripts run isolated from the page, storage and the network. */

const ALLOWED_GLOBALS: Record<string, unknown> = {
  Array,
  ArrayBuffer,
  BigInt,
  Boolean,
  DataView,
  Date,
  Error,
  EvalError,
  Float32Array,
  Float64Array,
  Infinity,
  Int8Array,
  Int16Array,
  Int32Array,
  JSON,
  Map,
  Math,
  NaN,
  Number,
  Object,
  Promise,
  Proxy,
  RangeError,
  ReferenceError,
  Reflect,
  RegExp,
  Set,
  String,
  Symbol,
  SyntaxError,
  TypeError,
  URIError,
  Uint8Array,
  Uint16Array,
  Uint32Array,
  WeakMap,
  WeakSet,
  decodeURIComponent,
  encodeURIComponent,
  isFinite,
  isNaN,
  parseFloat,
  parseInt,
  undefined,
};

const NETWORK_GLOBALS = new Set([
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'navigator',
  'sendBeacon',
  'importScripts',
  'Request',
  'Response',
]);

class NetworkAccessError extends Error {}

export interface ScriptContext {
  beat: number;
  bar: number;
  bpm: number;
  set: (layerName: string, property: string, value: number) => void;
}

interface LoadedScript {
  id: string;
  name: string;
  onBeat: ((ctx: ScriptContext) => void) | null;
  stopped: boolean;
}

export interface ScriptHostHandlers {
  onConsole: (line: string) => void;
  onStatus: (line: string) => void;
}

/** The first frame of a sandbox stack carries the line number in the script's own text. */
function stackLine(error: unknown): number | null {
  const stack = error instanceof Error ? error.stack ?? '' : '';
  const lines = stack.split('\n');
  const frame = lines.find((line) => line.includes(':') && line !== lines[0]) ?? '';
  const matches = [...frame.matchAll(/:(\d+):\d+/g)];
  const last = matches[matches.length - 1];
  return last === undefined ? null : Number(last[1]);
}

export class ScriptHost {
  readonly plugins = new Map<string, PluginNodeType>();
  overrides: Overrides = new Map();
  private scripts: LoadedScript[] = [];
  private handlers: ScriptHostHandlers;
  private lineOffset = 0;

  constructor(handlers: ScriptHostHandlers) {
    this.handlers = handlers;
    this.lineOffset = this.measureLineOffset();
  }

  private measureLineOffset(): number {
    try {
      this.compile('throw new Error("probe");', 'probe', 'probe')();
    } catch (error) {
      const line = stackLine(error);
      if (line !== null) return line - 1;
    }
    return 0;
  }

  private compile(source: string, scriptId: string, scriptName: string): () => LoadedScript['onBeat'] {
    const host = this;
    const scope = new Proxy(
      {},
      {
        has: () => true,
        get: (_target, property: string) => {
          if (property === Symbol.unscopables.toString()) return undefined;
          if (NETWORK_GLOBALS.has(property)) throw new NetworkAccessError(property);
          if (property === 'console') {
            return {
              log: (...values: unknown[]) => {
                host.handlers.onConsole(`${scriptName}: ${values.map((value) => String(value)).join(' ')}`);
              },
            };
          }
          if (property === 'registerNode') {
            return (typeName: unknown, definition: unknown) =>
              host.register(scriptId, typeName, definition);
          }
          if (property in ALLOWED_GLOBALS) return ALLOWED_GLOBALS[property];
          return undefined;
        },
        set: () => true,
      },
    );
    const factory = new Function(
      'scope',
      `with (scope) {
${source}
;return typeof onBeat === 'function' ? onBeat : null;
}`,
    ) as (sandbox: object) => LoadedScript['onBeat'];
    return () => factory(scope);
  }

  private register(scriptId: string, typeName: unknown, definition: unknown): void {
    if (typeof typeName !== 'string' || typeName.length < 1 || typeName.length > 40) return;
    const record = definition !== null && typeof definition === 'object' ? (definition as Record<string, unknown>) : {};
    const inputs = Array.isArray(record['inputs']) ? record['inputs'].map((port) => String(port)) : [];
    const outputs = Array.isArray(record['outputs']) ? record['outputs'].map((port) => String(port)) : [];
    const run = record['run'];
    if (typeof run !== 'function') return;
    this.plugins.set(typeName, {
      typeName,
      scriptId,
      inputs,
      outputs,
      run: (values) => (run as (inputs: Record<string, number>) => unknown).call(record, values),
    });
  }

  /** A script's top level runs when the set opens and again after each save. */
  load(scripts: ScriptDoc[]): void {
    for (const [typeName, plugin] of [...this.plugins]) {
      if (!scripts.some((script) => script.id === plugin.scriptId)) this.plugins.delete(typeName);
    }
    this.scripts = scripts.map((script) => {
      for (const [typeName, plugin] of [...this.plugins]) {
        if (plugin.scriptId === script.id) this.plugins.delete(typeName);
      }
      const loaded: LoadedScript = { id: script.id, name: script.name, onBeat: null, stopped: false };
      try {
        loaded.onBeat = this.compile(script.source, script.id, script.name)();
      } catch (error) {
        loaded.stopped = true;
        this.report(script.name, error);
      }
      return loaded;
    });
  }

  private report(scriptName: string, error: unknown): void {
    if (error instanceof NetworkAccessError) {
      this.handlers.onStatus(`${scriptName} stopped: network access is not allowed`);
      return;
    }
    const line = stackLine(error);
    const reported = line === null ? 1 : Math.max(1, line - this.lineOffset);
    const message = error instanceof Error ? error.message : String(error);
    this.handlers.onStatus(`${scriptName}: line ${reported}: ${message}`);
  }

  /** onBeat(ctx) runs once per beat while the transport plays. */
  runBeat(beat: number, bpm: number, resolve: (layerName: string) => string | null): void {
    const overrides: Overrides = new Map(this.overrides);
    for (const script of this.scripts) {
      if (script.stopped || script.onBeat === null) continue;
      const context: ScriptContext = {
        beat,
        bar: Math.floor(beat / 4) + 1,
        bpm,
        set: (layerName, property, value) => {
          const layerId = resolve(layerName);
          if (layerId === null || !isKeyableProperty(property) || typeof value !== 'number') return;
          const existing = overrides.get(layerId) ?? new Map<string, number>();
          existing.set(property, value);
          overrides.set(layerId, existing);
        },
      };
      const started = performance.now();
      try {
        script.onBeat(context);
      } catch (error) {
        script.stopped = true;
        this.report(script.name, error);
        continue;
      }
      if (performance.now() - started > 50) {
        script.stopped = true;
        this.handlers.onStatus(`${script.name} stopped: onBeat took longer than 50 ms`);
      }
    }
    this.overrides = overrides;
  }

  nodeTypes(): string[] {
    return [...this.plugins.keys()];
  }
}
