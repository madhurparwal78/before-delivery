import { api, refusal } from '../api';
import { raise } from '../ui';
import { selectionWrites, strokeWrites, type Point, type StrokeOptions } from '../../shared/engine';
import { MIRRORS, ZOOMS, type SelectionOp, type StrokeTool, type Tool } from '../../shared/rules';
import type { Model, Rect } from './model';
import { queueStroke, sendCursor } from './sync';

export const randomId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

export const TOOL_LABEL: Record<Tool, string> = {
  pencil: 'Pencil',
  eraser: 'Eraser',
  line: 'Line',
  rectangle: 'Rectangle',
  ellipse: 'Ellipse',
  fill: 'Fill',
  dither: 'Dither',
  selection: 'Selection',
  picker: 'Picker',
};

const HOTKEY_TOOL: Record<string, Tool> = { b: 'pencil', e: 'eraser', l: 'line', r: 'rectangle', o: 'ellipse', g: 'fill', d: 'dither', s: 'selection', i: 'picker' };

const shape = (m: Model): { width: number; height: number } => ({ width: m.width, height: m.height });

export function pixelText(m: Model, x: number, y: number): string {
  return `Pixel ${x}, ${y}, ${m.colourAt(m.cellIndex(x, y))}, layer ${m.layer?.name ?? ''}`;
}

export function setCursor(m: Model, x: number, y: number, announce = true): void {
  const clamped: Point = [Math.max(0, Math.min(m.width - 1, x)), Math.max(0, Math.min(m.height - 1, y))];
  const moved = clamped[0] !== m.cursor[0] || clamped[1] !== m.cursor[1];
  m.cursor = clamped;
  if (announce) m.announcement = pixelText(m, clamped[0], clamped[1]);
  m.redrawStage();
  if (moved || announce) {
    m.changed();
    sendCursor(m);
  }
}

export function chooseTool(m: Model, tool: Tool): void {
  m.tool = tool;
  m.anchor = null;
  m.announce(`Tool: ${TOOL_LABEL[tool]}`);
}

export function strokeOptions(m: Model): StrokeOptions {
  return { filled: m.filled, contiguous: m.contiguous, secondary: m.secondary, level: m.ditherLevel, pixel_perfect: m.pixelPerfect };
}

/** Draws a stroke at once and queues it for the server, which computes the same pixels itself. */
export function commitStroke(m: Model, tool: StrokeTool, points: readonly Point[]): void {
  const layer = m.layer;
  if (!layer || !m.canEdit) return;
  const swatch = tool === 'eraser' ? 0 : m.primary;
  const options = strokeOptions(m);
  const cel = m.celBuffer(m.frameId, layer.id) ?? new Uint8Array(m.width * m.height);
  const writes = strokeWrites(cel, shape(m), { tool, points, swatch, size: m.size, mirror: m.mirror, options });
  const csid = randomId();
  queueStroke(m, {
    csid,
    kind: 'stroke',
    path: `/api/sprites/${m.spriteId}/strokes`,
    celKey: `${m.frameId}:${layer.id}`,
    writes,
    sent: false,
    body: { client_stroke_id: csid, frame: m.frameNumber, layer: layer.name, tool, points, swatch, size: m.size, mirror: m.mirror, options },
  });
}

export function commitSelection(m: Model, op: SelectionOp, rect: Rect, to?: Point, rows?: number[][]): void {
  const layer = m.layer;
  if (!layer || !m.canEdit) return;
  const cel = m.celBuffer(m.frameId, layer.id) ?? new Uint8Array(m.width * m.height);
  const input = { op, rect, to: to ? { x: to[0], y: to[1] } : undefined, rows };
  const writes = selectionWrites(cel, shape(m), input);
  const csid = randomId();
  queueStroke(m, {
    csid,
    kind: 'selection',
    path: `/api/sprites/${m.spriteId}/selection`,
    celKey: `${m.frameId}:${layer.id}`,
    writes,
    sent: false,
    body: { client_stroke_id: csid, frame: m.frameNumber, layer: layer.name, ...input },
  });
}

export function pick(m: Model, x: number, y: number): void {
  m.primary = m.cellIndex(x, y);
  m.announce(`Picked swatch ${m.primary}`);
}

export const rectOf = (a: Point, b: Point): Rect => ({
  x: Math.min(a[0], b[0]),
  y: Math.min(a[1], b[1]),
  w: Math.abs(a[0] - b[0]) + 1,
  h: Math.abs(a[1] - b[1]) + 1,
});

export const rectText = (r: Rect): string => `${r.x},${r.y},${r.w},${r.h}`;

/** Space on the stage: applies the active tool at the cursor. */
export function applyAtCursor(m: Model): void {
  const [x, y] = m.cursor;
  const tool = m.tool;
  if (tool === 'picker') return pick(m, x, y);
  if (tool === 'selection' || tool === 'line' || tool === 'rectangle' || tool === 'ellipse') {
    if (!m.anchor) {
      m.anchor = [x, y];
      return m.changed();
    }
    const anchor = m.anchor;
    m.anchor = null;
    if (tool === 'selection') {
      m.selection = rectOf(anchor, [x, y]);
      return m.changed();
    }
    commitStroke(m, tool, [anchor, [x, y]]);
  } else commitStroke(m, tool, [[x, y]]);
  m.announcement = pixelText(m, x, y);
  m.changed();
}

export function cycleMirror(m: Model): void {
  m.mirror = MIRRORS[(MIRRORS.indexOf(m.mirror) + 1) % MIRRORS.length] ?? 'none';
  m.announce(`Mirror: ${m.mirror}`);
}

export function swapSwatches(m: Model): void {
  [m.primary, m.secondary] = [m.secondary, m.primary];
  m.announce('Swatches swapped');
}

export function changeBrush(m: Model, delta: number): void {
  m.size = Math.max(1, Math.min(8, m.size + delta));
  m.announce(`Brush size ${m.size}`);
}

export function togglePixelPerfect(m: Model): void {
  m.pixelPerfect = !m.pixelPerfect;
  m.announce(`Pixel perfect ${m.pixelPerfect ? 'on' : 'off'}`);
}

export function showFrame(m: Model, frameId: number, announce = true): void {
  m.frameId = frameId;
  m.anchor = null;
  m.touchDocument([frameId]);
  if (announce) m.announce(`Frame ${m.frameNumber} of ${m.frames.length}`);
  else m.changed();
  sendCursor(m);
}

export function stepFrame(m: Model, delta: number): void {
  const target = m.frames[Math.max(0, Math.min(m.frames.length - 1, m.frameNumber - 1 + delta))];
  if (target) showFrame(m, target.id);
}

export function zoomBy(m: Model, direction: 1 | -1): void {
  const at = ZOOMS.indexOf(m.zoom as (typeof ZOOMS)[number]);
  m.zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, at + direction))] ?? 8;
  m.changed();
}

export function liftSelection(m: Model): void {
  const selection = m.selection;
  const layer = m.layer;
  if (!selection || !layer) return;
  const cel = m.celBuffer(m.frameId, layer.id);
  const rows = Array.from({ length: selection.h }, (_, r) => Array.from({ length: selection.w }, (_, c) => cel?.[(selection.y + r) * m.width + selection.x + c] ?? 0));
  m.floating = { ...selection, origin: selection, rows };
  m.announce(`Selection ${selection.w} by ${selection.h} at ${selection.x}, ${selection.y}`);
}

export function moveFloating(m: Model, dx: number, dy: number): void {
  const f = m.floating;
  if (!f) return;
  f.x = Math.max(-(f.w - 1), Math.min(m.width - 1, f.x + dx));
  f.y = Math.max(-(f.h - 1), Math.min(m.height - 1, f.y + dy));
  m.announce(`Selection ${f.w} by ${f.h} at ${f.x}, ${f.y}`);
}

export function commitFloating(m: Model): void {
  const f = m.floating;
  if (!f) return;
  m.floating = null;
  commitSelection(m, 'move', f.origin, [f.x, f.y]);
  m.selection = { x: f.x, y: f.y, w: f.w, h: f.h };
  m.announce(`Selection placed at ${f.x}, ${f.y}`);
}

export function cancelFloating(m: Model): void {
  m.floating = null;
  m.announce('Selection cancelled');
}

export function runSelectionOp(m: Model, op: SelectionOp): void {
  const selection = m.selection;
  if (!selection) return;
  if (op === 'move') {
    commitSelection(m, 'move', selection, m.cursor);
    m.selection = { ...selection, x: m.cursor[0], y: m.cursor[1] };
  } else if (op === 'paste') {
    const rows = m.clipboard;
    if (!rows) return;
    commitSelection(m, 'paste', selection, m.cursor, rows);
    m.selection = { x: m.cursor[0], y: m.cursor[1], w: rows[0]?.length ?? 1, h: rows.length };
  } else {
    commitSelection(m, op, selection);
    if (op === 'rotate') m.selection = { ...selection, w: selection.h, h: selection.w };
  }
  m.changed();
}

export function copySelection(m: Model): void {
  const selection = m.selection;
  const cel = m.celBuffer(m.frameId, m.layerId);
  if (!selection) return;
  m.clipboard = Array.from({ length: selection.h }, (_, r) => Array.from({ length: selection.w }, (_, c) => cel?.[(selection.y + r) * m.width + selection.x + c] ?? 0));
  m.changed();
}

export function pasteWithoutSelection(m: Model): void {
  const rows = m.clipboard;
  if (!rows) return;
  m.selection = { x: m.cursor[0], y: m.cursor[1], w: rows[0]?.length ?? 1, h: rows.length };
  runSelectionOp(m, 'paste');
}

async function stepHistory(m: Model, direction: 'undo' | 'redo'): Promise<void> {
  if (!m.online) return raise('You are offline');
  const result = await api('POST', `/api/sprites/${m.spriteId}/${direction}`);
  if (!result.ok) return raise(refusal(result).message);
  m.announce(direction === 'undo' ? 'Undone' : 'Redone');
}

export const undo = (m: Model): Promise<void> => stepHistory(m, 'undo');
export const redo = (m: Model): Promise<void> => stepHistory(m, 'redo');

export function openComment(m: Model, x: number, y: number): void {
  m.commentAt = { x, y, frame: m.frameNumber };
  m.pinning = false;
  m.changed();
}


/** Hotkeys that work from any non-text workspace control. Returns true when the key was used. */
export function hotkey(m: Model, event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (m.floating) return false;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const tool = HOTKEY_TOOL[key];
  if (tool && m.canEdit) chooseTool(m, tool);
  else if (key === 'm' && m.canEdit) cycleMirror(m);
  else if (key === 'x' && m.canEdit) swapSwatches(m);
  else if (key === '[' && m.canEdit) changeBrush(m, -1);
  else if (key === ']' && m.canEdit) changeBrush(m, 1);
  else if (key === ',') stepFrame(m, -1);
  else if (key === '.') stepFrame(m, 1);
  else if (key === 'p' && m.canEdit) togglePixelPerfect(m);
  else if (key === 'f' && m.canEdit) liftSelection(m);
  else if (key === 'c') openComment(m, m.cursor[0], m.cursor[1]);
  else return false;
  return true;
}

