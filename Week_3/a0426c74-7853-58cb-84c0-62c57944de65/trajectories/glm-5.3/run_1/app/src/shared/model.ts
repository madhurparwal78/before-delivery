import type { DimensionKind, Entity, Pt } from './geometry.js';
import { round6 } from './num.js';

export interface LayerRecord {
  name: string;
  colour: string;
  linetype: string;
  lineweight: number;
  on: boolean;
  frozen: boolean;
  locked: boolean;
}

export interface BlockRecord {
  name: string;
  base: Pt;
  entities: Entity[];
  attributes: Array<{ tag: string; default: string }>;
}

export interface DimStyleRecord {
  name: string;
  precision: number;
  prefix: string;
  suffix: string;
  scale: number;
  text_height_mm: number;
}

export interface ConstraintRecord {
  id: string;
  kind: ConstraintKind;
  refs: Array<{ handle: string; point: null | 'start' | 'end' }>;
  expression: string | null;
}

export type ConstraintKind =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'equal'
  | 'fixed'
  | 'length'
  | 'radius';

export interface ParameterRecord {
  name: string;
  expression: string;
}

export interface XrefRecord {
  name: string;
  source: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  clip: Array<[number, number, number, number]> | null;
}

export interface LayerStateRecord {
  name: string;
  state: Record<string, { on: boolean; frozen: boolean; locked: boolean; colour: string; linetype: string; lineweight: number }>;
}

export interface ViewportRecord {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: string;
  view_x: number;
  view_y: number;
  frozen_layers: string[];
}

export interface SheetRecord {
  id: string;
  name: string;
  size: 'A3' | 'A4';
  number: number;
  locked: boolean;
  locked_by?: string | null;
  created_by: string;
  attributes: Record<string, string>;
  viewports: ViewportRecord[];
}

export const STANDARD_DIM_STYLE: DimStyleRecord = {
  name: 'Standard',
  precision: 2,
  prefix: '',
  suffix: '',
  scale: 1,
  text_height_mm: 2.5,
};

export const SHEET_SIZES: Record<'A3' | 'A4', { width: number; height: number }> = {
  A3: { width: 420, height: 297 },
  A4: { width: 297, height: 210 },
};

export const TITLE_BLOCK_TAGS = ['Sheet no', 'Title', 'Drawn by', 'Scale', 'Project', 'Checked by'] as const;
export const AUTO_TITLE_TAGS = ['Sheet no', 'Title', 'Drawn by', 'Scale'] as const;

export interface ViewportPaper {
  paperX: number;
  paperY: number;
}

export function worldToPaper(viewport: ViewportRecord, world: Pt): ViewportPaper {
  const n = viewportScale(viewport.scale);
  return {
    paperX: viewport.x + (world.x - viewport.view_x) / n + viewport.width / 2,
    paperY: viewport.y + viewport.height / 2 - (world.y - viewport.view_y) / n,
  };
}

export function viewportScale(scale: string): number {
  const n = Number(scale.slice(2));
  return n > 0 ? n : 1;
}

export function sheetBounds(size: 'A3' | 'A4'): { width: number; height: number } {
  return SHEET_SIZES[size];
}

export interface DrawingModel {
  layers: Record<string, LayerRecord>;
  entities: Record<string, Entity>;
  order: string[];
  blocks: Record<string, BlockRecord>;
  dim_styles: Record<string, DimStyleRecord>;
  parameters: ParameterRecord[];
  constraints: ConstraintRecord[];
  xrefs: XrefRecord[];
  layer_states: LayerStateRecord[];
  sheets: SheetRecord[];
  current_layer: string;
}

export function createEmptyModel(): DrawingModel {
  return {
    layers: { '0': { name: '0', colour: 'white', linetype: 'Continuous', lineweight: 0.25, on: true, frozen: false, locked: false } },
    entities: {},
    order: [],
    blocks: {},
    dim_styles: { Standard: { ...STANDARD_DIM_STYLE } },
    parameters: [],
    constraints: [],
    xrefs: [],
    layer_states: [],
    sheets: [],
    current_layer: '0',
  };
}

export function dimensionKindOf(kind: string): DimensionKind {
  if (kind === 'aligned' || kind === 'angular' || kind === 'radial') return kind;
  return 'linear';
}

export function layerVisible(layer: LayerRecord | undefined, forHatch = false): boolean {
  if (!layer) return false;
  if (layer.frozen) return false;
  if (!layer.on) return forHatch;
  return true;
}

export function roundNumber(v: number): number {
  return round6(v);
}
