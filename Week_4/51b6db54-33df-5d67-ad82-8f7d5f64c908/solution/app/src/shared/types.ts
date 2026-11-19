import type { Blend, Direction, Role } from './rules';
import type { MapCell } from './tiles';
import type { Tag } from './timeline';

export interface Counts {
  pixels: Record<number, number>;
  frames: Record<number, number>;
  uses: Record<number, Record<number, number>>;
}

export interface LayerInfo {
  id: number;
  name: string;
  opacity: number;
  blend: Blend;
  visible: boolean;
  locked_by: string | null;
  position: number;
}

export interface FrameInfo {
  id: number;
  duration_ms: number;
}

export interface SwatchInfo {
  index: number;
  color: string;
  version: number;
  edited_by: string | null;
  removed?: boolean;
}

export interface TilesetInfo {
  id: number;
  name: string;
  tile_size: number;
  edge_table: number[];
  /** tiles[n - 1] is tile n as rows of swatch indices. */
  tiles: number[][][];
}

export interface TilemapInfo {
  id: number;
  tileset: number;
  name: string;
  width: number;
  height: number;
  cells: MapCell[];
}

export interface MentionInfo {
  name: string;
  state: 'pending' | 'delivered';
}

export interface CommentInfo {
  id: number;
  frame: number;
  x: number;
  y: number;
  text: string;
  state: 'open' | 'resolved';
  author: string;
  mentions: MentionInfo[];
}

export interface SnapshotInfo {
  id: number;
  name: string;
  seq: number;
  at: string;
}

/** What one sequenced operation changed, in a form the browser applies without asking again. */
export interface Patch {
  /** Cel changes: [buffer, cell index, swatch index]. */
  cells?: [number, number, number][];
  buffers?: { id: number; data?: string }[];
  cels?: { frame: number; layer: number; buffer: number }[];
  layers?: LayerInfo[];
  frames?: FrameInfo[];
  tags?: Tag[];
  swatches?: SwatchInfo[];
  order?: number[];
  counts?: Counts;
  tilesets?: Omit<TilesetInfo, 'tiles'>[];
  tiles?: { tileset: number; number: number; rows: number[][] }[];
  tilemaps?: Omit<TilemapInfo, 'cells'>[];
  mapCells?: { map: number; cells: MapCell[] }[];
  comment?: CommentInfo;
  snapshot?: SnapshotInfo;
  /** Set when the change is too wide to patch: reload the workspace. */
  refresh?: boolean;
  /** The stroke id of the stroke or selection operation this event carries. */
  csid?: string;
  actor?: number;
  /** A swatch edit: where the colour floods from. */
  flood?: { index: number; color: string; cursor: [number, number]; used_by: number; frames: number };
  /** A banner for everyone's page: a merge down or a restore. */
  notice?: { kind: 'merged'; layer: string; count: number } | { kind: 'restored'; name: string };
}

export interface SpriteEvent {
  seq: number;
  type: string;
  by: string;
  at: string;
  data: Patch;
}

export interface PresenceEntry {
  id: number;
  name: string;
  joined: number;
  lastActive: number;
  cursor: { x: number; y: number; frame: number } | null;
}

export interface Workspace {
  sprite: { id: number; name: string; width: number; height: number; seq: number; palette: number; project: { id: number; name: string } };
  role: Role;
  me: { id: number; name: string };
  layers: LayerInfo[];
  frames: FrameInfo[];
  cels: { frame: number; layer: number; buffer: number }[];
  buffers: { id: number; data: string }[];
  swatches: SwatchInfo[];
  order: number[];
  counts: Counts;
  tags: Tag[];
  tilesets: TilesetInfo[];
  tilemaps: TilemapInfo[];
  comments: CommentInfo[];
  snapshots: SnapshotInfo[];
  now: number;
}

export interface Config {
  now: string;
  palette_max: number;
  sprite_max: number;
  frame_min_ms: number;
  frame_max_ms: number;
  invite_ttl_seconds: number;
  long_press_ms: number;
  presence_visible: number;
  idle_seconds: number;
  undo_depth: number;
  activity_page: number;
  autosave_ms: number;
  job_item_ms: number;
  import_max_bytes: number;
}

export interface JobState {
  state: 'queued' | 'rendering' | 'stored' | 'failed' | 'cancelled';
  done: number;
  total: number;
  files: { name: string; size: number; sha256: string }[];
}

export type { Direction };
