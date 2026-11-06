import { isSystemKindId, isZoneKindId } from './kinds';
import { portPoint, zonesOverlap } from './geometry';
import type { Connector, PageDocument, Port, Shape, Zone } from './types';

export interface ValidationFailure {
  error: 'validation' | 'dangling_connector';
  fields: Record<string, string>;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

export function isPlainText(value: unknown, min: number, max: number): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max && !CONTROL_PATTERN.test(value);
}

export function hasControlCharacter(value: string): boolean {
  return CONTROL_PATTERN.test(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isCoordinate(value: unknown): boolean {
  return isInteger(value) && value >= -100000 && value <= 100000;
}

const PORT_VALUES: readonly string[] = ['n', 'e', 's', 'w'];

function isPort(value: unknown): value is Port {
  return typeof value === 'string' && PORT_VALUES.includes(value);
}

/** Parses an untrusted body into a page document, or reports its field problems. */
export function parsePageDocument(body: unknown): { doc: PageDocument } | ValidationFailure {
  const fields: Record<string, string> = {};
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

  if (typeof record.id !== 'string' || !ID_PATTERN.test(record.id)) fields['id'] = 'invalid';
  if (!isPlainText(record.name, 1, 80)) fields['name'] = 'invalid';
  if (!isInteger(record.version) || record.version < 1) fields['version'] = 'invalid';

  const rawZones = Array.isArray(record.zones) ? record.zones : null;
  const rawShapes = Array.isArray(record.shapes) ? record.shapes : null;
  const rawConnectors = Array.isArray(record.connectors) ? record.connectors : null;
  if (!rawZones) fields['zones'] = 'invalid';
  if (!rawShapes) fields['shapes'] = 'invalid';
  if (!rawConnectors) fields['connectors'] = 'invalid';
  if (Object.keys(fields).length > 0) return { error: 'validation', fields };

  const zones = rawZones as Record<string, unknown>[];
  const shapes = rawShapes as Record<string, unknown>[];
  const connectors = rawConnectors as Record<string, unknown>[];

  if (zones.length > 20) fields['zones'] = 'too_many';
  if (shapes.length > 500) fields['shapes'] = 'too_many';
  if (connectors.length > 1000) fields['connectors'] = 'too_many';

  const seenIds = new Set<string>();
  const checkId = (value: unknown, path: string): string | null => {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
      fields[`${path}.id`] = 'invalid';
      return null;
    }
    if (seenIds.has(value)) {
      fields[`${path}.id`] = 'duplicate';
      return null;
    }
    seenIds.add(value);
    return value;
  };

  const parsedZones: Zone[] = [];
  zones.forEach((raw, index) => {
    const path = `zones[${index}]`;
    const id = checkId(raw.id, path);
    if (!isZoneKindId(raw.kind)) fields[`${path}.kind`] = 'invalid';
    if (!isPlainText(raw.name, 1, 80)) fields[`${path}.name`] = 'invalid';
    const note = raw.note === undefined || raw.note === null ? '' : raw.note;
    if (typeof note !== 'string' || note.length > 2000) fields[`${path}.note`] = 'invalid';
    if (!isCoordinate(raw.x)) fields[`${path}.x`] = 'invalid';
    if (!isCoordinate(raw.y)) fields[`${path}.y`] = 'invalid';
    if (!isInteger(raw.width) || raw.width < 80 || raw.width > 20000) fields[`${path}.width`] = 'invalid';
    if (!isInteger(raw.height) || raw.height < 80 || raw.height > 20000) fields[`${path}.height`] = 'invalid';
    if (id && isZoneKindId(raw.kind) && typeof note === 'string') {
      parsedZones.push({
        id,
        kind: raw.kind,
        name: typeof raw.name === 'string' ? raw.name : '',
        note,
        x: Number(raw.x),
        y: Number(raw.y),
        width: Number(raw.width),
        height: Number(raw.height),
      });
    }
  });

  const parsedShapes: Shape[] = [];
  const groupCounts = new Map<string, number>();
  const zValues = new Set<number>();
  shapes.forEach((raw, index) => {
    const path = `shapes[${index}]`;
    const id = checkId(raw.id, path);
    if (!isSystemKindId(raw.kind)) fields[`${path}.kind`] = 'invalid';
    if (typeof raw.label !== 'string' || raw.label.length > 200) fields[`${path}.label`] = 'invalid';
    if (!isCoordinate(raw.x)) fields[`${path}.x`] = 'invalid';
    if (!isCoordinate(raw.y)) fields[`${path}.y`] = 'invalid';
    if (!isInteger(raw.width) || raw.width < 16 || raw.width > 4000) fields[`${path}.width`] = 'invalid';
    if (!isInteger(raw.height) || raw.height < 16 || raw.height > 4000) fields[`${path}.height`] = 'invalid';
    if (!isInteger(raw.z)) fields[`${path}.z`] = 'invalid';
    else if (zValues.has(raw.z)) fields[`${path}.z`] = 'duplicate';
    else zValues.add(raw.z);
    const groupId = raw.groupId === undefined ? null : raw.groupId;
    if (groupId !== null && (typeof groupId !== 'string' || !ID_PATTERN.test(groupId))) {
      fields[`${path}.groupId`] = 'invalid';
    } else if (typeof groupId === 'string') {
      groupCounts.set(groupId, (groupCounts.get(groupId) ?? 0) + 1);
    }
    if (id && isSystemKindId(raw.kind) && typeof raw.label === 'string') {
      parsedShapes.push({
        id,
        kind: raw.kind,
        label: raw.label,
        x: Number(raw.x),
        y: Number(raw.y),
        width: Number(raw.width),
        height: Number(raw.height),
        z: Number(raw.z),
        groupId: typeof groupId === 'string' ? groupId : null,
      });
    }
  });

  shapes.forEach((raw, index) => {
    if (typeof raw.groupId === 'string' && (groupCounts.get(raw.groupId) ?? 0) < 2) {
      fields[`shapes[${index}].groupId`] = 'lonely_group';
    }
  });

  const parsedConnectors: Connector[] = [];
  connectors.forEach((raw, index) => {
    const path = `connectors[${index}]`;
    const id = checkId(raw.id, path);
    if (typeof raw.label !== 'string' || raw.label.length > 200) fields[`${path}.label`] = 'invalid';
    const from = typeof raw.from === 'object' && raw.from !== null ? (raw.from as Record<string, unknown>) : null;
    const to = typeof raw.to === 'object' && raw.to !== null ? (raw.to as Record<string, unknown>) : null;
    if (!from || typeof from.shapeId !== 'string' || !isPort(from.port)) fields[`${path}.from`] = 'invalid';
    if (!to || typeof to.shapeId !== 'string' || !isPort(to.port)) fields[`${path}.to`] = 'invalid';
    const points = Array.isArray(raw.points) ? raw.points : null;
    let validPoints = points !== null && points.length >= 2;
    if (points) {
      for (const point of points) {
        if (!Array.isArray(point) || point.length !== 2 || !isCoordinate(point[0]) || !isCoordinate(point[1])) {
          validPoints = false;
          break;
        }
      }
    }
    if (!validPoints) fields[`${path}.points`] = 'invalid';
    if (
      id &&
      from &&
      to &&
      typeof from.shapeId === 'string' &&
      typeof to.shapeId === 'string' &&
      isPort(from.port) &&
      isPort(to.port) &&
      validPoints &&
      points &&
      typeof raw.label === 'string'
    ) {
      parsedConnectors.push({
        id,
        label: raw.label,
        from: { shapeId: from.shapeId, port: from.port },
        to: { shapeId: to.shapeId, port: to.port },
        points: points.map((point) => [Number((point as number[])[0]), Number((point as number[])[1])] as [number, number]),
      });
    }
  });

  for (let i = 0; i < parsedZones.length; i += 1) {
    for (let j = i + 1; j < parsedZones.length; j += 1) {
      const a = parsedZones[i];
      const b = parsedZones[j];
      if (a && b && zonesOverlap(a, b)) fields[`zones[${j}]`] = 'overlap';
    }
  }

  if (Object.keys(fields).length > 0) return { error: 'validation', fields };

  const doc: PageDocument = {
    id: record.id as string,
    name: record.name as string,
    version: record.version as number,
    zones: parsedZones,
    shapes: parsedShapes,
    connectors: parsedConnectors,
  };

  const dangling = danglingConnectorFields(doc);
  if (Object.keys(dangling).length > 0) return { error: 'dangling_connector', fields: dangling };
  return { doc };
}

/** Connectors must start and end on their shapes' ports and stay orthogonal. */
export function danglingConnectorFields(doc: PageDocument): Record<string, string> {
  const fields: Record<string, string> = {};
  const shapeById = new Map(doc.shapes.map((shape) => [shape.id, shape]));
  doc.connectors.forEach((connector, index) => {
    const path = `connectors[${index}]`;
    const source = shapeById.get(connector.from.shapeId);
    const target = shapeById.get(connector.to.shapeId);
    if (!source || !target) {
      fields[path] = 'missing_shape';
      return;
    }
    const start = portPoint(source, connector.from.port);
    const end = portPoint(target, connector.to.port);
    const first = connector.points[0];
    const last = connector.points[connector.points.length - 1];
    if (!first || first[0] !== start.x || first[1] !== start.y) {
      fields[path] = 'start_off_port';
      return;
    }
    if (!last || last[0] !== end.x || last[1] !== end.y) {
      fields[path] = 'end_off_port';
      return;
    }
    for (let i = 1; i < connector.points.length; i += 1) {
      const a = connector.points[i - 1];
      const b = connector.points[i];
      if (!a || !b) continue;
      if (a[0] !== b[0] && a[1] !== b[1]) {
        fields[path] = 'not_orthogonal';
        return;
      }
    }
  });
  return fields;
}
