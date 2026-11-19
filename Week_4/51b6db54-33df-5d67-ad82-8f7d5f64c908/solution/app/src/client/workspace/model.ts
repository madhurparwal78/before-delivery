import { colourTable, compositeFrame, compositeHash } from '../../shared/composite';
import type { Point, Writes } from '../../shared/engine';
import { counted, formatNumber, type Locale } from '../../shared/format';
import type { MapCell } from '../../shared/tiles';
import type { Mirror, Role, Tool } from '../../shared/rules';
import type { Tag } from '../../shared/timeline';
import type { CommentInfo, Counts, FrameInfo, JobState, LayerInfo, PresenceEntry, SnapshotInfo, SwatchInfo, TilemapInfo, TilesetInfo, Workspace } from '../../shared/types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FloatingSelection extends Rect {
  origin: Rect;
  rows: number[][];
}

/** A stroke or selection operation drawn locally and waiting for the server to sequence it. */
export interface PendingStroke {
  csid: string;
  kind: 'stroke' | 'selection';
  path: string;
  body: Record<string, unknown>;
  celKey: string;
  writes: Writes;
  /** True once the server has accepted it; it stays drawn until its event arrives. */
  sent: boolean;
}

export interface FloodState {
  index: number;
  oldColor: string;
  newColor: string;
  cursor: Point;
  fromCount: number;
  maxRadius: number;
  radius: number;
  /** True while the rings are still growing. */
  rings: boolean;
  thumbsDone: number;
  seq: number;
}

export interface CursorEntry {
  id: number;
  name: string;
  x: number;
  y: number;
  frame: number;
  lastActive: number;
}

type Listener = () => void;

/** Everything the workspace shows: the sequenced document, the person's view of it, and what is waiting to sync. */
export class Model {
  readonly spriteId: number;
  readonly width: number;
  readonly height: number;
  spriteName: string;
  projectId: number;
  projectName: string;
  role: Role;
  readonly me: { id: number; name: string };
  locale: Locale;
  paletteId: number;
  seq: number;

  layers: LayerInfo[] = [];
  frames: FrameInfo[] = [];
  cels = new Map<string, number>();
  buffers = new Map<number, Uint8Array>();
  swatches: SwatchInfo[] = [];
  order: number[] = [];
  counts: Counts = { pixels: {}, frames: {}, uses: {} };
  tags: Tag[] = [];
  tilesets: TilesetInfo[] = [];
  tilemaps: TilemapInfo[] = [];
  comments: CommentInfo[] = [];
  snapshots: SnapshotInfo[] = [];

  frameId = 0;
  layerId = 0;
  tool: Tool = 'pencil';
  primary = 1;
  secondary = 2;
  size = 1;
  mirror: Mirror = 'none';
  filled = false;
  contiguous = true;
  ditherLevel = 8;
  pixelPerfect = false;
  onion = { on: false, frames: 1 };
  zoom = 8;
  cursor: Point = [0, 0];
  drawing = false;
  anchor: Point | null = null;
  selection: Rect | null = null;
  floating: FloatingSelection | null = null;
  clipboard: number[][] | null = null;
  pinning = false;
  tilesetId = 0;
  tilemapId = 0;
  tileNumber = 1;
  edgeMatching = false;
  tileCursor: Point = [0, 0];
  stamp: MapCell[][] | null = null;
  rampSteps = 5;
  commentAt: { x: number; y: number; frame: number } | null = null;
  commandPaletteOpen = false;
  exportOpen = false;
  tileEditorOpen = false;
  job: { id: number; state: JobState } | null = null;

  pending: PendingStroke[] = [];
  online = navigator.onLine;
  syncLines: string[] = ['Synced'];
  presence: PresenceEntry[] = [];
  cursors = new Map<number, CursorEntry>();
  team: string[] = [];
  announcement = '';
  listAnnouncement = '';
  flood: FloodState | null = null;
  shownUsed = new Map<number, number>();
  thumbSeq = new Map<number, number>();
  /** Business clock: the server's instant when last told, and the local time it was told. */
  clockBase = { server: Date.now(), local: performance.now() };

  private readonly listeners = new Set<Listener>();
  private readonly stageListeners = new Set<Listener>();
  private docVersion = 0;
  private readonly frameVersion = new Map<number, number>();
  private cache = new Map<string, { version: string; rgba: Uint8Array }>();

  constructor(ws: Workspace, locale: Locale) {
    this.spriteId = ws.sprite.id;
    this.width = ws.sprite.width;
    this.height = ws.sprite.height;
    this.spriteName = ws.sprite.name;
    this.projectId = ws.sprite.project.id;
    this.projectName = ws.sprite.project.name;
    this.role = ws.role;
    this.me = ws.me;
    this.locale = locale;
    this.paletteId = ws.sprite.palette;
    this.seq = ws.sprite.seq;
    this.load(ws);
  }

  /** Takes a new layer list, keeping the active layer when it still exists. */
  setLayers(layers: LayerInfo[]): void {
    this.layers = layers;
    if (!layers.some((l) => l.id === this.layerId)) this.layerId = layers[0]?.id ?? 0;
  }

  /** Replaces the document with the server's state, keeping the person's view where it still makes sense. */
  load(ws: Workspace): void {
    this.seq = ws.sprite.seq;
    this.spriteName = ws.sprite.name;
    this.role = ws.role;
    this.frames = ws.frames;
    this.cels = new Map(ws.cels.map((c) => [`${c.frame}:${c.layer}`, c.buffer]));
    this.buffers = new Map(ws.buffers.map((b) => [b.id, Uint8Array.from(atob(b.data), (ch) => ch.charCodeAt(0))]));
    this.swatches = ws.swatches;
    this.order = ws.order;
    this.counts = ws.counts;
    this.tags = ws.tags;
    this.tilesets = ws.tilesets;
    this.tilemaps = ws.tilemaps;
    this.comments = ws.comments;
    this.snapshots = ws.snapshots;
    this.clockBase = { server: ws.now, local: performance.now() };
    if (!this.frames.some((f) => f.id === this.frameId)) this.frameId = this.frames[0]?.id ?? 0;
    this.setLayers(ws.layers);
    if (!this.tilesets.some((t) => t.id === this.tilesetId)) this.tilesetId = this.tilesets[0]?.id ?? 0;
    if (!this.tilemaps.some((t) => t.id === this.tilemapId)) this.tilemapId = this.tilemaps.find((t) => t.tileset === this.tilesetId)?.id ?? 0;
    this.primary = this.swatches.some((s) => s.index === this.primary) ? this.primary : (this.swatches[0]?.index ?? 0);
    if (!this.swatches.some((s) => s.index === this.secondary)) this.secondary = this.swatches[1]?.index ?? 0;
    this.shownUsed.clear();
    this.touchDocument();
  }

  // ---- change notification
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Stage listeners hear about drawing changes only, so cursor work never re-renders the panels. */
  subscribeStage(listener: Listener): () => void {
    this.stageListeners.add(listener);
    return () => void this.stageListeners.delete(listener);
  }

  changed(): void {
    this.listeners.forEach((listener) => listener());
    this.stageListeners.forEach((listener) => listener());
  }

  redrawStage(): void {
    this.stageListeners.forEach((listener) => listener());
  }

  // ---- document versions for the composite cache
  touchDocument(frameIds?: Iterable<number>): void {
    if (!frameIds) this.docVersion += 1;
    else for (const id of frameIds) this.frameVersion.set(id, (this.frameVersion.get(id) ?? 0) + 1);
    this.cache.clear();
  }

  framesUsing(buffer: number): number[] {
    return [...this.cels].filter(([, id]) => id === buffer).map(([key]) => Number(key.split(':')[0]));
  }

  // ---- derived
  get frameNumber(): number {
    return Math.max(1, this.frames.findIndex((f) => f.id === this.frameId) + 1);
  }

  get layer(): LayerInfo | undefined {
    return this.layers.find((l) => l.id === this.layerId);
  }

  get canEdit(): boolean {
    return this.role !== 'reviewer';
  }

  swatch(index: number): SwatchInfo | undefined {
    return this.swatches.find((s) => s.index === index);
  }

  businessNow(): number {
    return this.clockBase.server + (performance.now() - this.clockBase.local);
  }

  fmt = (value: number): string => formatNumber(value, this.locale.number_format);
  plural = (value: number, noun: string, many?: string): string => counted(value, noun, this.locale.number_format, many);

  private colours(override?: { index: number; color: string }): ReturnType<typeof colourTable> {
    return colourTable(this.swatches.map((s) => ({ index: s.index, color: override && override.index === s.index ? override.color : s.color })));
  }

  /** The cel buffer a frame and layer show: the sequenced one with local strokes laid over it. */
  celBuffer(frameId: number, layerId: number, withPending = true): Uint8Array | null {
    const key = `${frameId}:${layerId}`;
    const bufferId = this.cels.get(key);
    const base = bufferId === undefined ? null : (this.buffers.get(bufferId) ?? null);
    if (!withPending) return base;
    const target = bufferId ?? key;
    const mine = this.pending.filter((p) => (this.cels.get(p.celKey) ?? p.celKey) === target);
    if (mine.length === 0) return base;
    const copy = base ? base.slice() : new Uint8Array(this.width * this.height);
    for (const p of mine) for (const [at, value] of p.writes) copy[at] = value;
    return copy;
  }

  /** RGBA of a frame: final colours, or (during a flood) the old colour for the index outside the radius and for thumbs not yet changed. */
  frameRgba(frameId: number, mode: 'final' | 'stage' | 'thumb', frameIndex = 0): Uint8Array {
    const flood = this.flood;
    const old = flood && (mode === 'stage' || (mode === 'thumb' && frameIndex >= flood.thumbsDone));
    const version = `${this.docVersion}:${this.frameVersion.get(frameId) ?? 0}:${this.pending.length}:${this.pending.map((p) => p.csid).join(',')}:${old ? 'old' : 'new'}:${mode === 'stage' ? (flood?.radius ?? -1) : ''}`;
    const key = `${frameId}:${mode}`;
    const cached = this.cache.get(key);
    if (cached && cached.version === version) return cached.rgba;
    const stack = [...this.layers].reverse().map((layer) => ({ opacity: layer.opacity, blend: layer.blend, visible: layer.visible, cel: this.celBuffer(frameId, layer.id) }));
    const fresh = compositeFrame(this.width, this.height, stack, this.colours());
    let rgba = fresh;
    if (flood && old) {
      const before = compositeFrame(this.width, this.height, stack, this.colours({ index: flood.index, color: flood.oldColor }));
      rgba = mode === 'thumb' ? before : fresh.slice();
      if (mode === 'stage') {
        for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
            if (Math.max(Math.abs(x - flood.cursor[0]), Math.abs(y - flood.cursor[1])) > flood.radius) {
              const at = (y * this.width + x) * 4;
              rgba.set(before.subarray(at, at + 4), at);
            }
          }
        }
      }
    }
    this.cache.set(key, { version, rgba });
    return rgba;
  }

  hash(frameId = this.frameId): string {
    return compositeHash(this.frameRgba(frameId, 'final'));
  }

  /** The active layer's swatch index at a cell. */
  cellIndex(x: number, y: number): number {
    return this.celBuffer(this.frameId, this.layerId)?.[y * this.width + x] ?? 0;
  }

  colourAt(index: number): string {
    return index === 0 ? '00000000' : (this.swatch(index)?.color ?? '00000000');
  }

  announce(text: string): void {
    this.announcement = text;
    this.changed();
  }
}
