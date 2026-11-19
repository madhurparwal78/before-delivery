import { compositeFrame, compositeHash, type CompositeLayer } from '../../shared/composite.js';
import { strokeWrites, type StrokeShape } from '../../shared/draw.js';
import { selectionWrites, type SelectionShape } from '../../shared/selection.js';
import type {
  Blend,
  MirrorMode,
  Rect,
  SelectionOp,
  StrokeOptions,
  StrokeTool,
  Surface,
  TagDirection,
  Tool,
} from '../../shared/types.js';
import { api, refusalText, type ApiFailure, type ApiResult } from '../api.js';

export interface LayerView {
  id: number;
  name: string;
  opacity: number;
  blend: Blend;
  visible: boolean;
  locked_by: string | null;
  position: number;
}

export interface FrameView {
  number: number;
  duration_ms: number;
  linked_layers: string[];
}

export interface TagView {
  id: number;
  name: string;
  from: number;
  to: number;
  direction: TagDirection;
  repeat: number;
}

export interface SpriteView {
  id: number;
  name: string;
  width: number;
  height: number;
  seq: number;
  palette: number;
  layers: LayerView[];
  frames: FrameView[];
  tags: TagView[];
  tilesets: number[];
  tilemaps: number[];
}

export interface SwatchView {
  index: number;
  color: string;
  version: number;
  used_by: number;
  frames: number;
  edited_by: string | null;
}

export interface PaletteView {
  id: number;
  order: number[];
  swatches: SwatchView[];
}

export interface QueuedStroke {
  path: string;
  body: Record<string, unknown>;
}

export interface Model {
  spriteId: number;
  projectId: number;
  role: string;
  sprite: SpriteView;
  palette: PaletteView;
  cels: Map<number, Map<string, Uint8Array>>;
  activeFrame: number;
  activeLayer: string;
  primary: number;
  secondary: number;
  tool: Tool;
  brushSize: number;
  mirror: MirrorMode;
  pixelPerfect: boolean;
  filled: boolean;
  contiguous: boolean;
  ditherLevel: number;
  onionSkin: boolean;
  onionFrames: number;
  zoom: number;
  cursor: { x: number; y: number };
  selection: Rect | null;
  floating: { rect: Rect; cells: number[][]; origin: Rect } | null;
  clipboard: number[][] | null;
  queue: QueuedStroke[];
  thumbSeq: Map<number, number>;
}

export function colourMapOf(palette: PaletteView): Map<number, string> {
  return new Map(palette.swatches.map((swatch) => [swatch.index, swatch.color]));
}

export function surfaceFor(model: Model, frame: number, layer: string): Surface {
  const byLayer = model.cels.get(frame);
  const indices = byLayer?.get(layer);
  return {
    width: model.sprite.width,
    height: model.sprite.height,
    indices:
      indices ?? new Uint8Array(model.sprite.width * model.sprite.height),
  };
}

/** The composite the stage shows and hashes, by the published integer rules. */
export function compositeOf(
  model: Model,
  frame: number,
  colours: Map<number, string> = colourMapOf(model.palette),
): Uint8Array {
  const layers: CompositeLayer[] = [...model.sprite.layers]
    .sort((l, r) => r.position - l.position)
    .map((layer) => ({
      surface: surfaceFor(model, frame, layer.name),
      opacity: layer.opacity,
      blend: layer.blend,
      visible: layer.visible,
    }));
  return compositeFrame(layers, colours, model.sprite.width, model.sprite.height);
}

export function hashOf(model: Model, frame: number): string {
  return compositeHash(compositeOf(model, frame));
}

export function colourText(model: Model, index: number): string {
  if (index === 0) return '00000000';
  return model.palette.swatches.find((swatch) => swatch.index === index)?.color ?? '00000000';
}

function decodeCels(
  body: { width: number; height: number; frames: { number: number; layers: Record<string, string> }[] },
): Map<number, Map<string, Uint8Array>> {
  const out = new Map<number, Map<string, Uint8Array>>();
  for (const frame of body.frames) {
    const byLayer = new Map<string, Uint8Array>();
    for (const [name, data] of Object.entries(frame.layers)) {
      const binary = atob(data);
      const indices = new Uint8Array(binary.length);
      for (let at = 0; at < binary.length; at += 1) indices[at] = binary.charCodeAt(at);
      byLayer.set(name, indices);
    }
    out.set(frame.number, byLayer);
  }
  return out;
}

export async function loadModel(spriteId: number, projectId: number, role: string): Promise<Model | null> {
  const sprite = await api.get<SpriteView>(`/api/sprites/${spriteId}`);
  if (!sprite.ok) return null;
  const palette = await api.get<PaletteView>(`/api/palettes/${sprite.body.palette}`);
  const cels = await api.get<{
    width: number;
    height: number;
    seq: number;
    frames: { number: number; layers: Record<string, string> }[];
  }>(`/api/sprites/${spriteId}/cels`);
  const layers = sprite.body.layers;
  const swatches = palette.ok ? palette.body.swatches : [];
  return {
    spriteId,
    projectId,
    role,
    sprite: sprite.body,
    palette: palette.ok ? palette.body : { id: sprite.body.palette, order: [], swatches: [] },
    cels: cels.ok ? decodeCels(cels.body) : new Map(),
    activeFrame: 1,
    activeLayer: layers[0]?.name ?? 'Layer 1',
    primary: swatches.length >= 1 ? swatches[0].index : 0,
    secondary: swatches.length >= 2 ? swatches[1].index : 0,
    tool: 'pencil',
    brushSize: 1,
    mirror: 'none',
    pixelPerfect: false,
    filled: false,
    contiguous: true,
    ditherLevel: 8,
    onionSkin: false,
    onionFrames: 1,
    zoom: 8,
    cursor: { x: 0, y: 0 },
    selection: null,
    floating: null,
    clipboard: null,
    queue: [],
    thumbSeq: new Map(),
  };
}

export async function refreshModel(model: Model): Promise<void> {
  const sprite = await api.get<SpriteView>(`/api/sprites/${model.spriteId}`);
  if (sprite.ok) {
    model.sprite = sprite.body;
    if (!sprite.body.layers.some((layer) => layer.name === model.activeLayer)) {
      model.activeLayer = sprite.body.layers[0]?.name ?? 'Layer 1';
    }
    model.activeFrame = Math.min(model.activeFrame, Math.max(1, sprite.body.frames.length));
  }
  const palette = await api.get<PaletteView>(`/api/palettes/${model.sprite.palette}`);
  if (palette.ok) model.palette = palette.body;
  const cels = await api.get<{
    width: number;
    height: number;
    seq: number;
    frames: { number: number; layers: Record<string, string> }[];
  }>(`/api/sprites/${model.spriteId}/cels`);
  if (cels.ok) model.cels = decodeCels(cels.body);
}

export interface StrokeOutcome {
  applied: boolean;
  seq: number;
  pixels: number;
  refusal: string | null;
  queued: boolean;
}

function applyWrites(model: Model, frame: number, layer: string, writes: Map<number, number>): Uint8Array {
  const byLayer = model.cels.get(frame) ?? new Map<string, Uint8Array>();
  const held = byLayer.get(layer) ?? new Uint8Array(model.sprite.width * model.sprite.height);
  const before = new Uint8Array(held);
  for (const [offset, index] of writes) held[offset] = index;
  byLayer.set(layer, held);
  model.cels.set(frame, byLayer);
  const linked = model.sprite.frames.find((entry) => entry.number === frame)?.linked_layers ?? [];
  if (linked.includes(layer)) {
    for (const entry of model.sprite.frames) {
      if (entry.number === frame || !entry.linked_layers.includes(layer)) continue;
      const other = model.cels.get(entry.number);
      if (other !== undefined) other.set(layer, held);
    }
  }
  return before;
}

function restore(model: Model, frame: number, layer: string, before: Uint8Array): void {
  const byLayer = model.cels.get(frame);
  if (byLayer === undefined) return;
  byLayer.set(layer, before);
}

let strokeCounter = 0;
export function nextStrokeId(): string {
  strokeCounter += 1;
  return `stroke-${Date.now()}-${strokeCounter}`;
}

export interface SendOptions {
  tool: StrokeTool;
  points: { x: number; y: number }[];
  options?: StrokeOptions;
  swatch?: number;
}

/** A local stroke draws at once and is rolled back if the server refuses it. */
export async function sendStroke(model: Model, request: SendOptions): Promise<StrokeOutcome> {
  const swatch = request.swatch ?? model.primary;
  const shape: StrokeShape = {
    tool: request.tool,
    points: request.points,
    swatch,
    size: request.tool === 'rectangle' || request.tool === 'ellipse' ? 1 : model.brushSize,
    mirror: model.mirror,
    options: {
      filled: model.filled,
      contiguous: model.contiguous,
      secondary: model.secondary,
      level: model.ditherLevel,
      pixel_perfect: model.pixelPerfect,
      ...(request.options ?? {}),
    },
  };
  const frame = model.activeFrame;
  const layer = model.activeLayer;
  const writes = strokeWrites(shape, surfaceFor(model, frame, layer));
  const before = applyWrites(model, frame, layer, writes);
  let changed = 0;
  for (const [offset, index] of writes) if (before[offset] !== index) changed += 1;

  const body = {
    client_stroke_id: nextStrokeId(),
    frame,
    layer,
    tool: shape.tool,
    points: request.points.map((point) => [point.x, point.y]),
    swatch,
    size: shape.size,
    mirror: shape.mirror,
    options: shape.options,
  };
  const path = `/api/sprites/${model.spriteId}/strokes`;
  if (!navigator.onLine) {
    model.queue.push({ path, body });
    return { applied: true, seq: model.sprite.seq, pixels: changed, refusal: null, queued: true };
  }
  const result = await api.post<ApiFailure & { seq: number; pixels_changed: number }>(path, body);
  if (!result.ok) {
    restore(model, frame, layer, before);
    return {
      applied: false,
      seq: model.sprite.seq,
      pixels: 0,
      refusal: refusalText(result as ApiResult<ApiFailure>),
      queued: false,
    };
  }
  model.sprite.seq = result.body.seq;
  return { applied: true, seq: result.body.seq, pixels: result.body.pixels_changed, refusal: null, queued: false };
}

export async function sendSelection(
  model: Model,
  op: SelectionOp,
  rect: Rect,
  to?: { x: number; y: number },
  rows?: number[][],
): Promise<StrokeOutcome> {
  const shape: SelectionShape = { op, rect, to, rows };
  const frame = model.activeFrame;
  const layer = model.activeLayer;
  const result = selectionWrites(shape, surfaceFor(model, frame, layer));
  const before = applyWrites(model, frame, layer, result.writes);
  let changed = 0;
  for (const [offset, index] of result.writes) if (before[offset] !== index) changed += 1;
  const body = {
    client_stroke_id: nextStrokeId(),
    frame,
    layer,
    op,
    rect,
    to,
    rows,
  };
  const path = `/api/sprites/${model.spriteId}/selection`;
  if (!navigator.onLine) {
    model.queue.push({ path, body });
    model.selection = result.rect;
    return { applied: true, seq: model.sprite.seq, pixels: changed, refusal: null, queued: true };
  }
  const sent = await api.post<ApiFailure & { seq: number; pixels_changed: number }>(path, body);
  if (!sent.ok) {
    restore(model, frame, layer, before);
    return {
      applied: false,
      seq: model.sprite.seq,
      pixels: 0,
      refusal: refusalText(sent as ApiResult<ApiFailure>),
      queued: false,
    };
  }
  model.selection = result.rect;
  model.sprite.seq = sent.body.seq;
  return { applied: true, seq: sent.body.seq, pixels: sent.body.pixels_changed, refusal: null, queued: false };
}

export function applyStrokeEvent(
  model: Model,
  data: { frame: number; layer: string; frames: number[]; cells: [number, number, number][] },
): void {
  for (const frame of data.frames.length > 0 ? data.frames : [data.frame]) {
    const byLayer = model.cels.get(frame) ?? new Map<string, Uint8Array>();
    const held = byLayer.get(data.layer) ?? new Uint8Array(model.sprite.width * model.sprite.height);
    for (const [x, y, index] of data.cells) held[y * model.sprite.width + x] = index;
    byLayer.set(data.layer, held);
    model.cels.set(frame, byLayer);
  }
}
