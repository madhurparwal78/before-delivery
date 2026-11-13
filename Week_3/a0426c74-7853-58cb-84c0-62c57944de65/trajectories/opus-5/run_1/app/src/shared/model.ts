import { round6 } from './numbers.js';

export type LayerColour = 'white' | 'red' | 'yellow' | 'green' | 'cyan' | 'blue' | 'magenta' | 'grey';
export type Linetype = 'Continuous' | 'Dashed' | 'Dotted' | 'Centre';
export type Lineweight = '0.13' | '0.18' | '0.25' | '0.35' | '0.5' | '0.7';

export const LAYER_COLOURS: LayerColour[] = ['white', 'red', 'yellow', 'green', 'cyan', 'blue', 'magenta', 'grey'];
export const LINETYPES: Linetype[] = ['Continuous', 'Dashed', 'Dotted', 'Centre'];
export const LINEWEIGHTS: Lineweight[] = ['0.13', '0.18', '0.25', '0.35', '0.5', '0.7'];

export const BY_LAYER = 'ByLayer';
export const BY_BLOCK = 'ByBlock';

export interface Layer {
  name: string;
  colour: LayerColour;
  linetype: Linetype;
  lineweight: Lineweight;
  on: boolean;
  frozen: boolean;
  locked: boolean;
}

export interface Appearance {
  colour: string;
  linetype: string;
  lineweight: string;
}

export interface EntityBase extends Partial<Appearance> {
  handle: string;
  layer: string;
}

export interface LineEntity extends EntityBase {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface CircleEntity extends EntityBase {
  type: 'circle';
  cx: number;
  cy: number;
  r: number;
}

export interface ArcEntity extends EntityBase {
  type: 'arc';
  cx: number;
  cy: number;
  r: number;
  start: number;
  end: number;
}

export interface PlineEntity extends EntityBase {
  type: 'pline';
  points: [number, number][];
  closed: boolean;
}

export interface InsertEntity extends EntityBase {
  type: 'insert';
  block: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  attributes: Record<string, string>;
}

export interface HatchEntity extends EntityBase {
  type: 'hatch';
  seed_x: number;
  seed_y: number;
  boundary: string[];
  islands: string[];
  area: number;
  associative: boolean;
}

export type DimensionKind = 'linear' | 'aligned' | 'angular' | 'radial';
export type DimRefPoint = 'start' | 'end' | 'centre';

export interface DimRef {
  handle: string;
  point: DimRefPoint | null;
}

export interface DimensionEntity extends EntityBase {
  type: 'dimension';
  kind: DimensionKind;
  style: string;
  refs: DimRef[];
  points: [number, number][];
  override: string | null;
  text_x: number;
  text_y: number;
  value: number;
  associative: boolean;
}

export type Entity =
  | LineEntity
  | CircleEntity
  | ArcEntity
  | PlineEntity
  | InsertEntity
  | HatchEntity
  | DimensionEntity;

export type EntityType = Entity['type'];

export const HANDLE_LETTERS: Record<EntityType, string> = {
  line: 'L',
  pline: 'P',
  circle: 'C',
  arc: 'A',
  hatch: 'H',
  dimension: 'D',
  insert: 'I',
};

export interface BlockAttributeDef {
  tag: string;
  default: string;
}

export interface BlockDef {
  name: string;
  base: [number, number];
  entities: Entity[];
  attributes: BlockAttributeDef[];
}

export interface DimStyle {
  name: string;
  precision: number;
  prefix: string;
  suffix: string;
  scale: number;
  text_height_mm: number;
}

export interface Parameter {
  name: string;
  expression: string;
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

export interface ConstraintRef {
  handle: string;
  point: 'start' | 'end' | null;
}

export interface Constraint {
  id: string;
  kind: ConstraintKind;
  refs: ConstraintRef[];
  expression: string | null;
}

export interface Xref {
  name: string;
  source: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  clip: [number, number, number, number] | null;
  version_number: number | null;
}

export interface LayerStateEntry {
  name: string;
  layers: Layer[];
}

export interface Underlay {
  id: string;
  key: string;
  bytes: number;
  sha256: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface EntityMeta {
  revision: number;
  username: string;
}

export interface DrawingModel {
  layers: Layer[];
  entities: Entity[];
  blocks: BlockDef[];
  dim_styles: DimStyle[];
  parameters: Parameter[];
  constraints: Constraint[];
  xrefs: Xref[];
  layer_states: LayerStateEntry[];
  underlays: Underlay[];
  next_handle: number;
  /** Last change per entity handle, for the conflict rules. */
  touched: Record<string, EntityMeta>;
  /** Deleted entities, layers and redefined blocks, for the conflict rules. */
  deleted_entities: Record<string, EntityMeta>;
  deleted_layers: Record<string, EntityMeta>;
  redefined_blocks: Record<string, EntityMeta>;
}

export const STANDARD_DIM_STYLE: DimStyle = {
  name: 'Standard',
  precision: 2,
  prefix: '',
  suffix: '',
  scale: 1,
  text_height_mm: 2.5,
};

export function layerZero(): Layer {
  return { name: '0', colour: 'white', linetype: 'Continuous', lineweight: '0.25', on: true, frozen: false, locked: false };
}

export function emptyModel(): DrawingModel {
  return {
    layers: [layerZero()],
    entities: [],
    blocks: [],
    dim_styles: [{ ...STANDARD_DIM_STYLE }],
    parameters: [],
    constraints: [],
    xrefs: [],
    layer_states: [],
    underlays: [],
    next_handle: 1,
    touched: {},
    deleted_entities: {},
    deleted_layers: {},
    redefined_blocks: {},
  };
}

export function findLayer(model: DrawingModel, name: string): Layer | undefined {
  return model.layers.find((layer) => layer.name === name);
}

export function findEntity(model: DrawingModel, handle: string): Entity | undefined {
  return model.entities.find((entity) => entity.handle === handle);
}

export function findBlock(model: DrawingModel, name: string): BlockDef | undefined {
  return model.blocks.find((block) => block.name === name);
}

export function findStyle(model: DrawingModel, name: string): DimStyle {
  return model.dim_styles.find((style) => style.name === name) ?? { ...STANDARD_DIM_STYLE };
}

export function handleNumber(handle: string): number {
  const digits = handle.replace(/^[A-Z]+/, '');
  return Number(digits);
}

export function nextHandle(model: DrawingModel, type: EntityType): string {
  const handle = `${HANDLE_LETTERS[type]}${model.next_handle}`;
  model.next_handle += 1;
  return handle;
}

/** The effective appearance of an entity after ByLayer and ByBlock inheritance. */
export function effectiveAppearance(
  model: DrawingModel,
  entity: Entity,
  blockAppearance?: Appearance,
): Appearance {
  const layer = findLayer(model, entity.layer);
  const layerAppearance: Appearance = {
    colour: layer ? layer.colour : 'white',
    linetype: layer ? layer.linetype : 'Continuous',
    lineweight: layer ? layer.lineweight : '0.25',
  };
  const pick = (value: string | undefined, fallback: string, blockValue: string | undefined): string => {
    if (value === undefined || value === BY_LAYER) return fallback;
    if (value === BY_BLOCK) return blockValue ?? fallback;
    return value;
  };
  return {
    colour: pick(entity.colour, layerAppearance.colour, blockAppearance?.colour),
    linetype: pick(entity.linetype, layerAppearance.linetype, blockAppearance?.linetype),
    lineweight: pick(entity.lineweight, layerAppearance.lineweight, blockAppearance?.lineweight),
  };
}

export function isLayerVisible(model: DrawingModel, name: string): boolean {
  const layer = findLayer(model, name);
  if (!layer) return true;
  return layer.on && !layer.frozen;
}

export function isLayerSelectable(model: DrawingModel, name: string): boolean {
  const layer = findLayer(model, name);
  if (!layer) return false;
  return layer.on && !layer.frozen && !layer.locked;
}

export function roundEntity<T extends Entity>(entity: T): T {
  switch (entity.type) {
    case 'line':
      entity.x1 = round6(entity.x1);
      entity.y1 = round6(entity.y1);
      entity.x2 = round6(entity.x2);
      entity.y2 = round6(entity.y2);
      break;
    case 'circle':
      entity.cx = round6(entity.cx);
      entity.cy = round6(entity.cy);
      entity.r = round6(entity.r);
      break;
    case 'arc':
      entity.cx = round6(entity.cx);
      entity.cy = round6(entity.cy);
      entity.r = round6(entity.r);
      entity.start = round6(entity.start);
      entity.end = round6(entity.end);
      break;
    case 'pline':
      entity.points = entity.points.map(([x, y]) => [round6(x), round6(y)] as [number, number]);
      break;
    case 'insert':
      entity.x = round6(entity.x);
      entity.y = round6(entity.y);
      entity.scale = round6(entity.scale);
      entity.rotation = round6(entity.rotation);
      break;
    case 'hatch':
      entity.seed_x = round6(entity.seed_x);
      entity.seed_y = round6(entity.seed_y);
      break;
    case 'dimension':
      entity.text_x = round6(entity.text_x);
      entity.text_y = round6(entity.text_y);
      entity.points = entity.points.map(([x, y]) => [round6(x), round6(y)] as [number, number]);
      break;
  }
  return entity;
}

export function cloneModel(model: DrawingModel): DrawingModel {
  return structuredClone(model);
}
