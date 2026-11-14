import type { Layout, LayoutNode, LayoutSegment } from '../shared/types.js';

export const WRENFIELD: Layout = {
  name: 'Wrenfield',
  code: 'WRN',
  runways: [
    {
      id: '09/27',
      lengthM: 1600,
      thresholds: [
        { id: '09', node: 'R09', heading: 90 },
        { id: '27', node: 'R27', heading: 270 },
      ],
    },
  ],
  nodes: [
    { id: 'R09', kind: 'threshold', x: 100, y: 100 },
    { id: 'R27', kind: 'threshold', x: 900, y: 100 },
    { id: 'A1', kind: 'holding', x: 850, y: 200, serves: '27' },
    { id: 'A6', kind: 'holding', x: 150, y: 200, serves: '09' },
    { id: 'J2', kind: 'junction', x: 650, y: 200 },
    { id: 'J3', kind: 'junction', x: 500, y: 200 },
    { id: 'J4', kind: 'junction', x: 350, y: 200 },
    { id: 'W', kind: 'junction', x: 350, y: 320 },
    { id: 'E', kind: 'junction', x: 650, y: 320 },
    { id: 'S1', kind: 'stand', x: 300, y: 420 },
    { id: 'S2', kind: 'stand', x: 400, y: 420 },
    { id: 'S3', kind: 'stand', x: 600, y: 420 },
    { id: 'S4', kind: 'stand', x: 700, y: 420 },
  ],
  segments: [
    { id: 'A2', from: 'J2', to: 'A1', lengthM: 300, speedMps: 10, taxiway: 'A' },
    { id: 'A3', from: 'J3', to: 'J2', lengthM: 300, speedMps: 10, taxiway: 'A' },
    { id: 'A4', from: 'J4', to: 'J3', lengthM: 300, speedMps: 10, taxiway: 'A' },
    { id: 'A5', from: 'A6', to: 'J4', lengthM: 300, speedMps: 10, taxiway: 'A' },
    { id: 'W1', from: 'W', to: 'J4', lengthM: 200, speedMps: 10, taxiway: 'W' },
    { id: 'E1', from: 'E', to: 'J2', lengthM: 200, speedMps: 10, taxiway: 'E' },
    { id: 'S1T', from: 'S1', to: 'W', lengthM: 100, speedMps: 5, taxiway: 'apron' },
    { id: 'S2T', from: 'S2', to: 'W', lengthM: 100, speedMps: 5, taxiway: 'apron' },
    { id: 'S3T', from: 'S3', to: 'E', lengthM: 100, speedMps: 5, taxiway: 'apron' },
    { id: 'S4T', from: 'S4', to: 'E', lengthM: 100, speedMps: 5, taxiway: 'apron' },
  ],
};

export const KESTREL_DOWN: Layout = {
  name: 'Kestrel Down',
  code: 'KDN',
  runways: [
    {
      id: '09/27',
      lengthM: 1400,
      thresholds: [
        { id: '09', node: 'K09', heading: 90 },
        { id: '27', node: 'K27', heading: 270 },
      ],
    },
  ],
  nodes: [
    { id: 'K09', kind: 'threshold', x: 100, y: 250 },
    { id: 'K27', kind: 'threshold', x: 900, y: 250 },
    { id: 'N1', kind: 'stand', x: 300, y: 50 },
    { id: 'N2', kind: 'stand', x: 700, y: 50 },
    { id: 'NB', kind: 'junction', x: 300, y: 120 },
    { id: 'NC', kind: 'junction', x: 700, y: 120 },
    { id: 'B2', kind: 'holding', x: 300, y: 200, serves: 'cross' },
    { id: 'C2', kind: 'holding', x: 700, y: 200, serves: 'cross' },
    { id: 'B3', kind: 'holding', x: 300, y: 300, serves: 'cross' },
    { id: 'C3', kind: 'holding', x: 700, y: 300, serves: 'cross' },
    { id: 'SB', kind: 'junction', x: 300, y: 380 },
    { id: 'SC', kind: 'junction', x: 700, y: 380 },
    { id: 'D1', kind: 'holding', x: 850, y: 380, serves: '27' },
    { id: 'D6', kind: 'holding', x: 150, y: 380, serves: '09' },
  ],
  segments: [
    { id: 'N1T', from: 'N1', to: 'NB', lengthM: 100, speedMps: 5, taxiway: 'apron' },
    { id: 'N2T', from: 'N2', to: 'NC', lengthM: 100, speedMps: 5, taxiway: 'apron' },
    { id: 'N3', from: 'NB', to: 'NC', lengthM: 400, speedMps: 10, taxiway: 'N' },
    { id: 'B1', from: 'NB', to: 'B2', lengthM: 100, speedMps: 10, taxiway: 'B' },
    { id: 'C1', from: 'NC', to: 'C2', lengthM: 100, speedMps: 10, taxiway: 'C' },
    { id: 'B4', from: 'B3', to: 'SB', lengthM: 100, speedMps: 10, taxiway: 'B' },
    { id: 'C4', from: 'C3', to: 'SC', lengthM: 100, speedMps: 10, taxiway: 'C' },
    { id: 'D2', from: 'SC', to: 'D1', lengthM: 300, speedMps: 10, taxiway: 'D' },
    { id: 'D3', from: 'SB', to: 'SC', lengthM: 400, speedMps: 10, taxiway: 'D' },
    { id: 'D4', from: 'D6', to: 'SB', lengthM: 300, speedMps: 10, taxiway: 'D' },
  ],
};

export const BUILT_IN: { id: string; layout: Layout }[] = [
  { id: 'wrenfield', layout: WRENFIELD },
  { id: 'kestrel-down', layout: KESTREL_DOWN },
];

/** Indexed view of a layout used by routing and the rule engine. */
export class Airfield {
  readonly nodes = new Map<string, LayoutNode>();
  readonly segments = new Map<string, LayoutSegment>();
  readonly crossings = new Map<string, string>();
  readonly thresholdIds: string[];

  constructor(readonly layout: Layout) {
    for (const node of layout.nodes) this.nodes.set(node.id, node);
    for (const segment of layout.segments) this.segments.set(segment.id, segment);
    this.thresholdIds = layout.runways.flatMap((runway) => runway.thresholds.map((t) => t.id));
    const crossPoints = layout.nodes.filter((node) => node.kind === 'holding' && node.serves === 'cross');
    for (const point of crossPoints) {
      let best: LayoutNode | null = null;
      let bestDistance = Infinity;
      for (const other of crossPoints) {
        if (other === point) continue;
        const distance = Math.hypot(other.x - point.x, other.y - point.y);
        if (distance < bestDistance) {
          best = other;
          bestDistance = distance;
        }
      }
      if (best) this.crossings.set(point.id, best.id);
    }
  }

  isHoldingPoint(id: string): boolean {
    return this.nodes.get(id)?.kind === 'holding';
  }

  isThreshold(id: string): boolean {
    return this.thresholdIds.includes(id);
  }

  servesThreshold(pointId: string): string | null {
    const serves = this.nodes.get(pointId)?.serves;
    return serves && serves !== 'cross' ? serves : null;
  }

  thresholdNode(thresholdId: string): string | null {
    for (const runway of this.layout.runways) {
      for (const threshold of runway.thresholds) if (threshold.id === thresholdId) return threshold.node;
    }
    return null;
  }

  thresholdHeading(thresholdId: string): number {
    for (const runway of this.layout.runways) {
      for (const threshold of runway.thresholds) if (threshold.id === thresholdId) return threshold.heading;
    }
    return 0;
  }

  reciprocal(thresholdId: string): string {
    for (const runway of this.layout.runways) {
      const ids = runway.thresholds.map((t) => t.id);
      if (ids.includes(thresholdId)) return ids.find((id) => id !== thresholdId) ?? thresholdId;
    }
    return thresholdId;
  }

  /** The next threshold-serving holding point after `pointId` in node list order, wrapping round. */
  nextServingHoldingPoint(pointId: string): string {
    const serving = this.layout.nodes.filter((node) => node.kind === 'holding' && this.servesThreshold(node.id));
    const all = this.layout.nodes;
    const start = all.findIndex((node) => node.id === pointId);
    for (let step = 1; step <= all.length; step++) {
      const node = all[(start + step) % all.length]!;
      if (serving.includes(node) && node.id !== pointId) return node.id;
    }
    return pointId;
  }

  segmentsAt(nodeId: string): LayoutSegment[] {
    return this.layout.segments.filter((segment) => segment.from === nodeId || segment.to === nodeId);
  }

  stands(): string[] {
    return this.layout.nodes.filter((node) => node.kind === 'stand').map((node) => node.id);
  }
}

// ---------- import validation ----------

interface Located {
  keyLines: WeakMap<object, Record<string, number>>;
  itemLines: WeakMap<object, number>;
}

class JsonSyntaxError extends Error {
  constructor(readonly line: number) {
    super('syntax');
  }
}

function parseWithLines(text: string): { value: unknown; located: Located } {
  const located: Located = { keyLines: new WeakMap(), itemLines: new WeakMap() };
  let pos = 0;
  const lineAt = (at: number) => {
    let line = 1;
    for (let i = 0; i < at && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
    return line;
  };
  const fail = (): never => {
    throw new JsonSyntaxError(lineAt(pos));
  };
  const skip = () => {
    while (pos < text.length && ' \t\n\r'.includes(text[pos]!)) pos++;
  };
  const literal = (word: string, value: unknown) => {
    if (text.startsWith(word, pos)) {
      pos += word.length;
      return value;
    }
    return fail();
  };
  const parseString = (): string => {
    pos++;
    let out = '';
    while (pos < text.length) {
      const c = text[pos]!;
      if (c === '"') {
        pos++;
        return out;
      }
      if (c.charCodeAt(0) < 0x20) fail();
      if (c === '\\') {
        const next = text[pos + 1];
        const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (next !== undefined && next in simple) {
          out += simple[next];
          pos += 2;
          continue;
        }
        if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(pos + 2, pos + 6))) {
          out += String.fromCharCode(parseInt(text.slice(pos + 2, pos + 6), 16));
          pos += 6;
          continue;
        }
        pos++;
        fail();
      }
      out += c;
      pos++;
    }
    return fail();
  };
  const parseNumber = (): number => {
    const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(pos));
    if (!match) return fail();
    pos += match[0].length;
    return Number(match[0]);
  };
  const parseValue = (): unknown => {
    skip();
    const c = text[pos];
    if (c === '{') {
      const start = pos;
      pos++;
      const obj: Record<string, unknown> = {};
      const lines: Record<string, number> = {};
      located.itemLines.set(obj, lineAt(start));
      located.keyLines.set(obj, lines);
      skip();
      if (text[pos] === '}') {
        pos++;
        return obj;
      }
      for (;;) {
        skip();
        if (text[pos] !== '"') fail();
        const keyLine = lineAt(pos);
        const key = parseString();
        skip();
        if (text[pos] !== ':') fail();
        pos++;
        const value = parseValue();
        Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
        lines[key] = keyLine;
        skip();
        if (text[pos] === ',') {
          pos++;
          continue;
        }
        if (text[pos] === '}') {
          pos++;
          return obj;
        }
        fail();
      }
    }
    if (c === '[') {
      pos++;
      const arr: unknown[] = [];
      skip();
      if (text[pos] === ']') {
        pos++;
        return arr;
      }
      for (;;) {
        arr.push(parseValue());
        skip();
        if (text[pos] === ',') {
          pos++;
          continue;
        }
        if (text[pos] === ']') {
          pos++;
          return arr;
        }
        fail();
      }
    }
    if (c === '"') return parseString();
    if (c === 't') return literal('true', true);
    if (c === 'f') return literal('false', false);
    if (c === 'n') return literal('null', null);
    if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) return parseNumber();
    return fail();
  };
  const value = parseValue();
  skip();
  if (pos < text.length) fail();
  return { value, located };
}

export type ImportResult = { ok: true; layout: Layout } | { ok: false; lines: string[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const NODE_KINDS = ['threshold', 'holding', 'junction', 'stand'];

export function validateLayout(bytes: Buffer): ImportResult {
  const notJson = (line: number): ImportResult => ({ ok: false, lines: [`Line ${line}: this is not valid JSON.`] });
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return notJson(1);
  }
  let parsed: { value: unknown; located: Located };
  try {
    parsed = parseWithLines(text);
  } catch (error) {
    if (error instanceof JsonSyntaxError) return notJson(error.line);
    throw error;
  }
  const { value: doc, located } = parsed;
  const keys = ['name', 'code', 'runways', 'nodes', 'segments'];
  if (!isObject(doc) || !keys.every((key) => key in doc)) return notJson(1);
  const lineOf = (obj: object, key: string) => located.keyLines.get(obj)?.[key] ?? located.itemLines.get(obj) ?? 1;
  const itemLine = (obj: unknown) => (isObject(obj) ? (located.itemLines.get(obj) ?? 1) : 1);

  if (typeof doc.name !== 'string' || typeof doc.code !== 'string') return notJson(1);
  if (!Array.isArray(doc.runways) || !Array.isArray(doc.nodes) || !Array.isArray(doc.segments)) return notJson(1);
  for (const runway of doc.runways) {
    if (!isObject(runway) || typeof runway.id !== 'string' || typeof runway.lengthM !== 'number' || !Array.isArray(runway.thresholds))
      return notJson(itemLine(runway));
    for (const threshold of runway.thresholds) {
      if (!isObject(threshold) || typeof threshold.id !== 'string' || typeof threshold.node !== 'string' || typeof threshold.heading !== 'number')
        return notJson(itemLine(threshold));
    }
  }
  for (const node of doc.nodes) {
    if (
      !isObject(node) ||
      typeof node.id !== 'string' ||
      typeof node.kind !== 'string' ||
      !NODE_KINDS.includes(node.kind) ||
      typeof node.x !== 'number' ||
      typeof node.y !== 'number' ||
      (node.serves !== undefined && typeof node.serves !== 'string')
    )
      return notJson(itemLine(node));
  }
  for (const segment of doc.segments) {
    if (
      !isObject(segment) ||
      typeof segment.id !== 'string' ||
      typeof segment.from !== 'string' ||
      typeof segment.to !== 'string' ||
      typeof segment.lengthM !== 'number' ||
      typeof segment.speedMps !== 'number' ||
      typeof segment.taxiway !== 'string'
    )
      return notJson(itemLine(segment));
  }

  const layout = doc as unknown as Layout;
  const problems: { line: number; text: string }[] = [];
  const seen = new Set<string>();
  for (const node of layout.nodes) {
    if (seen.has(node.id)) problems.push({ line: lineOf(node, 'id'), text: `node ${node.id} is listed more than once.` });
    seen.add(node.id);
  }
  const thresholds = new Set(layout.runways.flatMap((runway) => runway.thresholds.map((t) => t.id)));
  for (const node of layout.nodes) {
    if (node.kind === 'holding' && node.serves !== undefined && node.serves !== 'cross' && !thresholds.has(node.serves))
      problems.push({ line: lineOf(node, 'serves'), text: `holding point ${node.id} serves unknown runway ${node.serves}.` });
  }
  for (const segment of layout.segments) {
    if (!seen.has(segment.from))
      problems.push({ line: lineOf(segment, 'from'), text: `segment ${segment.id} starts at unknown node ${segment.from}.` });
    if (!seen.has(segment.to))
      problems.push({ line: lineOf(segment, 'to'), text: `segment ${segment.id} ends at unknown node ${segment.to}.` });
    if (!(segment.lengthM > 0))
      problems.push({ line: lineOf(segment, 'lengthM'), text: `segment ${segment.id} must be longer than 0 m.` });
  }
  if (problems.length > 0) {
    problems.sort((a, b) => a.line - b.line);
    return { ok: false, lines: problems.map((problem) => `Line ${problem.line}: ${problem.text}`) };
  }
  return { ok: true, layout: normaliseLayout(layout) };
}

function normaliseLayout(layout: Layout): Layout {
  return {
    name: layout.name,
    code: layout.code,
    runways: layout.runways.map((runway) => ({
      id: runway.id,
      lengthM: runway.lengthM,
      thresholds: runway.thresholds.map((t) => ({ id: t.id, node: t.node, heading: t.heading })),
    })),
    nodes: layout.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      x: node.x,
      y: node.y,
      ...(node.serves !== undefined ? { serves: node.serves } : {}),
    })),
    segments: layout.segments.map((segment) => ({
      id: segment.id,
      from: segment.from,
      to: segment.to,
      lengthM: segment.lengthM,
      speedMps: segment.speedMps,
      taxiway: segment.taxiway,
    })),
  };
}
