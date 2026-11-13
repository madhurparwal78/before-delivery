// The Plotfold drawing text format: parse (with the published line errors), preview, canonical serialization.
import type { BlockAttribute, DimensionEntity, DimensionKind, DimRef, DrawingState, Entity, Layer, Point } from '../types.ts';
import { COLOURS, DIMENSION_KINDS, LINETYPES, LINEWEIGHTS } from '../types.ts';
import { fmtData, handleNumber, STANDARD_DIM_STYLE } from '../geometry/index.ts';
import type { ImportPreview, ParsedBlock, ParsedDrawing, ParseResult, SeedEntity } from './index.ts';
import { freeName, ZERO_LAYER } from './names.ts';

const HEADER = 'plotfold 1';
const MAX_ERRORS = 20;

export function isPlotfoldText(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return false;
  }
  if (text.includes('\0')) return false;
  const end = text.indexOf('\n');
  return (end < 0 ? text : text.slice(0, end)) === HEADER;
}

// ---------------------------------------------------------------- parse

interface Token { text: string; quoted: boolean }

function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === ' ') {
      i += 1;
    } else if (line[i] === '"') {
      let text = '';
      i += 1;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === '\\' && line[i + 1] === '"') i += 1;
        text += line[i];
        i += 1;
      }
      i += 1;
      tokens.push({ text, quoted: true });
    } else {
      const start = i;
      while (i < line.length && line[i] !== ' ') i += 1;
      tokens.push({ text: line.slice(start, i), quoted: false });
    }
  }
  return tokens;
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const asNumber = (token: Token): number | null => (!token.quoted && NUMBER.test(token.text) ? Number(token.text) : null);

type AttachTarget = { kind: 'block'; attributes: BlockAttribute[] } | { kind: 'insert'; attributes: Record<string, string> };

class Parser {
  private readonly errors = new Map<number, string>();
  private readonly layers: Layer[] = [];
  private readonly layerNames = new Set<string>([ZERO_LAYER]);
  private readonly blocks: ParsedBlock[] = [];
  private readonly blockNames = new Set<string>();
  private readonly entities: SeedEntity[] = [];
  private readonly handles = new Set<string>();
  private open: { block: ParsedBlock; line: number } | null = null;
  private target: AttachTarget | null = null;

  parse(text: string): ParseResult {
    const lines = text.split('\n');
    for (let i = 1; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (trimmed !== '' && !trimmed.startsWith('#')) this.record(i + 1, tokenize(lines[i]));
    }
    if (this.open) this.fail(this.open.line, `block "${this.open.block.name}" has no end`);
    if (this.errors.size > 0) {
      const sorted = [...this.errors].sort((a, b) => a[0] - b[0]);
      return { ok: false, errors: sorted.slice(0, MAX_ERRORS).map(([line, message]) => `Line ${line}: ${message}`) };
    }
    return { ok: true, drawing: { layers: this.layers, blocks: this.blocks, entities: this.entities } };
  }

  private fail(line: number, message: string): void {
    if (!this.errors.has(line)) this.errors.set(line, message);
  }

  private record(line: number, tokens: Token[]): void {
    const [word, ...fields] = tokens;
    const previous = this.target;
    this.target = null;
    switch (word.text) {
      case 'layer': this.layerRecord(line, fields); break;
      case 'line': this.entityRecord(line, word.text, fields, 4); break;
      case 'circle': this.entityRecord(line, word.text, fields, 3); break;
      case 'arc': this.entityRecord(line, word.text, fields, 5); break;
      case 'pline': this.plineRecord(line, fields); break;
      case 'insert': this.insertRecord(line, fields); break;
      case 'dim': this.dimRecord(line, fields); break;
      case 'hatch': this.entityRecord(line, word.text, fields, 2); break;
      case 'block': this.blockRecord(line, fields); break;
      case 'end': this.endRecord(line); break;
      case 'attr': this.attrRecord(line, fields, previous); break;
      default: this.fail(line, `unknown record "${word.text}"`);
    }
  }

  private layerRecord(line: number, fields: Token[]): void {
    const [name = { text: '', quoted: true }, colour, linetype, lineweight, on, frozen, locked] = fields;
    const weight = lineweight ? this.numbersOf(line, [lineweight])?.[0] : 0.25;
    if (weight === undefined) return;
    const known = <T extends string>(token: Token | undefined, list: readonly T[], fallback: T): T =>
      list.find((value) => value === token?.text) ?? fallback;
    const nearest = LINEWEIGHTS.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best));
    this.layerNames.add(name.text);
    this.layers.push({
      name: name.text, colour: known(colour, COLOURS, 'white'), linetype: known(linetype, LINETYPES, 'Continuous'),
      lineweight: nearest, on: on?.text !== 'off', frozen: frozen?.text === 'frozen', locked: locked?.text === 'locked',
    });
  }

  /** Checks shared by every entity record: numbers, then layer, then handle. Returns the numbers when the record is valid. */
  private check(line: number, record: string, handle: Token, layer: Token, numbers: Token[], expected: number | 'pline'): number[] | null {
    if (expected === 'pline' ? numbers.length < 4 || numbers.length % 2 === 1 : numbers.length !== expected) {
      this.fail(line, expected === 'pline'
        ? `pline needs an even count of at least 4 numbers, got ${numbers.length}`
        : `${record} needs ${expected} numbers, got ${numbers.length}`);
      return null;
    }
    const values = this.numbersOf(line, numbers);
    if (values === null) return null;
    if (!this.layerNames.has(layer.text)) {
      this.fail(line, `layer "${layer.text}" is not defined`);
      return null;
    }
    return this.claim(line, handle.text) ? values : null;
  }

  /** The numbers of the tokens, or null after reporting the first one that is not a number. */
  private numbersOf(line: number, tokens: Token[]): number[] | null {
    const values: number[] = [];
    for (const token of tokens) {
      const value = asNumber(token);
      if (value === null) {
        this.fail(line, `"${token.text}" is not a number`);
        return null;
      }
      values.push(value);
    }
    return values;
  }

  private claim(line: number, handle: string): boolean {
    if (this.handles.has(handle)) {
      this.fail(line, `handle ${handle} is used twice`);
      return false;
    }
    this.handles.add(handle);
    return true;
  }

  private add(entity: SeedEntity): void {
    (this.open ? this.open.block.entities : this.entities).push(entity);
  }

  private entityRecord(line: number, record: 'line' | 'circle' | 'arc' | 'hatch', fields: Token[], count: number): void {
    const [handle = { text: '', quoted: false }, layer = { text: '', quoted: false }, ...numbers] = fields;
    const n = this.check(line, record, handle, layer, numbers, count);
    if (n === null) return;
    const common = { handle: handle.text, layer: layer.text };
    switch (record) {
      case 'line': this.add({ ...common, type: 'line', x1: n[0], y1: n[1], x2: n[2], y2: n[3] }); break;
      case 'circle': this.add({ ...common, type: 'circle', cx: n[0], cy: n[1], r: n[2] }); break;
      case 'arc': this.add({ ...common, type: 'arc', cx: n[0], cy: n[1], r: n[2], start: n[3], end: n[4] }); break;
      case 'hatch': this.add({ ...common, type: 'hatch', seed_x: n[0], seed_y: n[1] }); break;
    }
  }

  private plineRecord(line: number, fields: Token[]): void {
    const [handle = { text: '', quoted: false }, layer = { text: '', quoted: false }, state, ...numbers] = fields;
    const n = this.check(line, 'pline', handle, layer, numbers, 'pline');
    if (n === null) return;
    const points: Point[] = [];
    for (let i = 0; i < n.length; i += 2) points.push([n[i], n[i + 1]]);
    this.add({ handle: handle.text, layer: layer.text, type: 'pline', points, closed: state.text === 'closed' });
  }

  private insertRecord(line: number, fields: Token[]): void {
    const [handle = { text: '', quoted: false }, layer = { text: '', quoted: false }, block = { text: '', quoted: true }, ...numbers] = fields;
    const n = this.check(line, 'insert', handle, layer, numbers, 4);
    if (n === null) return;
    if (!this.blockNames.has(block.text)) {
      this.fail(line, `block "${block.text}" is not defined`);
      return;
    }
    const attributes: Record<string, string> = {};
    this.add({
      handle: handle.text, layer: layer.text, type: 'insert', block: block.text,
      x: n[0], y: n[1], scale: n[2], rotation: n[3], attributes,
    });
    this.target = { kind: 'insert', attributes };
  }

  private dimRecord(line: number, fields: Token[]): void {
    const [handle = { text: '', quoted: false }, layer = { text: '', quoted: false }, kind, style, ...refs] = fields;
    if (!this.layerNames.has(layer.text)) {
      this.fail(line, `layer "${layer.text}" is not defined`);
      return;
    }
    if (!this.claim(line, handle.text)) return;
    const entity: Omit<DimensionEntity, 'value' | 'associative'> = {
      handle: handle.text, layer: layer.text, type: 'dimension',
      kind: DIMENSION_KINDS.find((k): k is DimensionKind => k === kind?.text) ?? 'linear', style: style?.text ?? STANDARD_DIM_STYLE.name,
      refs: refs.map(parseRef), override: null, text_x: 0, text_y: 0,
    };
    this.add(entity);
  }

  private blockRecord(line: number, fields: Token[]): void {
    if (this.open) this.fail(this.open.line, `block "${this.open.block.name}" has no end`);
    const [name = { text: '', quoted: true }, ...numbers] = fields;
    const block: ParsedBlock = { name: name.text, base: [0, 0], entities: [], attributes: [] };
    this.open = { block, line };
    this.target = { kind: 'block', attributes: block.attributes };
    if (numbers.length !== 2) {
      this.fail(line, `block needs 2 numbers, got ${numbers.length}`);
      return;
    }
    const base = this.numbersOf(line, numbers);
    if (base !== null) block.base = [base[0], base[1]];
  }

  private endRecord(line: number): void {
    if (!this.open) {
      this.fail(line, 'end has no block');
      return;
    }
    this.blocks.push(this.open.block);
    this.blockNames.add(this.open.block.name);
    this.open = null;
  }

  /** An attr belongs to the insert or block record just before it; inside a block, one after any other record is still the block's. */
  private attrRecord(line: number, fields: Token[], previous: AttachTarget | null): void {
    const holder: AttachTarget | null = previous ?? (this.open ? { kind: 'block', attributes: this.open.block.attributes } : null);
    if (!holder) {
      this.fail(line, 'attr has nothing to attach to');
      return;
    }
    const [tag = { text: '', quoted: false }, value = { text: '', quoted: true }] = fields;
    if (holder.kind === 'block') holder.attributes.push({ tag: tag.text, default: value.text });
    else holder.attributes[tag.text] = value.text;
    this.target = holder;
  }
}

function parseRef(token: Token): DimRef {
  const colon = token.text.indexOf(':');
  if (colon < 0) return { handle: token.text, point: null };
  const point = token.text.slice(colon + 1);
  return { handle: token.text.slice(0, colon), point: point === 'start' || point === 'end' || point === 'centre' ? point : null };
}

export function parsePlotfold(text: string): ParseResult {
  return new Parser().parse(text);
}

// ---------------------------------------------------------------- preview

/** The names the merge gives to the imported layers and blocks: a taken name becomes `<name> (k)` with the lowest free k from 2. */
export function mergeNames(existing: Pick<DrawingState, 'layers' | 'blocks'>, drawing: ParsedDrawing): { layers: Map<string, string>; blocks: Map<string, string> } {
  const layers = new Map<string, string>();
  for (const layer of drawing.layers) {
    if (layer.name === ZERO_LAYER) continue;
    const name = freeName(layer.name, (candidate) => existing.layers[candidate] !== undefined || [...layers.values()].includes(candidate));
    layers.set(layer.name, name);
  }
  const blocks = new Map<string, string>();
  for (const block of drawing.blocks) {
    const name = freeName(block.name, (candidate) => existing.blocks[candidate] !== undefined || [...blocks.values()].includes(candidate));
    blocks.set(block.name, name);
  }
  return { layers, blocks };
}

export function previewImport(state: DrawingState, drawing: ParsedDrawing): ImportPreview {
  const names = mergeNames(state, drawing);
  const renames = [...names.layers, ...names.blocks].filter(([from, to]) => from !== to).map(([from, to]) => ({ from, to }));
  return { adds: { entities: drawing.entities.length, layers: names.layers.size, blocks: names.blocks.size }, renames };
}

// ---------------------------------------------------------------- canonical form

const quote = (text: string): string => `"${text.replaceAll('"', '\\"')}"`;
const numbers = (values: number[]): string => values.map(fmtData).join(' ');
const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byHandle = (a: { handle: string }, b: { handle: string }): number => handleNumber(a.handle) - handleNumber(b.handle);

function layerRecord(layer: Layer): string {
  return `layer ${quote(layer.name)} ${layer.colour} ${layer.linetype} ${fmtData(layer.lineweight)} ${layer.on ? 'on' : 'off'} ${layer.frozen ? 'frozen' : 'thawed'} ${layer.locked ? 'locked' : 'unlocked'}`;
}

const refText = (ref: DimRef): string => (ref.point ? `${ref.handle}:${ref.point}` : ref.handle);

function entityLines(entity: Entity): string[] {
  const head = `${entity.handle} ${quote(entity.layer)}`;
  switch (entity.type) {
    case 'line': return [`line ${head} ${numbers([entity.x1, entity.y1, entity.x2, entity.y2])}`];
    case 'circle': return [`circle ${head} ${numbers([entity.cx, entity.cy, entity.r])}`];
    case 'arc': return [`arc ${head} ${numbers([entity.cx, entity.cy, entity.r, entity.start, entity.end])}`];
    case 'pline': return [`pline ${head} ${entity.closed ? 'closed' : 'open'} ${numbers(entity.points.flat())}`];
    case 'hatch': return [`hatch ${head} ${numbers([entity.seed_x, entity.seed_y])}`];
    case 'dimension': return [`dim ${head} ${entity.kind} ${quote(entity.style)} ${entity.refs.map(refText).join(' ')}`];
    case 'insert': {
      const attrs = Object.keys(entity.attributes).sort(byName).map((tag) => `attr ${tag} ${quote(entity.attributes[tag])}`);
      return [`insert ${head} ${quote(entity.block)} ${numbers([entity.x, entity.y, entity.scale, entity.rotation])}`, ...attrs];
    }
  }
}

export function serializeCanonical(state: DrawingState): string {
  const lines = [HEADER];
  for (const name of Object.keys(state.layers).sort(byName)) {
    if (name !== ZERO_LAYER) lines.push(layerRecord(state.layers[name]));
  }
  for (const name of Object.keys(state.blocks).sort(byName)) {
    const block = state.blocks[name];
    lines.push(`block ${quote(block.name)} ${numbers(block.base)}`);
    for (const attribute of [...block.attributes].sort((a, b) => byName(a.tag, b.tag))) lines.push(`attr ${attribute.tag} ${quote(attribute.default)}`);
    for (const entity of [...block.entities].sort(byHandle)) lines.push(...entityLines(entity));
    lines.push('end');
  }
  for (const entity of Object.values(state.entities).sort(byHandle)) lines.push(...entityLines(entity));
  return `${lines.join('\n')}\n`;
}
