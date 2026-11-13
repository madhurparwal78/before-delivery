import type { Entity, Pt } from './geometry.js';
import { LINETYPES, LAYER_COLOURS, LINEWEIGHTS } from './geometry.js';
import { numberKey, round6 } from './num.js';

// ---------------------------------------------------------------------------
// Plotfold drawing text format: parse, serialise and merge planning.
// ---------------------------------------------------------------------------

export interface ParsedLayer {
  name: string;
  colour: string;
  linetype: string;
  lineweight: number;
  on: boolean;
  frozen: boolean;
  locked: boolean;
}

export interface ParsedBlock {
  name: string;
  base: Pt;
  entities: Entity[];
  attributes: Array<{ tag: string; default: string }>;
}

export interface ParsedFile {
  header: string;
  layers: ParsedLayer[];
  entities: Entity[];
  blocks: ParsedBlock[];
}

export const FORMAT_HEADER = 'plotfold 1';
export const MAX_PARSE_ERRORS = 20;

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

function isNumber(text: string): boolean {
  return NUMBER.test(text.trim());
}

// Splits a record into bare words and quoted names, keeping quoted form.
function tokenize(line: string): string[] | null {
  const tokens: string[] = [];
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (i >= line.length) break;
    if (line[i] === '"') {
      let j = i + 1;
      let value = '';
      while (j < line.length) {
        if (line[j] === '\\' && line[j + 1] === '"') {
          value += '"';
          j += 2;
          continue;
        }
        if (line[j] === '"') break;
        value += line[j];
        j++;
      }
      if (j >= line.length) return null;
      tokens.push(value);
      i = j + 1;
    } else {
      let j = i;
      while (j < line.length && !/\s/.test(line[j])) j++;
      tokens.push(line.slice(i, j));
      i = j;
    }
  }
  return tokens;
}

export interface ParseOutcome {
  parsed: ParsedFile | null;
  errors: string[];
}

export function parsePlotfold(text: string): ParseOutcome {
  const errors: string[] = [];
  const lines = text.split('\n');
  let headerSeen = false;
  const layers = new Map<string, ParsedLayer>();
  const blocks = new Map<string, ParsedBlock>();
  const handles = new Set<string>();
  const entities: Entity[] = [];
  let openBlock: { name: string; line: number; base: Pt; entities: Entity[]; attributes: Array<{ tag: string; default: string }> } | null = null;
  let lastInsert: Extract<Entity, { type: 'insert' }> | null = null;
  const push = (error: string) => {
    if (errors.length < MAX_PARSE_ERRORS) errors.push(error);
  };
  const numberList = (tokens: string[], offset: number, count: number): number[] | null => {
    const slice = tokens.slice(offset, offset + count);
    if (slice.length !== count || slice.some((t) => !isNumber(t))) return null;
    return slice.map((t) => round6(Number(t)));
  };
  const firstBadNumber = (tokens: string[], offset: number): string | null =>
    tokens.slice(offset).find((t) => !isNumber(t)) ?? null;

  for (let index = 0; index < lines.length && errors.length < MAX_PARSE_ERRORS; index++) {
    const rawLine = lines[index];
    const lineNo = index + 1;
    const trimmed = rawLine.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (!headerSeen) {
      if (trimmed !== FORMAT_HEADER) {
        push(`Line ${lineNo}: unknown record "${trimmed.split(/\s+/)[0] ?? ''}"`);
        continue;
      }
      headerSeen = true;
      continue;
    }
    const tokens = tokenize(trimmed);
    if (!tokens) {
      push(`Line ${lineNo}: unknown record "${trimmed.split(/\s+/)[0] ?? ''}"`);
      continue;
    }
    const word = tokens[0];
    const target = openBlock ? openBlock.entities : entities;
    const claim = (handle: string): boolean => {
      if (handles.has(handle)) {
        push(`Line ${lineNo}: handle ${handle} is used twice`);
        return false;
      }
      handles.add(handle);
      return true;
    };
    const needLayer = (name: string): boolean => {
      if (layers.has(name) || name === '0') return true;
      push(`Line ${lineNo}: layer "${name}" is not defined`);
      return false;
    };

    switch (word) {
      case 'layer': {
        const name = tokens[1] ?? '';
        const shapeOk = name !== null
          && tokens.length === 8
          && (LAYER_COLOURS as readonly string[]).includes(tokens[2])
          && (LINETYPES as readonly string[]).includes(tokens[3])
          && isNumber(tokens[4])
          && (LINEWEIGHTS as readonly number[]).includes(Number(tokens[4]))
          && (tokens[5] === 'on' || tokens[5] === 'off')
          && (tokens[6] === 'thawed' || tokens[6] === 'frozen')
          && (tokens[7] === 'unlocked' || tokens[7] === 'locked');
        if (!shapeOk) {
          push(`Line ${lineNo}: layer needs 2 numbers, got ${Math.max(0, tokens.length - 6)}`);
          break;
        }
        layers.set(name, {
          name,
          colour: tokens[2],
          linetype: tokens[3],
          lineweight: Number(tokens[4]),
          on: tokens[5] === 'on',
          frozen: tokens[6] === 'frozen',
          locked: tokens[7] === 'locked',
        });
        break;
      }
      case 'line': {
        const layer = tokens[2] ?? '';
        const values = numberList(tokens, 3, 4);
        if (layer === '' || values === null) {
          const bad = firstBadNumber(tokens, 3);
          push(bad !== null ? `Line ${lineNo}: "${bad}" is not a number` : `Line ${lineNo}: line needs 4 numbers, got ${Math.max(0, tokens.length - 3)}`);
          break;
        }
        if (!needLayer(layer)) break;
        if (!claim(tokens[1])) break;
        target.push({ type: 'line', handle: tokens[1], layer, x1: values[0], y1: values[1], x2: values[2], y2: values[3] });
        break;
      }
      case 'circle': {
        const layer = tokens[2] ?? '';
        const values = numberList(tokens, 3, 3);
        if (layer === '' || values === null) {
          const bad = firstBadNumber(tokens, 3);
          push(bad !== null ? `Line ${lineNo}: "${bad}" is not a number` : `Line ${lineNo}: circle needs 3 numbers, got ${Math.max(0, tokens.length - 3)}`);
          break;
        }
        if (!needLayer(layer)) break;
        if (!claim(tokens[1])) break;
        target.push({ type: 'circle', handle: tokens[1], layer, cx: values[0], cy: values[1], r: values[2] });
        break;
      }
      case 'arc': {
        const layer = tokens[2] ?? '';
        const values = numberList(tokens, 3, 5);
        if (layer === '' || values === null) {
          const bad = firstBadNumber(tokens, 3);
          push(bad !== null ? `Line ${lineNo}: "${bad}" is not a number` : `Line ${lineNo}: arc needs 5 numbers, got ${Math.max(0, tokens.length - 3)}`);
          break;
        }
        if (!needLayer(layer)) break;
        if (!claim(tokens[1])) break;
        target.push({ type: 'arc', handle: tokens[1], layer, cx: values[0], cy: values[1], r: values[2], start: values[3], end: values[4] });
        break;
      }
      case 'pline': {
        const layer = tokens[2] ?? '';
        if (layer === undefined || (tokens[3] !== 'open' && tokens[3] !== 'closed')) {
          push(`Line ${lineNo}: unknown record "pline"`);
          break;
        }
        const rest = tokens.slice(4);
        if (rest.length < 4 || rest.length % 2 !== 0) {
          push(`Line ${lineNo}: pline needs an even count of at least 4 numbers, got ${rest.length}`);
          break;
        }
        const bad = rest.find((t) => !isNumber(t));
        if (bad !== undefined) {
          push(`Line ${lineNo}: "${bad}" is not a number`);
          break;
        }
        if (!needLayer(layer)) break;
        if (!claim(tokens[1])) break;
        const points: Pt[] = [];
        for (let i = 0; i < rest.length; i += 2) points.push({ x: round6(Number(rest[i])), y: round6(Number(rest[i + 1])) });
        target.push({ type: 'pline', handle: tokens[1], layer, points, closed: tokens[3] === 'closed' });
        break;
      }
      case 'block': {
        const name = tokens[1] ?? '';
        const values = numberList(tokens, 2, 2);
        if (name === '' || values === null) {
          const bad = firstBadNumber(tokens, 2);
          push(bad !== null ? `Line ${lineNo}: "${bad}" is not a number` : `Line ${lineNo}: block needs 2 numbers, got ${Math.max(0, tokens.length - 2)}`);
          break;
        }
        if (openBlock) push(`Line ${openBlock.line}: block "${openBlock.name}" has no end`);
        openBlock = { name, line: lineNo, base: { x: values[0], y: values[1] }, entities: [], attributes: [] };
        break;
      }
      case 'end': {
        if (!openBlock) {
          push(`Line ${lineNo}: end has no block`);
          break;
        }
        blocks.set(openBlock.name, { name: openBlock.name, base: openBlock.base, entities: openBlock.entities, attributes: openBlock.attributes });
        openBlock = null;
        break;
      }
      case 'insert': {
        const layer = tokens[2] ?? '';
        const block = tokens[3] ?? '';
        const values = numberList(tokens, 4, 4);
        if (layer === '' || block === '' || values === null) {
          const bad = firstBadNumber(tokens, 4);
          push(bad !== null ? `Line ${lineNo}: "${bad}" is not a number` : `Line ${lineNo}: insert needs 4 numbers, got ${Math.max(0, tokens.length - 4)}`);
          break;
        }
        if (!needLayer(layer)) break;
        if (!blocks.has(block)) {
          push(`Line ${lineNo}: block "${block}" is not defined`);
          break;
        }
        if (!claim(tokens[1])) break;
        const insert: Extract<Entity, { type: 'insert' }> = {
          type: 'insert',
          handle: tokens[1],
          layer,
          block,
          x: values[0],
          y: values[1],
          scale: values[2],
          rotation: values[3],
          attributes: {},
        };
        target.push(insert);
        lastInsert = insert;
        break;
      }
      case 'attr': {
        const value = tokens[2] ?? '';
        if (value === '') {
          push(`Line ${lineNo}: unknown record "attr"`);
          break;
        }
        if (openBlock) {
          openBlock.attributes.push({ tag: tokens[1], default: value });
        } else if (lastInsert) {
          lastInsert.attributes[tokens[1]] = value;
        } else {
          push(`Line ${lineNo}: attr has nothing to attach to`);
        }
        break;
      }
      case 'dim': {
        const layer = tokens[2] ?? '';
        const kind = tokens[3];
        const style = tokens[4] ?? '';
        if (layer === '' || style === '' || !['linear', 'aligned', 'angular', 'radial'].includes(kind) || tokens.length < 6) {
          push(`Line ${lineNo}: unknown record "dim"`);
          break;
        }
        const refs = tokens.slice(5).map((token) => {
          const [handle, point] = token.split(':');
          if (point === 'end' || point === 'centre') return { handle, point } as const;
          return { handle, point: 'start' as const };
        });
        if (!needLayer(layer)) break;
        if (!claim(tokens[1])) break;
        target.push({ type: 'dimension', handle: tokens[1], layer, kind: kind as 'linear' | 'aligned' | 'angular' | 'radial', style, refs, override: null, text_x: 0, text_y: 0 });
        break;
      }
      case 'hatch': {
        const layer = tokens[2] ?? '';
        const values = numberList(tokens, 3, 2);
        if (layer === '' || values === null) {
          const bad = firstBadNumber(tokens, 3);
          push(bad !== null ? `Line ${lineNo}: "${bad}" is not a number` : `Line ${lineNo}: hatch needs 2 numbers, got ${Math.max(0, tokens.length - 3)}`);
          break;
        }
        if (!needLayer(layer)) break;
        if (!claim(tokens[1])) break;
        target.push({ type: 'hatch', handle: tokens[1], layer, seed_x: values[0], seed_y: values[1] });
        break;
      }
      default:
        push(`Line ${lineNo}: unknown record "${word}"`);
        break;
    }
  }
  if (openBlock && errors.length < MAX_PARSE_ERRORS) {
    push(`Line ${openBlock.line}: block "${openBlock.name}" has no end`);
  }
  if (!headerSeen) {
    return { parsed: null, errors: errors.length ? errors : ['Line 1: unknown record ""'] };
  }
  if (errors.length) return { parsed: null, errors };
  return {
    parsed: {
      header: FORMAT_HEADER,
      layers: [...layers.values()],
      entities,
      blocks: [...blocks.values()],
    },
    errors,
  };
}

const num = (v: number): string => numberKey(v);
const quoted = (text: string): string => `"${text.replace(/"/g, '\\"')}"`;

function entityLine(entity: Entity): string {
  switch (entity.type) {
    case 'line':
      return `line ${entity.handle} ${quoted(entity.layer)} ${num(entity.x1)} ${num(entity.y1)} ${num(entity.x2)} ${num(entity.y2)}`;
    case 'circle':
      return `circle ${entity.handle} ${quoted(entity.layer)} ${num(entity.cx)} ${num(entity.cy)} ${num(entity.r)}`;
    case 'arc':
      return `arc ${entity.handle} ${quoted(entity.layer)} ${num(entity.cx)} ${num(entity.cy)} ${num(entity.r)} ${num(entity.start)} ${num(entity.end)}`;
    case 'pline':
      return `pline ${entity.handle} ${quoted(entity.layer)} ${entity.closed ? 'closed' : 'open'} ${entity.points.map((p) => `${num(p.x)} ${num(p.y)}`).join(' ')}`;
    case 'insert':
      return `insert ${entity.handle} ${quoted(entity.layer)} ${quoted(entity.block)} ${num(entity.x)} ${num(entity.y)} ${num(entity.scale)} ${num(entity.rotation)}`;
    case 'dimension':
      return `dim ${entity.handle} ${quoted(entity.layer)} ${entity.kind} ${quoted(entity.style)} ${entity.refs.map((r) => `${r.handle}:${r.point}`).join(' ')}`;
    case 'hatch':
      return `hatch ${entity.handle} ${quoted(entity.layer)} ${num(entity.seed_x)} ${num(entity.seed_y)}`;
  }
}

const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function serialisePlotfold(model: {
  layers: ParsedLayer[];
  entities: Entity[];
  blocks: ParsedBlock[];
}): string {
  const lines: string[] = [FORMAT_HEADER];
  for (const layer of model.layers.filter((l) => l.name !== '0').sort(byName)) {
    lines.push(`layer ${quoted(layer.name)} ${layer.colour} ${layer.linetype} ${num(layer.lineweight)} ${layer.on ? 'on' : 'off'} ${layer.frozen ? 'frozen' : 'thawed'} ${layer.locked ? 'locked' : 'unlocked'}`);
  }
  for (const block of [...model.blocks].sort(byName)) {
    lines.push(`block ${quoted(block.name)} ${num(block.base.x)} ${num(block.base.y)}`);
    for (const attribute of [...block.attributes].sort((a, b) => (a.tag < b.tag ? -1 : 1))) {
      lines.push(`attr ${attribute.tag} ${quoted(attribute.default)}`);
    }
    for (const entity of block.entities) lines.push(entityLine(entity));
    lines.push('end');
  }
  for (const entity of model.entities) {
    lines.push(entityLine(entity));
    if (entity.type === 'insert') {
      const block = model.blocks.find((b) => b.name === entity.block);
      for (const attribute of block ? [...block.attributes].sort((a, b) => (a.tag < b.tag ? -1 : 1)) : []) {
        lines.push(`attr ${attribute.tag} ${quoted(entity.attributes[attribute.tag] ?? attribute.default)}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

export interface MergePlan {
  layers: ParsedLayer[];
  blocks: ParsedBlock[];
  entities: Entity[];
  renames: Array<{ from: string; to: string }>;
}

export function planMerge(parsed: ParsedFile, existingLayers: string[], existingBlocks: string[]): MergePlan {
  const taken = new Set<string>([...existingLayers, ...existingBlocks]);
  const rename = (name: string): { name: string; renamed: boolean } => {
    if (!taken.has(name)) {
      taken.add(name);
      return { name, renamed: false };
    }
    let k = 2;
    while (taken.has(`${name} (${k})`)) k++;
    const to = `${name} (${k})`;
    taken.add(to);
    return { name: to, renamed: true };
  };
  const layerRename = new Map<string, string>();
  const blockRename = new Map<string, string>();
  const renames: Array<{ from: string; to: string }> = [];
  for (const layer of parsed.layers) {
    const result = rename(layer.name);
    layerRename.set(layer.name, result.name);
    if (result.renamed) renames.push({ from: layer.name, to: result.name });
  }
  for (const block of parsed.blocks) {
    const result = rename(block.name);
    blockRename.set(block.name, result.name);
    if (result.renamed) renames.push({ from: block.name, to: result.name });
  }
  const remap = (entity: Entity): Entity => {
    const layer = layerRename.get(entity.layer) ?? entity.layer;
    return entity.type === 'insert' ? { ...entity, layer, block: blockRename.get(entity.block) ?? entity.block } : { ...entity, layer };
  };
  return {
    layers: parsed.layers.map((layer) => ({ ...layer, name: layerRename.get(layer.name) ?? layer.name })),
    blocks: parsed.blocks.map((block) => ({ ...block, name: blockRename.get(block.name) ?? block.name, entities: block.entities.map(remap) })),
    entities: parsed.entities.map(remap),
    renames,
  };
}
