// The shared shape of workspace state, so the workspace and panel modules agree.
export interface Swatch { index: number; color: string; version: number; used_by: number; frames: number; edited_by: string | null }
export interface Palette { id: number; order: number[]; swatches: Swatch[] }
export interface Layer { id: number; name: string; opacity: number; blend: string; visible: boolean; locked_by: number | null; position: number }
export interface Frame { number: number; duration_ms: number; linked_layers: number[] }
export interface Tag { id: number; name: string; from: number; to: number; direction: 'forward' | 'reverse' | 'pingpong'; repeat: number }
export interface SpriteInfo { id: number; project_id?: number; name: string; width: number; height: number; seq: number; palette: number; layers: Layer[]; frames: Frame[]; tags: Tag[]; tilesets: number[]; tilemaps: number[] }
export interface Comment { id: number; frame: number; x: number; y: number; text: string; state: string; author: string; mentions: { name: string; state: string }[] }
export interface SnapshotRow { id: number; name: string; seq: number; at: string }
export interface Tileset { id: number; name: string; tile_size: number; edge_table: number[]; tiles: { id: number; rows: number[][]; uses: number }[] }
export interface Tilemap { id: number; name: string; tileset: number; width: number; height: number; cells: { x: number; y: number; tile: number; flip_h: boolean; flip_v: boolean }[]; seq: number }
export interface Me { id: number; email: string; name: string; number_format: string; time_zone: string }

export type Tool = 'pencil' | 'eraser' | 'line' | 'rectangle' | 'ellipse' | 'fill' | 'dither' | 'selection' | 'picker';

export interface StrokeRequest {
  client_stroke_id: string;
  frame: number;
  layer: number;
  tool: string;
  points: [number, number][];
  swatch: number;
  size: number;
  mirror: string;
  options: Record<string, unknown>;
  localCells: [number, number, number][];
}

export interface State {
  sprite: SpriteInfo;
  palette: Palette;
  cels: Map<string, number[][]>;
  frame: number;
  activeLayerId: number;
  tool: Tool;
  mirror: 'none' | 'x' | 'y' | 'both';
  size: number;
  primary: number;
  secondary: number;
  filled: boolean;
  contiguous: boolean;
  ditherLevel: number;
  pixelPerfect: boolean;
  onion: boolean;
  onionFrames: number;
  zoom: number;
  cursor: { x: number; y: number };
  drawing: boolean;
  selection: { x: number; y: number; w: number; h: number } | null;
  floating: { x: number; y: number; w: number; h: number } | null;
  copied: number[][] | null;
  corner: { x: number; y: number } | null;
  seq: number;
  strokeQueue: StrokeRequest[];
  offline: boolean;
  tilesets: Tileset[];
  tilemaps: Tilemap[];
  selectedTileset: number | null;
  selectedTilemap: number | null;
  selectedTile: number;
  edgeMatching: boolean;
  stamp: { w: number; h: number; cells: { tile: number; flip_h: boolean; flip_v: boolean }[][] } | null;
  comments: Comment[];
  snapshots: SnapshotRow[];
  presence: { name: string; idle: boolean }[];
  me: Me | null;
  role: string;
  floodRadius: number | null;
  floodSwatch: { index: number; color: string } | null;
  cursors: Map<string, { person: string; x: number; y: number; frame: number }>;
  thumbSeq: Map<number, number>;
  lastStrokeAt: number;
  strokeCountByPerson: Map<string, { count: number; timer: number | undefined }>;
}
