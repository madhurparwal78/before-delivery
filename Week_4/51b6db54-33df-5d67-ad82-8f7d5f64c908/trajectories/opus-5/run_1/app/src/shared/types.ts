export type Tool =
  | 'pencil'
  | 'eraser'
  | 'line'
  | 'rectangle'
  | 'ellipse'
  | 'fill'
  | 'dither'
  | 'selection'
  | 'picker';

export type StrokeTool = Exclude<Tool, 'selection' | 'picker'>;

export type MirrorMode = 'none' | 'x' | 'y' | 'both';

export type Blend = 'normal' | 'multiply';

export type Role = 'owner' | 'editor' | 'reviewer';

export type NumberFormat = 'en-US' | 'en-IN';

export type TimeZone = 'UTC' | 'Asia/Kolkata' | 'America/New_York';

export type TagDirection = 'forward' | 'reverse' | 'pingpong';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StrokeOptions {
  filled?: boolean;
  contiguous?: boolean;
  secondary?: number;
  level?: number;
  pixel_perfect?: boolean;
}

export interface StrokeRequest {
  client_stroke_id: string;
  frame: number;
  layer: string;
  tool: StrokeTool;
  points: [number, number][];
  swatch: number;
  size: number;
  mirror: MirrorMode;
  options: StrokeOptions;
}

export type SelectionOp = 'move' | 'paste' | 'flip_h' | 'flip_v' | 'rotate';

export interface SelectionRequest {
  client_stroke_id: string;
  frame: number;
  layer: string;
  op: SelectionOp;
  rect: Rect;
  to?: Point;
  rows?: number[][];
}

/** One cel buffer of swatch indices, row major, origin at the top left. */
export interface Surface {
  width: number;
  height: number;
  indices: Uint8Array;
}

export interface LayerState {
  id: number;
  name: string;
  opacity: number;
  blend: Blend;
  visible: boolean;
  locked_by: string | null;
  position: number;
}

export interface SwatchState {
  index: number;
  color: string;
  version: number;
}

export interface TileCell {
  tile: number;
  flip_h: boolean;
  flip_v: boolean;
}
