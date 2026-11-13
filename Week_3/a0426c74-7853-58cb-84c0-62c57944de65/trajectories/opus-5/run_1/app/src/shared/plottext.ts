import { fmtStored } from './numbers.js';
import {
  BY_LAYER,
  type BlockDef,
  type DimRef,
  type DimensionKind,
  type DrawingModel,
  type Entity,
  type Layer,
  type LayerColour,
  type Lineweight,
  type Linetype,
  handleNumber,
  LAYER_COLOURS,
  LINETYPES,
  LINEWEIGHTS,
} from './model.js';

export const PLOT_TEXT_HEADER = 'plotfold 1';
export const MAX_IMPORT_ERRORS = 20;

export interface ParsedDrawing {
  layers: Layer[];
  blocks: BlockDef[];
  entities: Entity[];
}

export interface ParseOutcome {
  ok: boolean;
  errors: string[];
  parsed: ParsedDrawing;
}

interface Field {
  text: string;
  quoted: boolean;
}

function splitFields(line: string): Field[] {
  const fields: Field[] = [];
  let index = 0;
  while (index < line.length) {
    if (line[index] === ' ') {
      index += 1;
      continue;
    }
    if (line[index] === '"') {
      let text = '';
      index += 1;
      while (index < line.length) {
        if (line[index] === '\\' && line[index + 1] === '"') {
          text += '"';
          index += 2;
          continue;
        }
        if (line[index] === '"') {
          index += 1;
          break;
        }
        text += line[index];
        index += 1;
      }
      fields.push({ text, quoted: true });
      continue;
    }
    let end = index;
    while (end < line.length && line[end] !== ' ') end += 1;
    fields.push({ text: line.slice(index, end), quoted: false });
    index = end;
  }
  return fields;
}

const NUMBER_COUNTS: Record<string, number> = { line: 4, circle: 3, arc: 5, insert: 4, hatch: 2, block: 2 };

function isColour(value: string): value is LayerColour {
  return (LAYER_COLOURS as string[]).includes(value);
}

function isLinetype(value: string): value is Linetype {
  return (LINETYPES as string[]).includes(value);
}

function isLineweight(value: string): value is Lineweight {
  return (LINEWEIGHTS as string[]).includes(value);
}

/** Parse the Plotfold drawing text format, with the published line-numbered errors. */
export function parsePlotText(text: string): ParseOutcome {
  const errors: string[] = [];
  const lines = text.split('\n');
  const layers: Layer[] = [
    { name: '0', colour: 'white', linetype: 'Continuous', lineweight: '0.25', on: true, frozen: false, locked: false },
  ];
  const blocks: BlockDef[] = [];
  const entities: Entity[] = [];
  const handles = new Set<string>();
  let openBlock: { block: BlockDef; line: number } | null = null;
  let lastEntity: Entity | null = null;
  let lastAttachment: 'block' | 'insert' | null = null;

  const reported = new Set<number>();
  const push = (message: string): void => {
    const lineNumber = Number(message.slice(5, message.indexOf(':')));
    if (reported.has(lineNumber)) return;
    reported.add(lineNumber);
    if (errors.length < MAX_IMPORT_ERRORS) errors.push(message);
  };

  const numbersFrom = (fields: Field[], from: number, lineNumber: number, record: string, wanted: number): number[] | null => {
    const raw = fields.slice(from);
    const values: number[] = [];
    let bad = false;
    for (const field of raw) {
      const value = Number(field.text);
      if (field.text.trim() === '' || !Number.isFinite(value)) {
        push(`Line ${lineNumber}: "${field.text}" is not a number`);
        bad = true;
        continue;
      }
      values.push(value);
    }
    if (bad) return null;
    if (values.length !== wanted) {
      push(`Line ${lineNumber}: ${record} needs ${wanted} numbers, got ${values.length}`);
      return null;
    }
    return values;
  };

  const target = (): Entity[] => (openBlock ? openBlock.block.entities : entities);

  const useLayer = (name: string, lineNumber: number): string | null => {
    if (!layers.some((layer) => layer.name === name)) {
      push(`Line ${lineNumber}: layer "${name}" is not defined`);
      return null;
    }
    return name;
  };

  const useHandle = (handle: string, lineNumber: number): string | null => {
    if (handles.has(handle)) {
      push(`Line ${lineNumber}: handle ${handle} is used twice`);
      return null;
    }
    handles.add(handle);
    return handle;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const raw = lines[index];
    if (lineNumber === 1) continue;
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const fields = splitFields(raw);
    const record = fields[0].text;
    switch (record) {
      case 'layer': {
        const name = fields[1]?.text ?? '';
        const colour = fields[2]?.text ?? '';
        const linetype = fields[3]?.text ?? '';
        const lineweight = fields[4]?.text ?? '';
        const layer: Layer = {
          name,
          colour: isColour(colour) ? colour : 'white',
          linetype: isLinetype(linetype) ? linetype : 'Continuous',
          lineweight: isLineweight(lineweight) ? lineweight : '0.25',
          on: (fields[5]?.text ?? 'on') === 'on',
          frozen: (fields[6]?.text ?? 'thawed') === 'frozen',
          locked: (fields[7]?.text ?? 'unlocked') === 'locked',
        };
        const existing = layers.findIndex((candidate) => candidate.name === name);
        if (existing >= 0) layers[existing] = layer;
        else layers.push(layer);
        lastAttachment = null;
        break;
      }
      case 'line':
      case 'circle':
      case 'arc':
      case 'hatch': {
        const handle = fields[1]?.text ?? '';
        const layerName = fields[2]?.text ?? '';
        const numbers = numbersFrom(fields, 3, lineNumber, record, NUMBER_COUNTS[record]);
        const checkedLayer = useLayer(layerName, lineNumber);
        const checkedHandle = useHandle(handle, lineNumber);
        if (!numbers || checkedLayer === null || checkedHandle === null) break;
        const common = { handle, layer: layerName, colour: BY_LAYER, linetype: BY_LAYER, lineweight: BY_LAYER };
        if (record === 'line') {
          target().push({ ...common, type: 'line', x1: numbers[0], y1: numbers[1], x2: numbers[2], y2: numbers[3] });
        } else if (record === 'circle') {
          target().push({ ...common, type: 'circle', cx: numbers[0], cy: numbers[1], r: numbers[2] });
        } else if (record === 'arc') {
          target().push({
            ...common,
            type: 'arc',
            cx: numbers[0],
            cy: numbers[1],
            r: numbers[2],
            start: numbers[3],
            end: numbers[4],
          });
        } else {
          target().push({
            ...common,
            type: 'hatch',
            seed_x: numbers[0],
            seed_y: numbers[1],
            boundary: [],
            islands: [],
            area: 0,
            associative: true,
          });
        }
        lastEntity = target()[target().length - 1];
        lastAttachment = null;
        break;
      }
      case 'pline': {
        const handle = fields[1]?.text ?? '';
        const layerName = fields[2]?.text ?? '';
        const closed = (fields[3]?.text ?? 'open') === 'closed';
        const raws = fields.slice(4);
        const values: number[] = [];
        let bad = false;
        for (const field of raws) {
          const value = Number(field.text);
          if (field.text.trim() === '' || !Number.isFinite(value)) {
            push(`Line ${lineNumber}: "${field.text}" is not a number`);
            bad = true;
            continue;
          }
          values.push(value);
        }
        const checkedLayer = useLayer(layerName, lineNumber);
        const checkedHandle = useHandle(handle, lineNumber);
        if (values.length < 4 || values.length % 2 !== 0) {
          push(`Line ${lineNumber}: pline needs an even count of at least 4 numbers, got ${values.length}`);
          break;
        }
        if (bad || checkedLayer === null || checkedHandle === null) break;
        const points: [number, number][] = [];
        for (let position = 0; position + 1 < values.length; position += 2) {
          points.push([values[position], values[position + 1]]);
        }
        target().push({
          handle,
          layer: layerName,
          colour: BY_LAYER,
          linetype: BY_LAYER,
          lineweight: BY_LAYER,
          type: 'pline',
          points,
          closed,
        });
        lastEntity = target()[target().length - 1];
        lastAttachment = null;
        break;
      }
      case 'insert': {
        const handle = fields[1]?.text ?? '';
        const layerName = fields[2]?.text ?? '';
        const blockName = fields[3]?.text ?? '';
        const numbers = numbersFrom(fields, 4, lineNumber, record, NUMBER_COUNTS.insert);
        const checkedLayer = useLayer(layerName, lineNumber);
        const checkedHandle = useHandle(handle, lineNumber);
        const blockKnown = blocks.some((block) => block.name === blockName) || openBlock?.block.name === blockName;
        if (!blockKnown) push(`Line ${lineNumber}: block "${blockName}" is not defined`);
        if (!numbers || checkedLayer === null || checkedHandle === null || !blockKnown) break;
        target().push({
          handle,
          layer: layerName,
          colour: BY_LAYER,
          linetype: BY_LAYER,
          lineweight: BY_LAYER,
          type: 'insert',
          block: blockName,
          x: numbers[0],
          y: numbers[1],
          scale: numbers[2],
          rotation: numbers[3],
          attributes: {},
        });
        lastEntity = target()[target().length - 1];
        lastAttachment = 'insert';
        break;
      }
      case 'dim': {
        const handle = fields[1]?.text ?? '';
        const layerName = fields[2]?.text ?? '';
        const kind = (fields[3]?.text ?? 'linear') as DimensionKind;
        const style = fields[4]?.text ?? 'Standard';
        const refs: DimRef[] = [];
        for (const field of fields.slice(5)) {
          const [refHandle, point] = field.text.split(':');
          refs.push({ handle: refHandle, point: (point as DimRef['point']) ?? null });
        }
        const checkedLayer = useLayer(layerName, lineNumber);
        const checkedHandle = useHandle(handle, lineNumber);
        if (checkedLayer === null || checkedHandle === null) break;
        target().push({
          handle,
          layer: layerName,
          colour: BY_LAYER,
          linetype: BY_LAYER,
          lineweight: BY_LAYER,
          type: 'dimension',
          kind,
          style,
          refs,
          points: [],
          override: null,
          text_x: 0,
          text_y: 0,
          value: 0,
          associative: true,
        });
        lastEntity = target()[target().length - 1];
        lastAttachment = null;
        break;
      }
      case 'block': {
        const name = fields[1]?.text ?? '';
        const numbers = numbersFrom(fields, 2, lineNumber, record, NUMBER_COUNTS.block);
        if (!numbers) break;
        const block: BlockDef = { name, base: [numbers[0], numbers[1]], entities: [], attributes: [] };
        blocks.push(block);
        openBlock = { block, line: lineNumber };
        lastAttachment = 'block';
        lastEntity = null;
        break;
      }
      case 'end': {
        if (!openBlock) {
          push(`Line ${lineNumber}: end has no block`);
          break;
        }
        openBlock = null;
        lastAttachment = null;
        break;
      }
      case 'attr': {
        const tag = fields[1]?.text ?? '';
        const value = fields[2]?.text ?? '';
        if (lastAttachment === 'insert' && lastEntity && lastEntity.type === 'insert') {
          lastEntity.attributes[tag] = value;
        } else if (openBlock) {
          openBlock.block.attributes.push({ tag, default: value });
        } else {
          push(`Line ${lineNumber}: attr has nothing to attach to`);
        }
        break;
      }
      default:
        push(`Line ${lineNumber}: unknown record "${record}"`);
        break;
    }
  }

  if (openBlock) push(`Line ${openBlock.line}: block "${openBlock.block.name}" has no end`);

  errors.sort((a, b) => {
    const left = Number(a.slice(5, a.indexOf(':')));
    const right = Number(b.slice(5, b.indexOf(':')));
    return left - right;
  });

  return { ok: errors.length === 0, errors: errors.slice(0, MAX_IMPORT_ERRORS), parsed: { layers, blocks, entities } };
}

function quote(text: string): string {
  return `"${text.replace(/"/g, '\\"')}"`;
}

function layerRecord(layer: Layer): string {
  return [
    'layer',
    quote(layer.name),
    layer.colour,
    layer.linetype,
    layer.lineweight,
    layer.on ? 'on' : 'off',
    layer.frozen ? 'frozen' : 'thawed',
    layer.locked ? 'locked' : 'unlocked',
  ].join(' ');
}

function refText(ref: DimRef): string {
  return ref.point ? `${ref.handle}:${ref.point}` : ref.handle;
}

function entityRecords(entity: Entity): string[] {
  const head = `${entity.handle} ${quote(entity.layer)}`;
  switch (entity.type) {
    case 'line':
      return [`line ${head} ${fmtStored(entity.x1)} ${fmtStored(entity.y1)} ${fmtStored(entity.x2)} ${fmtStored(entity.y2)}`];
    case 'circle':
      return [`circle ${head} ${fmtStored(entity.cx)} ${fmtStored(entity.cy)} ${fmtStored(entity.r)}`];
    case 'arc':
      return [
        `arc ${head} ${fmtStored(entity.cx)} ${fmtStored(entity.cy)} ${fmtStored(entity.r)} ${fmtStored(entity.start)} ${fmtStored(entity.end)}`,
      ];
    case 'pline': {
      const numbers = entity.points.map(([x, y]) => `${fmtStored(x)} ${fmtStored(y)}`).join(' ');
      return [`pline ${head} ${entity.closed ? 'closed' : 'open'} ${numbers}`];
    }
    case 'insert': {
      const lines = [
        `insert ${head} ${quote(entity.block)} ${fmtStored(entity.x)} ${fmtStored(entity.y)} ${fmtStored(entity.scale)} ${fmtStored(entity.rotation)}`,
      ];
      for (const tag of Object.keys(entity.attributes).sort()) {
        lines.push(`attr ${tag} ${quote(entity.attributes[tag])}`);
      }
      return lines;
    }
    case 'hatch':
      return [`hatch ${head} ${fmtStored(entity.seed_x)} ${fmtStored(entity.seed_y)}`];
    case 'dimension':
      return [`dim ${head} ${entity.kind} ${quote(entity.style)} ${entity.refs.map(refText).join(' ')}`];
  }
}

/** The canonical Plotfold text for a drawing. */
export function toPlotText(model: DrawingModel): string {
  const lines: string[] = [PLOT_TEXT_HEADER];
  for (const layer of [...model.layers].filter((candidate) => candidate.name !== '0').sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(layerRecord(layer));
  }
  for (const block of [...model.blocks].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`block ${quote(block.name)} ${fmtStored(block.base[0])} ${fmtStored(block.base[1])}`);
    for (const entity of [...block.entities].sort((a, b) => handleNumber(a.handle) - handleNumber(b.handle))) {
      lines.push(...entityRecords(entity));
    }
    for (const attribute of [...block.attributes].sort((a, b) => a.tag.localeCompare(b.tag))) {
      lines.push(`attr ${attribute.tag} ${quote(attribute.default)}`);
    }
    lines.push('end');
  }
  for (const entity of [...model.entities].sort((a, b) => handleNumber(a.handle) - handleNumber(b.handle))) {
    lines.push(...entityRecords(entity));
  }
  return `${lines.join('\n')}\n`;
}
