// Import parsing: bounded XML/SVG judged by content, with the safety rules.

import { errors } from './errors.js';
import {
  Connector, PageDocument, PortName, Shape, SYSTEM_KINDS, SystemKindId, Zone, ZONE_KINDS, ZoneKindId,
} from '../shared/types.js';
import { closestPorts, elbowPath, portPoint } from '../shared/geometry.js';
import { freshId } from '../shared/pageRules.js';

// Parse limits.
const MAX_DEPTH = 64;
const MAX_ELEMENTS = 20000;
const MAX_ATTRIBUTES = 64;
const MAX_TEXT = 10000;

export interface ParsedAttribute {
  name: string;
  localName: string;
  value: string;
}

export interface ParsedElement {
  localName: string;
  attributes: ParsedAttribute[];
  children: ParsedNode[];
  text: string;
  titleText: string | null;
}

export interface ParsedText {
  text: string;
}

export interface ParsedDoctype {
  raw: string;
}

export interface ParsedPI {
  target: string;
  isDecl: boolean;
}

export type ParsedNode =
  | { kind: 'element'; el: ParsedElement }
  | { kind: 'text'; text: ParsedText }
  | { kind: 'doctype'; doctype: ParsedDoctype }
  | { kind: 'pi'; pi: ParsedPI };

// A hand-written, bounded parser. It never expands entities and never fetches
// anything; any file within the byte limit is answered within 2 seconds.

interface ParserState {
  input: string;
  pos: number;
  depth: number;
  elements: number;
}

class ParseLimitError extends Error {
  constructor(message: string, readonly limit: boolean) {
    super(message);
  }
}

const malformed = (why: string) => new ParseLimitError(why, false);
const limit = (why: string) => new ParseLimitError(why, true);

function localName(name: string): string {
  const idx = name.indexOf(':');
  return idx === -1 ? name : name.slice(idx + 1);
}

function skipWhitespace(s: ParserState): void {
  while (s.pos < s.input.length && /\s/.test(s.input[s.pos])) s.pos++;
}

function isNameStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}

function isNameChar(ch: string): boolean {
  return /[A-Za-z0-9_.:-]/.test(ch);
}

function readName(s: ParserState): string {
  if (s.pos >= s.input.length || !isNameStart(s.input[s.pos])) throw malformed('name');
  const start = s.pos;
  while (s.pos < s.input.length && isNameChar(s.input[s.pos])) s.pos++;
  return s.input.slice(start, s.pos);
}

function decodeEntities(s: string): string {
  // Character references only. Named entities other than the five XML ones are
  // not decoded (they are left as literal text and never expanded).
  return s.replace(/&#(?:x([0-9A-Fa-f]+)|(\d+));/g, (_m, hex, dec) => {
    const code = hex !== undefined ? parseInt(hex, 16) : parseInt(dec, 10);
    if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return '\uFFFD';
    try {
      return String.fromCodePoint(code);
    } catch {
      return '\uFFFD';
    }
  }).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function readAttributeValue(s: ParserState): string {
  if (s.pos >= s.input.length) throw malformed('attr');
  const quote = s.input[s.pos];
  if (quote !== '"' && quote !== "'") throw malformed('attr');
  s.pos++;
  const start = s.pos;
  while (s.pos < s.input.length && s.input[s.pos] !== quote) {
    if (s.input[s.pos] === '<') throw malformed('attr');
    s.pos++;
  }
  if (s.pos >= s.input.length) throw malformed('attr');
  const raw = s.input.slice(start, s.pos);
  if (raw.length > MAX_TEXT) throw limit('attr length');
  s.pos++;
  return decodeEntities(raw);
}

function readText(s: ParserState): ParsedNode | null {
  const start = s.pos;
  while (s.pos < s.input.length && s.input[s.pos] !== '<') s.pos++;
  if (s.pos === start) return null;
  const raw = s.input.slice(start, s.pos);
  if (raw.length > MAX_TEXT) throw limit('text length');
  const text = decodeEntities(raw);
  return { kind: 'text', text: { text } };
}

function parseElement(s: ParserState): ParsedNode {
  // s.pos is just past '<'.
  if (s.input[s.pos] === '/') throw malformed('unexpected close');
  const name = readName(s);
  const attributes: ParsedAttribute[] = [];
  for (;;) {
    skipWhitespace(s);
    if (s.pos >= s.input.length) throw malformed('eof');
    const ch = s.input[s.pos];
    if (ch === '>') { s.pos++; break; }
    if (ch === '/') {
      if (s.input[s.pos + 1] === '>') {
        s.pos += 2;
        return { kind: 'element', el: { localName: localName(name), attributes, children: [], text: '', titleText: null } };
      }
      throw malformed('tag end');
    }
    const attrName = readName(s);
    skipWhitespace(s);
    if (s.pos >= s.input.length || s.input[s.pos] !== '=') throw malformed('attr eq');
    s.pos++;
    skipWhitespace(s);
    const value = readAttributeValue(s);
    if (attributes.length >= MAX_ATTRIBUTES) throw limit('attr count');
    attributes.push({ name: attrName, localName: localName(attrName).toLowerCase(), value });
  }
  s.elements++;
  if (s.elements > MAX_ELEMENTS) throw limit('element count');
  s.depth++;
  if (s.depth > MAX_DEPTH) throw limit('depth');
  const children: ParsedNode[] = [];
  let text = '';
  for (;;) {
    if (s.pos >= s.input.length) throw malformed('unclosed');
    if (s.input[s.pos] === '<') {
      if (s.input.startsWith('</', s.pos)) {
        s.pos += 2;
        const closeName = readName(s);
        skipWhitespace(s);
        if (s.pos >= s.input.length || s.input[s.pos] !== '>') throw malformed('close');
        s.pos++;
        if (closeName !== name) throw malformed('mismatch');
        s.depth--;
        break;
      }
      if (s.input.startsWith('<!--', s.pos)) {
        const end = s.input.indexOf('-->', s.pos + 4);
        if (end === -1) throw malformed('comment');
        s.pos = end + 3;
        continue;
      }
      if (s.input.startsWith('<![CDATA[', s.pos)) {
        const end = s.input.indexOf(']]>', s.pos + 9);
        if (end === -1) throw malformed('cdata');
        text += s.input.slice(s.pos + 9, end);
        s.pos = end + 3;
        continue;
      }
      if (s.input.startsWith('<!', s.pos)) {
        throw malformed('declaration in element');
      }
      if (s.input.startsWith('<?', s.pos)) {
        throw malformed('pi in element');
      }
      s.pos++;
      const child = parseElement(s);
      children.push(child);
      continue;
    }
    const t = readText(s);
    if (t !== null) {
      children.push(t);
      if (t.kind === 'text') text += t.text.text;
    }
  }
  return { kind: 'element', el: { localName: localName(name), attributes, children, text, titleText: null } };
}

// Parse a whole document. A DOCTYPE or a non-declaration processing
// instruction is recorded so the safety check can refuse the file.
export interface ParsedDocument {
  root: ParsedElement | null;
  hasDoctype: boolean;
  hasForeignPi: boolean;
  svgNamespace: boolean;
}

export function parseXml(bytes: Buffer): ParsedDocument {
  let input = bytes.toString('utf8');
  if (input.startsWith('\uFEFF')) input = input.slice(1);
  if (input.includes('\uFFFD') && !bytes.includes(Buffer.from([0xef, 0xbf, 0xbd]))) {
    throw malformed('utf8');
  }
  const s: ParserState = { input, pos: 0, depth: 0, elements: 0 };
  let root: ParsedElement | null = null;
  let hasDoctype = false;
  let hasForeignPi = false;
  skipWhitespace(s);
  for (;;) {
    if (s.pos >= s.input.length) break;
    if (s.input[s.pos] !== '<') {
      const t = readText(s);
      if (t === null) break;
      continue;
    }
    if (s.input.startsWith('<?', s.pos)) {
      const end = s.input.indexOf('?>', s.pos);
      if (end === -1) throw malformed('pi');
      const decl = /^<\?xml[\s\r\n]/.test(s.input.slice(s.pos, s.pos + 6));
      if (!decl) hasForeignPi = true;
      s.pos = end + 2;
      skipWhitespace(s);
      continue;
    }
    if (s.input.startsWith('<!DOCTYPE', s.pos) || s.input.startsWith('<!doctype', s.pos)) {
      hasDoctype = true;
      // Skip to the matching '>' accounting for internal subsets.
      let i = s.pos + 9;
      let depth = 0;
      while (i < s.input.length) {
        const ch = s.input[i];
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '>' && depth === 0) break;
        i++;
      }
      if (i >= s.input.length) throw malformed('doctype');
      s.pos = i + 1;
      skipWhitespace(s);
      continue;
    }
    if (s.input.startsWith('<!--', s.pos)) {
      const end = s.input.indexOf('-->', s.pos + 4);
      if (end === -1) throw malformed('comment');
      s.pos = end + 3;
      continue;
    }
    if (s.input[s.pos] === '<' && (s.pos + 1 < s.input.length && isNameStart(s.input[s.pos + 1]))) {
      if (root !== null) throw malformed('two roots');
      s.pos++;
      const node = parseElement(s);
      if (node.kind !== 'element') throw malformed('root');
      root = node.el;
      skipWhitespace(s);
      continue;
    }
    throw malformed('junk');
  }
  const svgNamespace = root !== null && root.attributes.some((a) =>
    (a.name === 'xmlns' || a.name.startsWith('xmlns:')) && a.value === 'http://www.w3.org/2000/svg');
  return { root, hasDoctype, hasForeignPi, svgNamespace };
}

// ---------------------------------------------------------------------------
// Safety checks, run on the parsed document with decoded values.

function stripInert(value: string): string {
  // Whitespace and control characters removed, lowercased for matching.
  return value.replace(/[\s\u0000-\u001F\u007F]/g, '').toLowerCase();
}

const UNSAFE_LOCAL_NAMES = new Set(['script', 'foreignobject', 'iframe', 'embed', 'object']);
const UNSAFE_ATTRS = new Set(['src', 'action', 'formaction']);
const ANIMATION_ELEMENTS = new Set(['animate', 'set', 'animatetransform']);

function styleTextUnsafe(text: string): boolean {
  const stripped = stripInert(text);
  if (stripped.includes('@import')) return true;
  const re = /url\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const target = stripQuotes(m[1]);
    if (!target.startsWith('#')) return true;
  }
  return false;
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]/, '').replace(/['"]$/, '');
}

export function isUnsafe(doc: ParsedDocument): boolean {
  if (doc.hasDoctype) return true;
  if (doc.hasForeignPi) return true;
  const walk = (el: ParsedElement): boolean => {
    if (UNSAFE_LOCAL_NAMES.has(el.localName.toLowerCase())) return true;
    const isAnimation = ANIMATION_ELEMENTS.has(el.localName.toLowerCase());
    for (const attr of el.attributes) {
      const name = attr.localName.toLowerCase();
      const value = stripInert(attr.value);
      if (name.startsWith('on')) return true;
      if (UNSAFE_ATTRS.has(name)) return true;
      if (name === 'href' && value !== '' && !value.startsWith('#')) return true;
      if (isAnimation) {
        if (name === 'attributename') {
          const v = attr.value.toLowerCase();
          if (v === 'href' || v.endsWith(':href')) return true;
        }
        if (name === 'to' || name === 'from' || name === 'values') {
          for (const part of attr.value.split(';')) {
            const v = stripInert(part);
            if (v.startsWith('javascript:') || v.startsWith('data:')) return true;
          }
        }
      }
      // A style attribute or any presentation attribute with @import or a
      // url() target that is not a local reference.
      if (name !== 'style' && name.startsWith('data-')) continue;
      if (value.includes('@import')) return true;
      const urlMatch = value.match(/url\(([^)]*)\)/);
      if (urlMatch !== null) {
        const target = stripInert(stripQuotes(urlMatch[1]));
        if (!target.startsWith('#')) return true;
      }
    }
    if (el.localName.toLowerCase() === 'style' && styleTextUnsafe(el.text)) return true;
    for (const child of el.children) {
      if (child.kind === 'element') {
        if (walk(child.el)) return true;
      }
    }
    return false;
  };
  if (doc.root === null) return false;
  return walk(doc.root);
}

// ---------------------------------------------------------------------------
// Diagram XML and SVG to page document.

function roundedInt(value: string | undefined): number | null {
  if (value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function attribute(el: ParsedElement, name: string): string | undefined {
  return el.attributes.find((a) => a.localName === name)?.value;
}

function titleText(el: ParsedElement): string {
  const title = el.children.find((c) => c.kind === 'element' && c.el.localName === 'title');
  if (title && title.kind === 'element') return title.el.text;
  return '';
}

function descendants(el: ParsedElement, name: string): ParsedElement[] {
  const out: ParsedElement[] = [];
  const walk = (node: ParsedElement): void => {
    for (const child of node.children) {
      if (child.kind === 'element') {
        if (child.el.localName === name) out.push(child.el);
        walk(child.el);
      }
    }
  };
  walk(el);
  return out;
}

// The stored filename rule for imports.
export function importFileName(name: string): string {
  const last = name.split('/').pop() ?? name;
  const cleaned = last.replace(/[\u0000-\u001F\u007F]/g, '');
  return cleaned.slice(0, 70);
}

// Parse the uploaded bytes into a sanitized page document. Throws the
// published import errors in their precedence order; creates nothing.
export function importToPage(fileName: string, bytes: Buffer): PageDocument {
  let doc: ParsedDocument;
  try {
    doc = parseXml(bytes);
  } catch (err) {
    if (err instanceof ParseLimitError) {
      if (err.limit) throw errors.invalidModel();
      throw errors.unsupportedFileType();
    }
    throw err;
  }
  if (doc.root === null) throw errors.unsupportedFileType();
  const rootLocal = doc.root.localName.toLowerCase();
  if (rootLocal !== 'svg' || !doc.svgNamespace) {
    if (rootLocal !== 'diagram') throw errors.unsupportedFileType();
  }
  // Unsafe content is judged on the parsed document, before any model check.
  if (isUnsafe(doc)) throw errors.unsafeFile();
  if (rootLocal === 'svg' && doc.svgNamespace) return svgToPage(fileName, doc.root);
  return diagramXmlToPage(fileName, doc.root);
}

function diagramXmlToPage(fileName: string, root: ParsedElement): PageDocument {
  const pages = descendants(root, 'page');
  if (pages.length === 0) throw errors.invalidModel();
  const zones: Zone[] = [];
  const shapes: Shape[] = [];
  const connectors: Connector[] = [];
  const taken = new Set<string>();
  const idFor = (el: ParsedElement, prefix: string): string => {
    const wanted = attribute(el, 'id') ?? freshId(prefix, taken);
    let id = wanted;
    let n = 1;
    while (taken.has(id)) {
      id = `${wanted}-${n}`;
      n++;
    }
    taken.add(id);
    return id;
  };
  let z = 1;
  for (const page of pages) {
    for (const zoneEl of descendants(page, 'zone')) {
      const kindRaw = (attribute(zoneEl, 'kind') ?? 'cde') as ZoneKindId;
      const kind: ZoneKindId = kindRaw in ZONE_KINDS ? kindRaw : 'cde';
      const x = roundedInt(attribute(zoneEl, 'x')) ?? 0;
      const y = roundedInt(attribute(zoneEl, 'y')) ?? 0;
      const width = roundedInt(attribute(zoneEl, 'width')) ?? 480;
      const height = roundedInt(attribute(zoneEl, 'height')) ?? 336;
      const noteEl = zoneEl.children.find((c) => c.kind === 'element' && c.el.localName === 'note');
      const note = noteEl && noteEl.kind === 'element' ? noteEl.el.text : '';
      zones.push({
        id: idFor(zoneEl, 'zone-'),
        kind,
        name: attribute(zoneEl, 'name') ?? ZONE_KINDS[kind].defaultName,
        note,
        x, y, width, height,
      });
    }
    for (const sysEl of descendants(page, 'system')) {
      const kindRaw = (attribute(sysEl, 'kind') ?? 'server') as SystemKindId;
      const kind: SystemKindId = kindRaw in SYSTEM_KINDS ? kindRaw : 'server';
      const label = attribute(sysEl, 'label') ?? SYSTEM_KINDS[kind];
      shapes.push({
        id: idFor(sysEl, 'shp-'),
        kind,
        label,
        x: roundedInt(attribute(sysEl, 'x')) ?? 0,
        y: roundedInt(attribute(sysEl, 'y')) ?? 0,
        width: roundedInt(attribute(sysEl, 'width')) ?? 144,
        height: roundedInt(attribute(sysEl, 'height')) ?? 72,
        z: z++,
        groupId: null,
      });
    }
    for (const flowEl of descendants(page, 'flow')) {
      const fromId = attribute(flowEl, 'from');
      const toId = attribute(flowEl, 'to');
      const fromShape = fromId !== undefined ? shapes.find((s) => s.id === fromId) : undefined;
      const toShape = toId !== undefined ? shapes.find((s) => s.id === toId) : undefined;
      if (!fromShape || !toShape) continue;
      const ports = closestPorts(fromShape, toShape);
      const start = portPoint(fromShape, ports.from);
      const end = portPoint(toShape, ports.to);
      connectors.push({
        id: idFor(flowEl, 'con-'),
        label: attribute(flowEl, 'label') ?? '',
        from: { shapeId: fromShape.id, port: ports.from as PortName },
        to: { shapeId: toShape.id, port: ports.to as PortName },
        points: elbowPath(start, end),
      });
    }
  }
  return {
    id: 'imported',
    name: `Imported ${importFileName(fileName)}`,
    version: 1,
    zones,
    shapes,
    connectors,
  };
}

interface SvgRectImport {
  dataId: string;
  kind: SystemKindId | ZoneKindId | null;
  isZone: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  el: ParsedElement;
}

function svgToPage(fileName: string, root: ParsedElement): PageDocument {
  const rects = descendants(root, 'rect');
  const imported: SvgRectImport[] = [];
  const seenIds = new Set<string>();
  for (const rect of rects) {
    const dataId = attribute(rect, 'data-id');
    const dataKind = attribute(rect, 'data-kind');
    if (dataId === undefined || dataKind === undefined) continue;
    if (seenIds.has(dataId)) throw errors.invalidModel();
    seenIds.add(dataId);
    let kind: SystemKindId | ZoneKindId | null = null;
    let isZone = false;
    if (dataKind in SYSTEM_KINDS) {
      kind = dataKind as SystemKindId;
    } else if (dataKind === 'zone-cde' || dataKind === 'zone-connected' || dataKind === 'zone-out') {
      isZone = true;
      kind = dataKind === 'zone-cde' ? 'cde' : dataKind === 'zone-connected' ? 'connected' : 'out_of_scope';
    } else {
      continue;
    }
    imported.push({
      dataId,
      kind,
      isZone,
      x: roundedInt(attribute(rect, 'x')) ?? 0,
      y: roundedInt(attribute(rect, 'y')) ?? 0,
      width: roundedInt(attribute(rect, 'width')) ?? 144,
      height: roundedInt(attribute(rect, 'height')) ?? 72,
      title: titleText(rect),
      el: rect,
    });
  }
  const zones: Zone[] = [];
  const shapes: Shape[] = [];
  const taken = new Set<string>();
  const idMap = new Map<string, string>();
  let z = 1;
  for (const item of imported) {
    const fresh = freshId(item.isZone ? 'zone-' : 'shp-', taken);
    taken.add(fresh);
    idMap.set(item.dataId, fresh);
    if (item.isZone && item.kind !== null) {
      zones.push({
        id: fresh,
        kind: item.kind as ZoneKindId,
        name: item.title || ZONE_KINDS[item.kind as ZoneKindId].defaultName,
        note: '',
        x: item.x, y: item.y, width: item.width, height: item.height,
      });
    } else if (item.kind !== null) {
      shapes.push({
        id: fresh,
        kind: item.kind as SystemKindId,
        label: item.title || SYSTEM_KINDS[item.kind as SystemKindId],
        x: item.x, y: item.y, width: item.width, height: item.height,
        z: z++,
        groupId: null,
      });
    }
  }
  const connectors: Connector[] = [];
  for (const line of descendants(root, 'polyline')) {
    if (attribute(line, 'data-connector') === undefined) continue;
    const fromId = attribute(line, 'data-from');
    const toId = attribute(line, 'data-to');
    if (fromId === undefined || toId === undefined) continue;
    const fromItem = imported.find((i) => i.dataId === fromId);
    const toItem = imported.find((i) => i.dataId === toId);
    if (!fromItem || !toItem || fromItem.isZone || toItem.isZone) continue;
    const fromShape = shapes.find((s) => s.id === idMap.get(fromId));
    const toShape = shapes.find((s) => s.id === idMap.get(toId));
    if (!fromShape || !toShape) continue;
    const fromPort = (attribute(line, 'data-from-port') ?? 'n') as PortName;
    const toPort = (attribute(line, 'data-to-port') ?? 'n') as PortName;
    const pointsRaw = attribute(line, 'points') ?? '';
    const points = parsePoints(pointsRaw);
    const start = portPoint(fromShape, fromPort);
    const end = portPoint(toShape, toPort);
    const startsOnPort = points.length >= 2 && points[0][0] === start[0] && points[0][1] === start[1];
    const endsOnPort = points.length >= 2 && points[points.length - 1][0] === end[0] && points[points.length - 1][1] === end[1];
    const orthogonal = points.every((p, i) => i === 0
      || points[i - 1][0] === p[0]
      || points[i - 1][1] === p[1]);
    const useKept = startsOnPort && endsOnPort && orthogonal;
    const fresh = freshId('con-', taken);
    taken.add(fresh);
    connectors.push({
      id: fresh,
      label: titleText(line),
      from: { shapeId: fromShape.id, port: fromPort },
      to: { shapeId: toShape.id, port: toPort },
      points: useKept ? points : elbowPath(start, end),
    });
  }
  return {
    id: 'imported',
    name: `Imported ${importFileName(fileName)}`,
    version: 1,
    zones,
    shapes,
    connectors,
  };
}

function parsePoints(raw: string): [number, number][] {
  const out: [number, number][] = [];
  const nums = raw.trim().split(/[\s,]+/).filter((t) => t !== '');
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = Number(nums[i]);
    const y = Number(nums[i + 1]);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push([Math.round(x), Math.round(y)]);
  }
  return out;
}
