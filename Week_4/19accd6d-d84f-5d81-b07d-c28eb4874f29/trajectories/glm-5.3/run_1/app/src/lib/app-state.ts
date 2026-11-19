import type { Step } from '../../shared/catalogue.js';
import { stepFrom } from '../../shared/catalogue.js';
import type { ClientConfig } from '../../shared/protocol.js';
import { countLines, detectSuggestion, byteCountText } from '../../shared/text.js';

export interface InputTab {
  id: string;
  name: string;
  text: string;
  encoding: 'UTF-8' | 'UTF-16LE' | 'ISO-8859-1';
  file: { id: string; name: string; bytes: Uint8Array } | null;
  /** Character selection [start, end) into the text, when the tab is typed input. */
  selection: { start: number; end: number } | null;
}

export interface RecipeRef {
  id: string | null;
  name: string;
  baseVersion: number;
  savedName: string | null;
  owner: 'user' | 'team';
  ownerId: string | null;
  ownerName: string;
}

export type BakeState =
  | { kind: 'idle' }
  | { kind: 'running'; startedAt: number }
  | { kind: 'paused'; beforeStep: number }
  | { kind: 'done'; ms: number }
  | { kind: 'error'; stepIndex: number; step: number; branch: number | null; message: string };

export interface SpanMapping {
  /** 0-based [start, end) into the final output, or null when lost. */
  outputRange: { start: number; end: number } | null;
  /** Step index (0-based) that lost the span, when it was lost. */
  lostAt: number | null;
  /** Per-step chips: 0-based index -> inclusive range [a, b], or 'lost'. */
  chips: Map<number, { start: number; end: number } | 'lost'>;
}

export const DEFAULT_CONFIG: ClientConfig = {
  autobakeMs: 300,
  regexBudgetMs: 2000,
  inputMaxBytes: 2097152,
  fileMaxBytes: 1048576,
  outputDisplayBytes: 65536,
  versionsKept: 20,
  teamMax: 5,
  shareTtlChoices: ['1h', '1d', '7d'],
  shareTtlLabels: { '1h': '1 hour', '1d': '1 day', '7d': '7 days' },
};

export const DEFAULT_FAVOURITES = ['To Base64', 'From Base64', 'To Hex', 'Gunzip', 'JSON Beautify'];

/** Encodes typed text in the chosen encoding; returns the first unencodable character when it cannot. */
export function encodeInput(text: string, encoding: InputTab['encoding']): { bytes: Uint8Array } | { error: string } {
  if (encoding === 'UTF-8') return { bytes: new TextEncoder().encode(text) };
  if (encoding === 'UTF-16LE') {
    const out = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      const cp = text.charCodeAt(i);
      out[i * 2] = cp & 0xff;
      out[i * 2 + 1] = cp >> 8;
    }
    return { bytes: out };
  }
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)!;
    if (cp > 0xff) {
      return { error: `Character U+${cp.toString(16).toUpperCase().padStart(4, '0')} cannot be encoded in ISO-8859-1` };
    }
    out[i] = cp;
  }
  return { bytes: out };
}

export function tabBytes(tab: InputTab): { bytes: Uint8Array } | { error: string } {
  if (tab.file) return { bytes: tab.file.bytes };
  return encodeInput(tab.text, tab.encoding);
}

/** The one span-offset rule set (Business rules): chips and tints from a typed selection. */
export function mapSpan(steps: Step[], inputBytes: Uint8Array, selection: { start: number; end: number }, intermediates: Map<number, Uint8Array>, pausedBefore: number | null): SpanMapping {
  const startByte = byteOffsetOf(inputBytes, selection.start);
  const endByte = byteOffsetOf(inputBytes, selection.end);
  let range: { start: number; end: number } = { start: startByte, end: endByte };
  const chips = new Map<number, { start: number; end: number } | 'lost'>();
  let lost = false;
  let lostAt: number | null = null;
  let current: Uint8Array = inputBytes;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.disabled) continue;
    if (pausedBefore !== null && i >= pausedBefore) break;
    const next = intermediates.get(i);
    if (!next) break;
    const op = step.op;
    if (op === 'To Hex' || op === 'To Binary') {
      const k = op === 'To Hex' ? 2 : 8;
      const delimLen = delimiterLength(op, step);
      const width = k + delimLen;
      const a = range.start * width;
      const b = range.end * width - delimLen;
      range = { start: a, end: Math.max(a, b) };
    } else if (op === 'To Base64') {
      const a = Math.floor(range.start / 3) * 4;
      const b = Math.ceil(range.end / 3) * 4;
      const outLen = next.length;
      range = { start: Math.min(a, outLen), end: Math.min(b, outLen) };
    } else if (op === 'Change Case') {
      if (next.length !== current.length) {
        chips.set(i, 'lost');
        lost = true;
        lostAt = i;
        break;
      }
    } else {
      chips.set(i, 'lost');
      lost = true;
      lostAt = i;
      break;
    }
    chips.set(i, { start: range.start, end: Math.max(range.start, range.end - 1) });
    current = next;
  }
  if (lost) {
    return { outputRange: null, lostAt, chips };
  }
  return { outputRange: range, lostAt: null, chips };
}

function delimiterLength(op: string, step: Step): number {
  const label = String(step.args.delimiter ?? 'Space');
  if (label === 'None') return 0;
  return 1;
}

function byteOffsetOf(bytes: Uint8Array, charIndex: number): number {
  // Interprets the bytes as UTF-8 to find the byte offset of a character index.
  let offset = 0;
  let chars = 0;
  while (offset < bytes.length && chars < charIndex) {
    const b = bytes[offset];
    if (b < 0x80) offset += 1;
    else if ((b & 0xe0) === 0xc0) offset += 2;
    else if ((b & 0xf0) === 0xe0) offset += 3;
    else offset += 4;
    chars++;
  }
  return offset;
}

export function inputStatusText(bytes: Uint8Array, error: string | null): string {
  if (error) return 'Not encodable';
  return byteCountText(bytes.length, countLines(bytes));
}

export function suggestionFor(tab: InputTab): string | null {
  if (tab.file) return null;
  const encoded = encodeInput(tab.text, tab.encoding);
  if ('error' in encoded) return null;
  return detectSuggestion(encoded.bytes);
}

export function newTab(index: number): InputTab {
  return {
    id: `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    name: `Input ${index}`,
    text: '',
    encoding: 'UTF-8',
    file: null,
    selection: null,
  };
}

/** The starter recipe and its baked input, from Seed data (DP-09). */
export function starterState(): { steps: Step[]; inputText: string } {
  const steps = [
    stepFrom('From Base64', { alphabet: 'Standard', strict: false }),
    stepFrom('Gunzip'),
    stepFrom('JSON Beautify', { indent: '2' }),
  ];
  const json = '{"event":"invoice.paid","invoice":{"id":"inv_1042","amount":4200,"currency":"EUR"},"items":["kettle","cloth"]}';
  const gz = gzipBytes(new TextEncoder().encode(json));
  const b64 = toStandardBase64(gz);
  return { steps, inputText: b64 };
}

function gzipBytes(bytes: Uint8Array): Uint8Array {
  // gzip is deterministic for a given level; produced at startup in the browser via fflate.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fflate = (globalThis as any).__wbFflate;
  if (fflate) return fflate.gzipSync(bytes, { level: 6 }) as Uint8Array;
  return bytes;
}

function toStandardBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return btoa(out);
}

export function recipeLine(ref: RecipeRef, dirty: boolean): string {
  const base = ref.id === null ? 'Unsaved recipe' : `${ref.savedName ?? ref.name} · version ${ref.baseVersion}`;
  return dirty ? `${base} · edited` : base;
}
