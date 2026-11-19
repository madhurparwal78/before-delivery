import { MAX_INPUT_EVENTS, MAX_REPLAY_DEPTH, type Lane } from './catalogue.js';
import type { InputEvent } from './race-model.js';

/**
 * The replay file rules from the brief, decided here and nowhere else.
 * Rules 1 to 3 are the structure checks; rules 4 to 9 are the event checks.
 */

type JsonNode =
  | { kind: 'object'; entries: Map<string, JsonNode> }
  | { kind: 'array'; items: JsonNode[] }
  | { kind: 'string'; value: string }
  | { kind: 'number'; raw: string }
  | { kind: 'bool' }
  | { kind: 'null' };

class StrictJsonParser {
  private readonly text: string;
  private at = 0;

  constructor(text: string) {
    this.text = text;
  }

  parse(): JsonNode {
    const value = this.value(1);
    this.ws();
    if (this.at !== this.text.length) throw new SyntaxError('trailing content');
    return value;
  }

  private fail(message: string): never {
    throw new SyntaxError(message);
  }

  private ws(): void {
    while (this.at < this.text.length) {
      const code = this.text.charCodeAt(this.at);
      if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) this.at += 1;
      else break;
    }
  }

  private value(depth: number): JsonNode {
    this.ws();
    const char = this.text[this.at];
    if (char === undefined) this.fail('unexpected end');
    if (char === '{') return this.object(depth);
    if (char === '[') return this.array(depth);
    if (char === '"') return { kind: 'string', value: this.string() };
    if (char === 't') return this.literal('true', { kind: 'bool' });
    if (char === 'f') return this.literal('false', { kind: 'bool' });
    if (char === 'n') return this.literal('null', { kind: 'null' });
    return { kind: 'number', raw: this.number() };
  }

  private literal(word: string, node: JsonNode): JsonNode {
    if (this.text.startsWith(word, this.at)) {
      this.at += word.length;
      return node;
    }
    this.fail(`expected ${word}`);
  }

  private object(depth: number): JsonNode {
    if (depth > MAX_REPLAY_DEPTH) this.fail('too deep');
    this.at += 1;
    const entries = new Map<string, JsonNode>();
    this.ws();
    if (this.text[this.at] === '}') {
      this.at += 1;
      return { kind: 'object', entries };
    }
    for (;;) {
      this.ws();
      if (this.text[this.at] !== '"') this.fail('expected key');
      const key = this.string();
      if (entries.has(key)) this.fail('duplicate key');
      this.ws();
      if (this.text[this.at] !== ':') this.fail('expected colon');
      this.at += 1;
      entries.set(key, this.value(depth + 1));
      this.ws();
      const next = this.text[this.at];
      if (next === ',') {
        this.at += 1;
        continue;
      }
      if (next === '}') {
        this.at += 1;
        return { kind: 'object', entries };
      }
      this.fail('expected , or }');
    }
  }

  private array(depth: number): JsonNode {
    if (depth > MAX_REPLAY_DEPTH) this.fail('too deep');
    this.at += 1;
    const items: JsonNode[] = [];
    this.ws();
    if (this.text[this.at] === ']') {
      this.at += 1;
      return { kind: 'array', items };
    }
    for (;;) {
      items.push(this.value(depth + 1));
      this.ws();
      const next = this.text[this.at];
      if (next === ',') {
        this.at += 1;
        continue;
      }
      if (next === ']') {
        this.at += 1;
        return { kind: 'array', items };
      }
      this.fail('expected , or ]');
    }
  }

  private string(): string {
    this.at += 1;
    let out = '';
    for (;;) {
      const char = this.text[this.at];
      if (char === undefined) this.fail('unterminated string');
      this.at += 1;
      if (char === '"') return out;
      if (char === '\\') {
        const escape = this.text[this.at];
        this.at += 1;
        switch (escape) {
          case '"':
            out += '"';
            break;
          case '\\':
            out += '\\';
            break;
          case '/':
            out += '/';
            break;
          case 'b':
            out += '\b';
            break;
          case 'f':
            out += '\f';
            break;
          case 'n':
            out += '\n';
            break;
          case 'r':
            out += '\r';
            break;
          case 't':
            out += '\t';
            break;
          case 'u': {
            const hex = this.text.slice(this.at, this.at + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('bad escape');
            out += String.fromCharCode(Number.parseInt(hex, 16));
            this.at += 4;
            break;
          }
          default:
            this.fail('bad escape');
        }
        continue;
      }
      if (char.charCodeAt(0) < 0x20) this.fail('control character in string');
      out += char;
    }
  }

  private number(): string {
    const match = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(this.text.slice(this.at));
    if (!match) this.fail('bad number');
    this.at += match[0].length;
    return match[0];
  }
}

export interface ReplayStructure {
  seed: JsonNode;
  inputs: JsonNode[];
}

export type StructureResult =
  | { ok: true; structure: ReplayStructure }
  | { ok: false };

/** Replay file rules 1 to 3. */
export function readReplayStructure(bytes: Uint8Array | string): StructureResult {
  const text = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes);
  let root: JsonNode;
  try {
    root = new StrictJsonParser(text).parse();
  } catch {
    return { ok: false };
  }
  if (root.kind !== 'object') return { ok: false };
  const seed = root.entries.get('seed');
  const inputs = root.entries.get('inputs');
  if (seed === undefined || inputs === undefined || inputs.kind !== 'array') return { ok: false };
  return { ok: true, structure: { seed, inputs: inputs.items } };
}

export function seedMatches(structure: ReplayStructure, seed: string): boolean {
  return structure.seed.kind === 'string' && structure.seed.value === seed;
}

const EVENT_KEYS = ['step', 'throttle', 'brake', 'drift', 'lane'];
const PLAIN_DIGITS = /^[0-9]+$/;

function readFlag(node: JsonNode | undefined): 0 | 1 | null {
  if (node === undefined || node.kind !== 'number') return null;
  if (node.raw === '0') return 0;
  if (node.raw === '1') return 1;
  return null;
}

function readLane(node: JsonNode | undefined): Lane | null {
  if (node === undefined || node.kind !== 'string') return null;
  if (node.value === 'left' || node.value === 'middle' || node.value === 'right') return node.value;
  return null;
}

export type EventsResult = { ok: true; inputs: InputEvent[] } | { ok: false };

/** Replay file rules 4 to 9. */
export function readReplayEvents(structure: ReplayStructure, stepLimit: number): EventsResult {
  const nodes = structure.inputs;
  if (nodes.length < 1 || nodes.length > MAX_INPUT_EVENTS) return { ok: false };
  const inputs: InputEvent[] = [];
  let previousStep = -1;
  for (const node of nodes) {
    if (node.kind !== 'object') return { ok: false };
    if (node.entries.size !== EVENT_KEYS.length) return { ok: false };
    for (const key of EVENT_KEYS) if (!node.entries.has(key)) return { ok: false };
    const stepNode = node.entries.get('step')!;
    if (stepNode.kind !== 'number' || !PLAIN_DIGITS.test(stepNode.raw)) return { ok: false };
    const step = Number.parseInt(stepNode.raw, 10);
    if (step > stepLimit - 1) return { ok: false };
    if (inputs.length === 0 ? step !== 0 : step <= previousStep) return { ok: false };
    previousStep = step;
    const throttle = readFlag(node.entries.get('throttle'));
    const brake = readFlag(node.entries.get('brake'));
    const drift = readFlag(node.entries.get('drift'));
    const lane = readLane(node.entries.get('lane'));
    if (throttle === null || brake === null || drift === null || lane === null) return { ok: false };
    inputs.push({ step, throttle, brake, drift, lane });
  }
  return { ok: true, inputs };
}

export function serialiseReplayFile(seed: string, inputs: InputEvent[]): string {
  return JSON.stringify({ seed, inputs });
}
