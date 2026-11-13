import type { Entity, Pt, ResolvedEntity } from '../shared/geometry.js';
import { entityBounds } from '../shared/geometry.js';
import type { DrawingModel, LayerRecord, SheetRecord, ViewportRecord } from '../shared/model.js';

// ---------------------------------------------------------------------------
// Client store: the drawing state the page shows, plus the operation queue
// and the live socket.
// ---------------------------------------------------------------------------

export interface DrawingState {
  id: string;
  name: string;
  folderId: string;
  role: 'view' | 'markup' | 'edit' | 'manage';
  revision: number;
  nextHandle: number;
  layers: Record<string, LayerRecord>;
  entities: Record<string, ResolvedEntity>;
  order: string[];
  blocks: DrawingModel['blocks'];
  dimStyles: DrawingModel['dim_styles'];
  parameters: DrawingModel['parameters'];
  constraints: DrawingModel['constraints'];
  xrefs: DrawingModel['xrefs'];
  layerStates: DrawingModel['layer_states'];
  currentLayer: string;
  underlays: Array<{ id: string; key: string; bytes: number; x1: number; y1: number; x2: number; y2: number }>;
  sheets: Array<SheetRecord & { locked_by?: string | null }>;
}

export interface PendingOperation {
  op_id: string;
  type: string;
  [field: string]: unknown;
}

export interface QueuedGroup {
  group_id: string;
  command: string;
  base_revision: number;
  ops: PendingOperation[];
  optimistics: Array<{ handle: string; optimisticId: string | null }>;
}

export interface Selection {
  handles: string[];
}

export interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface AidsState {
  snap: boolean;
  ortho: boolean;
  grid: boolean;
  polar: boolean;
}

export const READY_PROMPT = 'Ready. Type a command.';

export interface Announcement {
  kind: 'drawing' | 'toast' | 'storage';
  text: string;
}

export function drawingFromApi(data: Record<string, unknown>): DrawingState {
  return {
    id: String(data.id),
    name: String(data.name ?? ''),
    folderId: String(data.folder_id ?? ''),
    role: (data.role as DrawingState['role']) ?? 'view',
    revision: Number(data.revision ?? 0),
    nextHandle: Number(data.next_handle ?? 1),
    layers: (data.layers as Record<string, LayerRecord>) ?? {},
    entities: (data.entities as Record<string, ResolvedEntity>) ?? {},
    order: (data.order as string[]) ?? Object.keys((data.entities as Record<string, ResolvedEntity>) ?? {}),
    blocks: (data.blocks as DrawingModel['blocks']) ?? {},
    dimStyles: (data.dim_styles as DrawingModel['dim_styles']) ?? {},
    parameters: (data.parameters as DrawingModel['parameters']) ?? [],
    constraints: (data.constraints as DrawingModel['constraints']) ?? [],
    xrefs: (data.xrefs as DrawingModel['xrefs']) ?? [],
    layerStates: (data.layer_states as DrawingModel['layer_states']) ?? [],
    currentLayer: String(data.current_layer ?? '0'),
    underlays: (data.underlays as DrawingState['underlays']) ?? [],
    sheets: (data.sheets as DrawingState['sheets']) ?? [],
  };
}

export function visibleEntities(state: DrawingState): string[] {
  return state.order.filter((handle) => {
    const entity = state.entities[handle];
    if (!entity) return false;
    const layer = state.layers[entity.layer];
    return Boolean(layer && layer.on && !layer.frozen);
  });
}

export function entityAtPoint(state: DrawingState, world: Pt, aperture: number, view: ViewState): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const handle of state.order) {
    const entity = state.entities[handle];
    if (!entity) continue;
    const layer = state.layers[entity.layer];
    if (!layer || layer.locked || layer.frozen || !layer.on) continue;
    const distance = distanceToEntity(entity, world);
    const screenDistance = distance * view.zoom;
    if (screenDistance <= aperture && screenDistance < bestDistance) {
      bestDistance = screenDistance;
      best = handle;
    }
  }
  return best;
}

function distanceToEntity(entity: ResolvedEntity, point: Pt): number {
  switch (entity.type) {
    case 'line':
      return distanceToSegment(point, { x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 });
    case 'circle': {
      return Math.abs(Math.hypot(point.x - entity.cx, point.y - entity.cy) - entity.r);
    }
    case 'arc': {
      const angle = normalise(Math.atan2(point.y - entity.cy, point.x - entity.cx));
      if (angle < entity.start || angle > entity.end) {
        const toStart = Math.hypot(point.x - (entity.cx + entity.r * Math.cos((entity.start * Math.PI) / 180)), point.y - (entity.cy + entity.r * Math.sin((entity.start * Math.PI) / 180)));
        const toEnd = Math.hypot(point.x - (entity.cx + entity.r * Math.cos((entity.end * Math.PI) / 180)), point.y - (entity.cy + entity.r * Math.sin((entity.end * Math.PI) / 180)));
        return Math.min(toStart, toEnd);
      }
      return Math.abs(Math.hypot(point.x - entity.cx, point.y - entity.cy) - entity.r);
    }
    case 'pline': {
      let best = Infinity;
      const points = entity.points;
      const last = entity.closed ? points.length : points.length - 1;
      for (let i = 0; i < last; i++) {
        best = Math.min(best, distanceToSegment(point, points[i], points[(i + 1) % points.length]));
      }
      return best;
    }
    case 'insert':
      return Math.hypot(point.x - entity.x, point.y - entity.y);
    case 'hatch':
      return Math.hypot(point.x - entity.seed_x, point.y - entity.seed_y);
    case 'dimension':
      return Math.hypot(point.x - entity.text_x, point.y - entity.text_y);
  }
}

function normalise(radians: number): number {
  let degrees = (radians * 180) / Math.PI;
  while (degrees < 0) degrees += 360;
  return degrees;
}

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

// The DOM ceiling: only entities whose box meets the grown view.
export function entityHandlesForDom(state: DrawingState, view: ViewState, paneWidth: number, paneHeight: number, marginPx: number, ceiling: number, selected: Set<string>): string[] {
  const grown = {
    minX: -view.panX / view.zoom - marginPx / view.zoom,
    maxX: (paneWidth - view.panX) / view.zoom + marginPx / view.zoom,
    minY: -(view.panY + paneHeight) / view.zoom - marginPx / view.zoom,
    maxY: (-view.panY + marginPx) / view.zoom,
  };
  const inside: Array<{ handle: string; distance: number }> = [];
  const centreX = (grown.minX + grown.maxX) / 2;
  const centreY = (grown.minY + grown.maxY) / 2;
  for (const handle of state.order) {
    const entity = state.entities[handle];
    if (!entity) continue;
    const box = entityBounds(entity);
    const meets = box.minX <= grown.maxX && box.maxX >= grown.minX && box.minY <= grown.maxY && box.maxY >= grown.minY;
    if (!meets) continue;
    const boxCentreX = (box.minX + box.maxX) / 2;
    const boxCentreY = (box.minY + box.maxY) / 2;
    inside.push({ handle, distance: Math.hypot(boxCentreX - centreX, boxCentreY - centreY) });
  }
  inside.sort((a, b) => a.distance - b.distance);
  const result: string[] = [];
  const picked = new Set<string>();
  for (const entry of inside) {
    if (result.length >= ceiling) break;
    result.push(entry.handle);
    picked.add(entry.handle);
  }
  for (const handle of selected) {
    if (!picked.has(handle) && state.entities[handle]) {
      result.push(handle);
      picked.add(handle);
    }
  }
  return result;
}

export function zoomAll(state: DrawingState, paneWidth: number, paneHeight: number): ViewState {
  const boundsList = visibleEntities(state).map((handle) => entityBounds(state.entities[handle]));
  if (!boundsList.length) {
    return { zoom: 1, panX: paneWidth / 2, panY: paneHeight / 2 };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const box of boundsList) {
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
  }
  const width = Math.max(maxX - minX, 1e-6);
  const height = Math.max(maxY - minY, 1e-6);
  const zoom = Math.min((paneWidth - 48) / width, (paneHeight - 48) / height);
  const clamped = Math.max(0.05, Math.min(50, zoom));
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;
  return {
    zoom: Number(clamped.toFixed(4)),
    panX: Number((paneWidth / 2 - centreX * clamped).toFixed(4)),
    panY: Number((paneHeight / 2 + centreY * clamped).toFixed(4)),
  };
}

export function applyOpToState(state: DrawingState, op: Record<string, unknown>): void {
  const type = String(op.type);
  switch (type) {
    case 'add': {
      const entity = op.entity as (ResolvedEntity & { handle?: string }) | undefined;
      if (!entity) return;
      const handle = entity.handle ?? `new-${state.nextHandle}`;
      const stored = { ...entity, handle } as ResolvedEntity;
      state.entities[handle] = stored;
      if (!state.order.includes(handle)) state.order.push(handle);
      state.nextHandle = Math.max(state.nextHandle, handleNumber(handle) + 1);
      return;
    }
    case 'modify': {
      const handle = String(op.handle ?? '');
      const set = (op.set ?? {}) as Record<string, unknown>;
      const existing = state.entities[handle];
      if (!existing) return;
      state.entities[handle] = { ...existing, ...(set as Partial<ResolvedEntity>) } as ResolvedEntity;
      return;
    }
    case 'move': {
      const handles = (op.handles ?? []) as string[];
      const dx = Number(op.dx ?? 0);
      const dy = Number(op.dy ?? 0);
      for (const handle of handles) {
        const existing = state.entities[handle];
        if (!existing) continue;
        state.entities[handle] = moveResolved(existing, dx, dy);
      }
      return;
    }
    case 'delete': {
      const handles = (op.handles ?? []) as string[];
      for (const handle of handles) {
        delete state.entities[handle];
        state.order = state.order.filter((h) => h !== handle);
      }
      return;
    }
    default:
      // Other operation types arrive through the ops message with full results.
      return;
  }
}

export function moveResolved(entity: ResolvedEntity, dx: number, dy: number): ResolvedEntity {
  switch (entity.type) {
    case 'line':
      return { ...entity, x1: round(entity.x1 + dx), y1: round(entity.y1 + dy), x2: round(entity.x2 + dx), y2: round(entity.y2 + dy) };
    case 'circle':
      return { ...entity, cx: round(entity.cx + dx), cy: round(entity.cy + dy) };
    case 'arc':
      return { ...entity, cx: round(entity.cx + dx), cy: round(entity.cy + dy) };
    case 'pline':
      return { ...entity, points: entity.points.map((p) => ({ x: round(p.x + dx), y: round(p.y + dy) })) };
    case 'insert':
      return { ...entity, x: round(entity.x + dx), y: round(entity.y + dy) };
    case 'hatch':
      return { ...entity, seed_x: round(entity.seed_x + dx), seed_y: round(entity.seed_y + dy) };
    case 'dimension':
      return { ...entity, text_x: round(entity.text_x + dx), text_y: round(entity.text_y + dy) };
  }
}

function round(value: number): number {
  const factor = 10 ** 6;
  const scaled = value * factor;
  const rounded = Math.abs(scaled) % 1 >= 0.5 ? Math.trunc(scaled) + Math.sign(scaled) : Math.trunc(scaled);
  return rounded / factor;
}

export function handleNumber(handle: string): number {
  const match = handle.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

export type { Entity, Pt, ResolvedEntity, LayerRecord, SheetRecord, ViewportRecord };
