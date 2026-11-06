import { closestPortPair, elbowPath, portPoint } from '../../shared/geometry';
import { isSystemKindId, isZoneKindId, zoneKindDefaultName, systemKindName } from '../../shared/kinds';
import { deriveFromPage } from '../../shared/derive';
import { parsePageDocument } from '../../shared/validate';
import type { Connector, PageDocument, PointTuple, Shape, SystemKindId, Zone, ZoneKindId } from '../../shared/types';
import {
  SVG_NAMESPACE,
  XmlNotWellFormedError,
  XmlParseLimitError,
  attributeValue,
  childByLocalName,
  parseXml,
  walkElements,
  type XmlDocument,
} from './xml';

export type ImportRejection = 'unsupported_file_type' | 'invalid_model' | 'unsafe_file';

export class ImportRejected extends Error {
  readonly reason: ImportRejection;

  constructor(reason: ImportRejection) {
    super(reason);
    this.reason = reason;
  }
}

const UNSAFE_ELEMENTS = new Set(['script', 'foreignobject', 'iframe', 'embed', 'object']);
const ANIMATION_ELEMENTS = new Set(['animate', 'set', 'animatetransform']);
const PRESENTATION_ATTRIBUTES = new Set([
  'style',
  'fill',
  'stroke',
  'filter',
  'mask',
  'clip-path',
  'marker',
  'marker-start',
  'marker-mid',
  'marker-end',
  'background',
  'cursor',
  'fill-opacity',
  'stroke-opacity',
]);

/** Values are judged after character references are decoded and spacing removed. */
function normalizeValue(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) continue;
    out += char;
  }
  return out.toLowerCase();
}

function hasUnsafeUrlFunction(value: string): boolean {
  const normalized = normalizeValue(value);
  if (normalized.includes('@import')) return true;
  let from = normalized.indexOf('url(');
  while (from !== -1) {
    const close = normalized.indexOf(')', from);
    const target = normalized.slice(from + 4, close === -1 ? undefined : close).replace(/^['"]|['"]$/g, '');
    if (!target.startsWith('#')) return true;
    from = normalized.indexOf('url(', from + 4);
  }
  return false;
}

function startsWithUnsafeScheme(value: string): boolean {
  const normalized = normalizeValue(value);
  return normalized.startsWith('javascript:') || normalized.startsWith('data:');
}

/** The unsafe-content rule, judged on the parsed document and never on raw text. */
export function assertSafeDocument(document: XmlDocument): void {
  if (document.hasDoctype || document.extraProcessingInstructions > 0) throw new ImportRejected('unsafe_file');
  for (const element of walkElements(document.root)) {
    const localName = element.localName.toLowerCase();
    if (UNSAFE_ELEMENTS.has(localName)) throw new ImportRejected('unsafe_file');
    if (localName === 'style' && hasUnsafeUrlFunction(element.text)) throw new ImportRejected('unsafe_file');
    for (const attribute of element.attributes) {
      const name = attribute.localName.toLowerCase();
      if (name.startsWith('on')) throw new ImportRejected('unsafe_file');
      if (name === 'href') {
        const value = normalizeValue(attribute.value);
        if (value.length > 0 && !value.startsWith('#')) throw new ImportRejected('unsafe_file');
      }
      if (name === 'src' || name === 'action' || name === 'formaction') throw new ImportRejected('unsafe_file');
      if (PRESENTATION_ATTRIBUTES.has(name) && hasUnsafeUrlFunction(attribute.value)) {
        throw new ImportRejected('unsafe_file');
      }
    }
    if (ANIMATION_ELEMENTS.has(localName)) {
      const attributeName = normalizeValue(attributeValue(element, 'attributeName') ?? '');
      if (attributeName === 'href' || attributeName.endsWith(':href')) throw new ImportRejected('unsafe_file');
      const targets = [attributeValue(element, 'to') ?? '', attributeValue(element, 'from') ?? ''];
      for (const item of (attributeValue(element, 'values') ?? '').split(';')) targets.push(item);
      for (const target of targets) {
        if (target.length > 0 && startsWithUnsafeScheme(target)) throw new ImportRejected('unsafe_file');
      }
    }
  }
}

/** The last path segment of the uploaded name, control characters removed, cut to 70. */
export function importFileName(raw: string): string {
  const lastSlash = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
  const segment = lastSlash === -1 ? raw : raw.slice(lastSlash + 1);
  let cleaned = '';
  for (const char of segment) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    cleaned += char;
  }
  return cleaned.slice(0, 70);
}

function roundNumber(value: string | null): number {
  const parsed = Number.parseFloat(value ?? '');
  if (!Number.isFinite(parsed)) throw new ImportRejected('invalid_model');
  return Math.round(parsed);
}

interface DraftShape {
  sourceId: string;
  shape: Shape;
}

function makeIds(prefix: string, index: number): string {
  return `${prefix}-${index}`;
}

function buildFromDiagramXml(document: XmlDocument): { zones: Zone[]; shapes: DraftShape[]; connectors: Connector[] } {
  const zones: Zone[] = [];
  const shapes: DraftShape[] = [];
  const flows: Array<{ from: string; to: string; label: string }> = [];
  const pages = document.root.children.filter((child) => child.localName === 'page');
  if (pages.length === 0) throw new ImportRejected('invalid_model');
  for (const page of pages) {
    for (const child of page.children) {
      if (child.localName === 'zone') {
        const kind = attributeValue(child, 'kind');
        if (!isZoneKindId(kind)) throw new ImportRejected('invalid_model');
        const noteElement = childByLocalName(child, 'note');
        const name = attributeValue(child, 'name') ?? '';
        zones.push({
          id: makeIds('zone', zones.length + 1),
          kind,
          name: name.trim().length > 0 ? name : zoneKindDefaultName(kind),
          note: noteElement ? noteElement.text : '',
          x: roundNumber(attributeValue(child, 'x')),
          y: roundNumber(attributeValue(child, 'y')),
          width: roundNumber(attributeValue(child, 'width')),
          height: roundNumber(attributeValue(child, 'height')),
        });
      } else if (child.localName === 'system') {
        const rawKind = attributeValue(child, 'kind');
        const kind: SystemKindId = isSystemKindId(rawKind) ? rawKind : 'server';
        const sourceId = attributeValue(child, 'id') ?? '';
        shapes.push({
          sourceId,
          shape: {
            id: makeIds('shp', shapes.length + 1),
            kind,
            label: attributeValue(child, 'label') ?? systemKindName(kind),
            x: roundNumber(attributeValue(child, 'x')),
            y: roundNumber(attributeValue(child, 'y')),
            width: roundNumber(attributeValue(child, 'width')),
            height: roundNumber(attributeValue(child, 'height')),
            z: shapes.length + 1,
            groupId: null,
          },
        });
      } else if (child.localName === 'flow') {
        flows.push({
          from: attributeValue(child, 'from') ?? '',
          to: attributeValue(child, 'to') ?? '',
          label: attributeValue(child, 'label') ?? '',
        });
      }
    }
  }

  const bySourceId = new Map<string, Shape>();
  for (const draft of shapes) {
    if (draft.sourceId) bySourceId.set(draft.sourceId, draft.shape);
  }
  const connectors: Connector[] = [];
  for (const flow of flows) {
    const source = bySourceId.get(flow.from);
    const target = bySourceId.get(flow.to);
    if (!source || !target) continue;
    const ports = closestPortPair(source, target);
    connectors.push({
      id: makeIds('con', connectors.length + 1),
      label: flow.label,
      from: { shapeId: source.id, port: ports.from },
      to: { shapeId: target.id, port: ports.to },
      points: elbowPathBetween(source, ports.from, target, ports.to),
    });
  }
  return { zones, shapes, connectors };
}

function elbowPathBetween(
  source: Shape,
  fromPort: 'n' | 'e' | 's' | 'w',
  target: Shape,
  toPort: 'n' | 'e' | 's' | 'w',
): PointTuple[] {
  return elbowPath(portPoint(source, fromPort), portPoint(target, toPort));
}

const SVG_ZONE_KINDS: Record<string, ZoneKindId> = {
  'zone-cde': 'cde',
  'zone-connected': 'connected',
  'zone-out': 'out_of_scope',
};

function buildFromSvg(document: XmlDocument): { zones: Zone[]; shapes: DraftShape[]; connectors: Connector[] } {
  const zones: Zone[] = [];
  const shapes: DraftShape[] = [];
  const seenDataIds = new Set<string>();
  const byDataId = new Map<string, Shape>();

  for (const element of walkElements(document.root)) {
    if (element.localName !== 'rect') continue;
    const dataKind = attributeValue(element, 'data-kind');
    if (!dataKind) continue;
    const dataId = attributeValue(element, 'data-id');
    if (dataId) {
      if (seenDataIds.has(dataId)) throw new ImportRejected('invalid_model');
      seenDataIds.add(dataId);
    }
    const titleElement = childByLocalName(element, 'title');
    const title = titleElement ? titleElement.text : '';
    const x = roundNumber(attributeValue(element, 'x'));
    const y = roundNumber(attributeValue(element, 'y'));
    const width = roundNumber(attributeValue(element, 'width'));
    const height = roundNumber(attributeValue(element, 'height'));
    const zoneKind = SVG_ZONE_KINDS[dataKind];
    if (zoneKind) {
      zones.push({
        id: makeIds('zone', zones.length + 1),
        kind: zoneKind,
        name: title.trim().length > 0 ? title : zoneKindDefaultName(zoneKind),
        note: '',
        x,
        y,
        width,
        height,
      });
    } else if (isSystemKindId(dataKind)) {
      const shape: Shape = {
        id: makeIds('shp', shapes.length + 1),
        kind: dataKind,
        label: title,
        x,
        y,
        width,
        height,
        z: shapes.length + 1,
        groupId: null,
      };
      shapes.push({ sourceId: dataId ?? '', shape });
      if (dataId) byDataId.set(dataId, shape);
    }
  }

  const connectors: Connector[] = [];
  for (const element of walkElements(document.root)) {
    if (element.localName !== 'polyline') continue;
    if (attributeValue(element, 'data-connector') === null) continue;
    const fromId = attributeValue(element, 'data-from');
    const toId = attributeValue(element, 'data-to');
    const fromPort = attributeValue(element, 'data-from-port');
    const toPort = attributeValue(element, 'data-to-port');
    if (!fromId || !toId || !isPort(fromPort) || !isPort(toPort)) continue;
    const source = byDataId.get(fromId);
    const target = byDataId.get(toId);
    if (!source || !target) continue;
    const titleElement = childByLocalName(element, 'title');
    const label = titleElement ? titleElement.text : '';
    const points = parsePolylinePoints(attributeValue(element, 'points') ?? '');
    const start = portPoint(source, fromPort);
    const end = portPoint(target, toPort);
    const usable = pointsUsable(points, start, end);
    connectors.push({
      id: makeIds('con', connectors.length + 1),
      label,
      from: { shapeId: source.id, port: fromPort },
      to: { shapeId: target.id, port: toPort },
      points: usable ? points : elbowPathBetween(source, fromPort, target, toPort),
    });
  }
  return { zones, shapes, connectors };
}

function isPort(value: string | null): value is 'n' | 'e' | 's' | 'w' {
  return value === 'n' || value === 'e' || value === 's' || value === 'w';
}

function parsePolylinePoints(raw: string): PointTuple[] {
  const numbers = raw
    .trim()
    .split(/[\s,]+/)
    .filter((part) => part.length > 0)
    .map((part) => Number.parseFloat(part));
  const points: PointTuple[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    const x = numbers[i];
    const y = numbers[i + 1];
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return [];
    points.push([Math.round(x), Math.round(y)]);
  }
  return points;
}

function pointsUsable(points: PointTuple[], start: { x: number; y: number }, end: { x: number; y: number }): boolean {
  if (points.length < 2) return false;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return false;
  if (first[0] !== start.x || first[1] !== start.y) return false;
  if (last[0] !== end.x || last[1] !== end.y) return false;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) return false;
    if (a[0] !== b[0] && a[1] !== b[1]) return false;
  }
  return true;
}

export interface ImportedModel {
  doc: PageDocument;
  derived: ReturnType<typeof deriveFromPage>;
}

/**
 * Judges the type by content, enforces the parse limits, then the safety rules,
 * then builds and validates one new page.
 */
export function buildImportedPage(bytes: Buffer, pageId: string, fileName: string): ImportedModel {
  const sniffed = sniffRootElement(bytes);
  if (!sniffed) throw new ImportRejected('unsupported_file_type');
  const isDiagram = sniffed.localName === 'diagram' && sniffed.namespace === '';
  const isSvg = sniffed.localName === 'svg' && sniffed.namespace === SVG_NAMESPACE;
  if (!isDiagram && !isSvg) throw new ImportRejected('unsupported_file_type');

  let document: XmlDocument;
  try {
    document = parseXml(bytes);
  } catch (error) {
    if (error instanceof XmlParseLimitError) throw new ImportRejected('invalid_model');
    if (error instanceof XmlNotWellFormedError) throw new ImportRejected('unsupported_file_type');
    throw error;
  }

  assertSafeDocument(document);

  const built = isDiagram ? buildFromDiagramXml(document) : buildFromSvg(document);
  const candidate = {
    id: pageId,
    name: `Imported ${fileName}`,
    version: 1,
    zones: built.zones,
    shapes: built.shapes.map((draft) => draft.shape),
    connectors: built.connectors,
  };
  const parsed = parsePageDocument(JSON.parse(JSON.stringify(candidate)));
  if ('error' in parsed) throw new ImportRejected('invalid_model');
  return { doc: parsed.doc, derived: deriveFromPage(parsed.doc) };
}

/** Reads just the first element's name and namespace, so the type is judged by content first. */
function sniffRootElement(bytes: Buffer): { localName: string; namespace: string } | null {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, 8192));
  } catch {
    return null;
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let index = 0;
  for (;;) {
    while (index < text.length && /\s/.test(text[index] ?? '')) index += 1;
    if (text[index] !== '<') return null;
    if (text.startsWith('<!--', index)) {
      const end = text.indexOf('-->', index);
      if (end === -1) return null;
      index = end + 3;
      continue;
    }
    if (text.startsWith('<?', index)) {
      const end = text.indexOf('?>', index);
      if (end === -1) return null;
      index = end + 2;
      continue;
    }
    if (text.startsWith('<!', index)) {
      let cursor = index + 2;
      let depth = 0;
      for (; cursor < text.length; cursor += 1) {
        const char = text[cursor];
        if (char === '[') depth += 1;
        else if (char === ']') depth -= 1;
        else if (char === '>' && depth <= 0) break;
      }
      if (cursor >= text.length) return null;
      index = cursor + 1;
      continue;
    }
    break;
  }
  const tagEnd = text.indexOf('>', index);
  if (tagEnd === -1) return null;
  const tag = text.slice(index + 1, tagEnd);
  const nameMatch = /^([^\s/>]+)/.exec(tag);
  if (!nameMatch?.[1]) return null;
  const qualified = nameMatch[1];
  const colon = qualified.indexOf(':');
  const prefix = colon === -1 ? '' : qualified.slice(0, colon);
  const localName = colon === -1 ? qualified : qualified.slice(colon + 1);
  const namespacePattern = prefix ? new RegExp(`xmlns:${prefix}\\s*=\\s*"([^"]*)"`) : /xmlns\s*=\s*"([^"]*)"/;
  const namespace = namespacePattern.exec(tag)?.[1] ?? '';
  return { localName, namespace };
}
