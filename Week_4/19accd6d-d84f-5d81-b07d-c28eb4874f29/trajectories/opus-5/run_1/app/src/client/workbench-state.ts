import { countLines, encodeText, isValidUtf8, OpError, toHexLower, decodeLossy } from '../shared/bytes.js';
import type { TextEncodingName } from '../shared/bytes.js';
import { byteLineStatus } from '../shared/format.js';
import { findOperation, normalizeArgs } from '../shared/ops.js';
import { carrySpan, type SpanRange } from '../shared/span.js';
import type { RecipeStep } from '../shared/recipe.js';
import { parseJson } from '../shared/json.js';
import type { BakeResult } from './baker.js';

export interface InputTab {
  text: string;
  encoding: TextEncodingName;
  file: { id: string; name: string } | null;
  fileBytes: Uint8Array | null;
  selection: { start: number; end: number } | null;
}

export interface RecipeRef {
  id: string;
  name: string;
  version: number;
  tags: string[];
  note: string;
  ownerType: 'user' | 'team';
  ownerId: string;
}

export interface WorkbenchState {
  steps: RecipeStep[];
  tabs: InputTab[];
  selectedTab: number;
  autoBake: boolean;
  outputView: 'Text' | 'Hex';
  recipe: RecipeRef | null;
  edited: boolean;
  favourites: string[];
  result: BakeResult | null;
  pausedAt: number | null;
  baking: boolean;
  splitA: number;
  splitB: number;
  splitC: number;
}

export function newTab(): InputTab {
  return { text: '', encoding: 'UTF-8', file: null, fileBytes: null, selection: null };
}

export const DEFAULT_FAVOURITES = ['To Base64', 'From Base64', 'To Hex', 'Gunzip', 'JSON Beautify'];

export const STARTER_STEPS: RecipeStep[] = [
  { op: 'From Base64', args: { alphabet: 'Standard', strict: false }, disabled: false, breakpoint: false },
  { op: 'Gunzip', args: {}, disabled: false, breakpoint: false },
  { op: 'JSON Beautify', args: { indent: '2' }, disabled: false, breakpoint: false },
];

/** Standard Base64 of a gzip of the starter JSON payload. */
export const STARTER_INPUT =
  'H4sIAAAAAAAAAzWLwQpAQBRF/+WuJw1Zzd4PKCtJGq9MzIx4lCb/7lGWp3NOAp0UGAYunNFZytbBjVA/wiQIf7rPdVmIGnw83qUstFawx7ZRsJc0VVPjlpXJ7zAtZmJeSA67RJ7Q3Q8eyU6SbgAAAA==';

const STORAGE_KEY = 'wringbench.workbench';
const FAVOURITES_KEY = 'wringbench.favourites';

interface StoredState {
  steps: RecipeStep[];
  tabs: { text: string; encoding: TextEncodingName; file: { id: string; name: string } | null }[];
  selectedTab: number;
  autoBake: boolean;
  outputView: 'Text' | 'Hex';
  recipe: RecipeRef | null;
}

export function loadFavourites(): string[] {
  try {
    const raw = window.localStorage.getItem(FAVOURITES_KEY);
    if (raw === null) return [...DEFAULT_FAVOURITES];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_FAVOURITES];
    return parsed.filter((name): name is string => typeof name === 'string' && findOperation(name) !== undefined);
  } catch {
    return [...DEFAULT_FAVOURITES];
  }
}

export function saveFavourites(favourites: readonly string[]): void {
  window.localStorage.setItem(FAVOURITES_KEY, JSON.stringify(favourites));
}

export function loadStored(): StoredState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    return JSON.parse(raw) as StoredState;
  } catch {
    return null;
  }
}

export function storeState(state: WorkbenchState): void {
  const stored: StoredState = {
    steps: state.steps,
    tabs: state.tabs.map((tab) => ({ text: tab.text, encoding: tab.encoding, file: tab.file })),
    selectedTab: state.selectedTab,
    autoBake: state.autoBake,
    outputView: state.outputView,
    recipe: state.recipe,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // A browser with storage switched off still works, it just forgets.
  }
}

export interface InputBytes {
  bytes: Uint8Array | null;
  error: string | null;
}

/** The bytes a tab contributes: its file's bytes, or its text in the chosen encoding. */
export function tabBytes(tab: InputTab): InputBytes {
  if (tab.fileBytes !== null) return { bytes: tab.fileBytes, error: null };
  try {
    return { bytes: encodeText(tab.text, tab.encoding), error: null };
  } catch (cause) {
    return { bytes: null, error: cause instanceof OpError ? cause.message : String(cause) };
  }
}

export function enabledIndices(steps: readonly RecipeStep[]): number[] {
  const indices: number[] = [];
  steps.forEach((step, index) => {
    if (!step.disabled) indices.push(index);
  });
  return indices;
}

/** Where a normal bake should pause: before the first enabled step carrying a breakpoint. */
export function firstBreakpoint(steps: readonly RecipeStep[], after = -1): number | null {
  for (const index of enabledIndices(steps)) {
    if (index > after && steps[index]!.breakpoint) return index;
  }
  return null;
}

export function nextEnabled(steps: readonly RecipeStep[], after: number): number | null {
  for (const index of enabledIndices(steps)) if (index > after) return index;
  return null;
}

export interface OutputView {
  text: string;
  notices: string[];
  status: string;
  tint: { start: number; end: number } | null;
}

/** Decides what the Output pane shows for a set of bytes. */
export function outputView(
  bytes: Uint8Array,
  view: 'Text' | 'Hex',
  cap: number,
  span: SpanRange | null,
): OutputView {
  const notices: string[] = [];
  const valid = isValidUtf8(bytes);
  const asHex = view === 'Hex' || !valid;
  if (view === 'Text' && !valid) notices.push('Output is not valid UTF-8; showing hex.');
  const truncated = bytes.length > cap;
  if (truncated) {
    notices.push(`Showing the first ${cap} of ${bytes.length} bytes. Download output for all of it.`);
  }
  const shown = truncated ? bytes.subarray(0, cap) : bytes;
  let text: string;
  let tint: { start: number; end: number } | null = null;
  if (asHex) {
    const hex = toHexLower(shown);
    text = hex.replace(/(..)(?=.)/g, '$1 ');
    if (span !== null) tint = { start: span.start * 3, end: span.end * 3 - 1 };
  } else {
    text = decodeLossy(shown);
    if (truncated) {
      // Cut back to the last whole character.
      const trimmed = new TextDecoder('utf-8', { fatal: false }).decode(shown);
      text = trimmed.endsWith('\uFFFD') ? trimmed.slice(0, -1) : trimmed;
    }
    if (span !== null) {
      tint = {
        start: decodeLossy(bytes.subarray(0, span.start)).length,
        end: decodeLossy(bytes.subarray(0, span.end)).length,
      };
    }
  }
  const status = byteLineStatus(bytes.length, countLines(bytes));
  return { text, notices, status, tint };
}

export interface SpanWalk {
  chips: Map<number, string>;
  lostAt: number | null;
  finalRange: SpanRange | null;
  lastStep: number | null;
}

/** Walks a selected byte range through the executed steps, collecting each step's chip. */
export function walkSpan(
  steps: readonly RecipeStep[],
  result: BakeResult,
  inputLength: number,
  range: SpanRange,
  limit: number | null,
): SpanWalk {
  const chips = new Map<number, string>();
  const lengths = new Map(result.stepLengths.map((entry) => [entry.stepIndex, entry.outputLength]));
  let current: SpanRange | null = range;
  let inLength = inputLength;
  let lostAt: number | null = null;
  let lastStep: number | null = null;
  for (const index of enabledIndices(steps)) {
    if (limit !== null && index >= limit) return { chips, lostAt, finalRange: null, lastStep };
    const outLength = lengths.get(index);
    if (outLength === undefined) return { chips, lostAt, finalRange: null, lastStep };
    const step = steps[index]!;
    const op = findOperation(step.op)!;
    current = carrySpan(op, normalizeArgs(op, step.args), current!, inLength, outLength);
    if (current === null) {
      chips.set(index, 'span lost');
      lostAt = index;
      return { chips, lostAt, finalRange: null, lastStep: index };
    }
    chips.set(index, `output ${current.start}\u2013${current.end - 1}`);
    inLength = outLength;
    lastStep = index;
  }
  return { chips, lostAt, finalRange: current, lastStep };
}

/** The Input pane's suggestion rules, checked over the first 4096 bytes. */
export function suggestOperation(bytes: Uint8Array): string | null {
  const head = bytes.subarray(0, 4096);
  if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) return 'Gunzip';
  const text = decodeLossy(head);
  if (/^[0-9a-fA-F]{2}([ ,:\n]?[0-9a-fA-F]{2})*$/.test(text.trim()) && text.trim().replace(/[^0-9a-fA-F]/g, '').length >= 8) {
    return 'From Hex';
  }
  const compact = text.trim();
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(compact) && compact.length % 4 === 0 && compact.length >= 8) {
    return 'From Base64';
  }
  if (compact.startsWith('{') || compact.startsWith('[')) {
    try {
      parseJson(compact);
      return 'JSON Beautify';
    } catch {
      // Not JSON, so the next rule gets its turn.
    }
  }
  if (/%[0-9a-fA-F]{2}/.test(text)) return 'URL Decode';
  return null;
}

export function errorLine(error: { stepIndex: number; op: string; branch: number | null; message: string }): string {
  const where = error.branch === null ? '' : ` in branch ${error.branch}`;
  return `Operation ${error.stepIndex + 1} (${error.op})${where}: ${error.message}`;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

