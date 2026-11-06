// Page-model rules: layer order, duplication, alignment, validation.

import {
  Connector, MAX_CONNECTORS, MAX_LABEL_LENGTH, MAX_NOTE_LENGTH, MAX_SHAPE_SIZE, MAX_SHAPES,
  MAX_ZONE_NAME, MAX_ZONE_SIZE, MAX_ZONES_PER_PAGE, MIN_SHAPE_SIZE, MIN_ZONE_SIZE,
  PageDocument, Shape, SystemKindId, SYSTEM_KIND_IDS, Zone, ZONE_KIND_IDS, ZoneKindId,
} from './types.js';
import { portPoint, zonesOverlap } from './geometry.js';

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isInteger(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n);
}

export function inRange(n: number, lo: number, hi: number): boolean {
  return n >= lo && n <= hi;
}

export function hasControlChar(s: string): boolean {
  return /[\u0000-\u001F\u007F]/.test(s);
}

// Plain-text fields: 1..N characters after trimming, no control characters.
export function validPlainText(s: unknown, max: number): boolean {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length < 1 || s.length > max) return false;
  return !hasControlChar(s);
}

// ---------------------------------------------------------------------------
// Layer order.

export interface LayerResult {
  shapes: Shape[];
  changed: boolean;
}

function sortedByZ(shapes: readonly Shape[]): Shape[] {
  return [...shapes].sort((a, b) => a.z - b.z);
}

// Bring forward / send backward, one shape or a selection. Returns the new
// shape list and whether anything moved. Zones are never layered.
export function changeLayer(page: Pick<PageDocument, 'shapes'>, ids: string[], forward: boolean): LayerResult {
  const selected = new Set(ids);
  const movable = sortedByZ(page.shapes).filter((s) => selected.has(s.id));
  if (movable.length === 0) return { shapes: [...page.shapes], changed: false };
  const order = forward ? [...movable].reverse() : [...movable];
  const working = [...page.shapes.map((s) => ({ ...s }))];
  const changedIds = new Set<string>();
  for (const shape of order) {
    const cur = sortedByZ(working);
    const idx = cur.findIndex((s) => s.id === shape.id);
    const neighbour = forward
      ? cur.slice(idx + 1).find((s) => !selected.has(s.id))
      : cur.slice(0, idx).reverse().find((s) => !selected.has(s.id));
    if (!neighbour) continue;
    const a = working.find((s) => s.id === shape.id);
    const b = working.find((s) => s.id === neighbour.id);
    if (a && b) { const t = a.z; a.z = b.z; b.z = t; changedIds.add(a.id); }
  }
  return { shapes: working, changed: changedIds.size > 0 };
}

// The 1-based position of a shape counted from the back.
export function layerPosition(page: Pick<PageDocument, 'shapes'>, shapeId: string): number {
  const cur = sortedByZ(page.shapes);
  return cur.findIndex((s) => s.id === shapeId) + 1;
}

// ---------------------------------------------------------------------------
// Validation of a whole page document.

export interface ValidationFieldErrors {
  [path: string]: string;
}

export function validatePage(page: PageDocument): ValidationFieldErrors | null {
  const errors: ValidationFieldErrors = {};
  const err = (path: string, problem: string) => { errors[path] = problem; };
  if (!ID_PATTERN.test(page.id)) err('id', 'invalid');
  if (!validPlainText(page.name, 80)) err('name', 'invalid');
  if (page.zones.length > MAX_ZONES_PER_PAGE) err('zones', 'too_many');
  if (page.shapes.length > MAX_SHAPES) err('shapes', 'too_many');
  if (page.connectors.length > MAX_CONNECTORS) err('connectors', 'too_many');

  const ids = new Set<string>();
  const claim = (id: string, path: string) => {
    if (!ID_PATTERN.test(id)) { err(path + '.id', 'invalid'); return; }
    if (ids.has(id)) { err(path + '.id', 'duplicate'); return; }
    ids.add(id);
  };
  page.zones.forEach((z: Zone, i) => {
    const p = `zones.${i}`;
    claim(z.id, p);
    if (!ZONE_KIND_IDS.includes(z.kind as ZoneKindId)) err(`${p}.kind`, 'invalid');
    if (!validPlainText(z.name, MAX_ZONE_NAME)) err(`${p}.name`, 'invalid');
    if (typeof z.note !== 'string' || z.note.length > MAX_NOTE_LENGTH) err(`${p}.note`, 'invalid');
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      if (!isInteger(z[key]) || !inRange(z[key], key === 'x' || key === 'y' ? -100000 : key === 'width' ? MIN_ZONE_SIZE : MIN_ZONE_SIZE, key === 'x' || key === 'y' ? 100000 : MAX_ZONE_SIZE)) err(`${p}.${key}`, 'invalid');
    }
  });
  page.shapes.forEach((s, i) => {
    const p = `shapes.${i}`;
    claim(s.id, p);
    if (!SYSTEM_KIND_IDS.includes(s.kind as SystemKindId)) err(`${p}.kind`, 'invalid');
    if (typeof s.label !== 'string' || s.label.length > MAX_LABEL_LENGTH) err(`${p}.label`, 'invalid');
    for (const key of ['x', 'y'] as const) {
      if (!isInteger(s[key]) || !inRange(s[key], -100000, 100000)) err(`${p}.${key}`, 'invalid');
    }
    for (const key of ['width', 'height'] as const) {
      if (!isInteger(s[key]) || !inRange(s[key], MIN_SHAPE_SIZE, MAX_SHAPE_SIZE)) err(`${p}.${key}`, 'invalid');
    }
    if (!isInteger(s.z)) err(`${p}.z`, 'invalid');
    if (s.groupId !== null && typeof s.groupId !== 'string') err(`${p}.groupId`, 'invalid');
  });
  const groups = new Map<string, number>();
  for (const s of page.shapes) {
    if (s.groupId !== null) groups.set(s.groupId, (groups.get(s.groupId) ?? 0) + 1);
  }
  for (const [gid, count] of groups) if (count < 2) {
    const i = page.shapes.findIndex((s) => s.groupId === gid);
    err(`shapes.${i}.groupId`, 'orphan');
  }
  const zs = new Set<number>();
  for (const s of page.shapes) {
    if (zs.has(s.z)) {
      const i = page.shapes.findIndex((o) => o.z === s.z);
      err(`shapes.${i}.z`, 'duplicate');
    }
    zs.add(s.z);
  }
  for (let i = 0; i < page.zones.length; i++) {
    for (let j = i + 1; j < page.zones.length; j++) {
      if (zonesOverlap(page.zones[i], page.zones[j])) {
        err(`zones.${j}`, 'overlap');
      }
    }
  }
  return Object.keys(errors).length ? errors : null;
}

// Connectors must start and end on their shapes' ports, with orthogonal
// segments. Returns dangling connector ids, or null when all are attached.
export function danglingConnectors(page: PageDocument): string[] | null {
  const bad: string[] = [];
  const shapeById = new Map(page.shapes.map((s) => [s.id, s] as const));
  page.connectors.forEach((c: Connector) => {
    const from = shapeById.get(c.from?.shapeId);
    const to = shapeById.get(c.to?.shapeId);
    if (!from || !to || !c.points || c.points.length < 2) { bad.push(c.id); return; }
    try {
      const fp = portPoint(from, c.from.port);
      const tp = portPoint(to, c.to.port);
      if (fp[0] !== c.points[0][0] || fp[1] !== c.points[0][1]) { bad.push(c.id); return; }
      if (tp[0] !== c.points[c.points.length - 1][0] || tp[1] !== c.points[c.points.length - 1][1]) { bad.push(c.id); return; }
      for (let k = 0; k + 1 < c.points.length; k++) {
        const a = c.points[k];
        const b = c.points[k + 1];
        if (a[0] !== b[0] && a[1] !== b[1]) { bad.push(c.id); return; }
      }
    } catch {
      bad.push(c.id);
    }
  });
  return bad.length ? bad : null;
}
