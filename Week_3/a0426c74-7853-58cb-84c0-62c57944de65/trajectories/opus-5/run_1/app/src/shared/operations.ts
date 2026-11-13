import type {
  BlockAttributeDef,
  ConstraintKind,
  ConstraintRef,
  DimRef,
  DimensionKind,
  Entity,
  Layer,
  LayerColour,
  Linetype,
  Lineweight,
} from './model.js';

export interface EntityInputCommon {
  handle?: string;
  layer: string;
  colour?: string;
  linetype?: string;
  lineweight?: string;
}

export type EntityInput =
  | (EntityInputCommon & { type: 'line'; x1: number; y1: number; x2: number; y2: number })
  | (EntityInputCommon & { type: 'circle'; cx: number; cy: number; r: number })
  | (EntityInputCommon & { type: 'arc'; cx: number; cy: number; r: number; start: number; end: number })
  | (EntityInputCommon & { type: 'pline'; points: [number, number][]; closed: boolean })
  | (EntityInputCommon & {
      type: 'insert';
      block: string;
      x: number;
      y: number;
      scale: number;
      rotation: number;
      attributes?: Record<string, string>;
    })
  | (EntityInputCommon & { type: 'hatch'; seed_x: number; seed_y: number })
  | (EntityInputCommon & {
      type: 'dimension';
      kind: DimensionKind;
      style: string;
      refs: DimRef[];
      points?: [number, number][];
      override?: string | null;
      text_x: number;
      text_y: number;
    });

export interface ModifySet {
  layer?: string;
  colour?: string;
  linetype?: string;
  lineweight?: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  cx?: number;
  cy?: number;
  r?: number;
  start?: number;
  end?: number;
  points?: [number, number][];
  closed?: boolean;
  block?: string;
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  attributes?: Record<string, string>;
  seed_x?: number;
  seed_y?: number;
  style?: string;
  override?: string | null;
  text_x?: number;
  text_y?: number;
  refs?: DimRef[];
}

export interface LayerSet {
  on?: boolean;
  frozen?: boolean;
  locked?: boolean;
  colour?: LayerColour;
  linetype?: Linetype;
  lineweight?: Lineweight;
  rename?: string;
}

export type Operation =
  | { op_id: string; type: 'add'; entity: EntityInput }
  | { op_id: string; type: 'modify'; handle: string; set: ModifySet }
  | { op_id: string; type: 'move'; handles: string[]; dx: number; dy: number }
  | { op_id: string; type: 'delete'; handles: string[] }
  | {
      op_id: string;
      type: 'layer_add';
      name: string;
      colour: LayerColour;
      linetype: Linetype;
      lineweight: Lineweight;
    }
  | { op_id: string; type: 'layer_set'; name: string; set: LayerSet }
  | { op_id: string; type: 'layer_delete'; name: string }
  | { op_id: string; type: 'layer_state_save'; name: string }
  | { op_id: string; type: 'layer_state_restore'; name: string }
  | {
      op_id: string;
      type: 'block_define';
      name: string;
      base: [number, number];
      handles: string[];
      attributes: BlockAttributeDef[];
    }
  | { op_id: string; type: 'explode'; handle: string }
  | { op_id: string; type: 'purge' }
  | {
      op_id: string;
      type: 'dim_style_set';
      name: string;
      precision: number;
      prefix: string;
      suffix: string;
      scale: number;
      text_height_mm: number;
    }
  | {
      op_id: string;
      type: 'constraint_add';
      kind: ConstraintKind;
      refs: ConstraintRef[];
      expression?: string | null;
    }
  | { op_id: string; type: 'constraint_delete'; id: string }
  | { op_id: string; type: 'parameter_set'; name: string; expression: string }
  | { op_id: string; type: 'parameter_delete'; name: string }
  | {
      op_id: string;
      type: 'xref_attach';
      name: string;
      source: string;
      x: number;
      y: number;
      scale: number;
      rotation: number;
    }
  | { op_id: string; type: 'xref_clip'; name: string; rect: [number, number, number, number] | null }
  | { op_id: string; type: 'xref_reload'; name: string }
  | { op_id: string; type: 'xref_bind'; name: string }
  | { op_id: string; type: 'version_restore'; version: string }
  | { op_id: string; type: 'import_merge'; import_id: string };

export type OperationType = Operation['type'];

export type OpStatus = 'applied' | 'rebased' | 'dropped' | 'redirected';

export interface OpResult {
  op_id: string;
  status: OpStatus;
  handles: string[];
  message: string | null;
}

export interface OperationBatch {
  base_revision: number;
  group_id: string;
  command: string;
  ops: Operation[];
}

export interface Notice {
  to: string;
  text: string;
}

/** The patch a group made, so undo and redo can replay it either way. */
export interface ModelPatch {
  entities: Record<string, { before: Entity | null; after: Entity | null }>;
  layers: Record<string, { before: Layer | null; after: Layer | null }>;
  other: { before: OtherState; after: OtherState } | null;
  next_handle: { before: number; after: number };
}

export interface OtherState {
  blocks: string;
  dim_styles: string;
  parameters: string;
  constraints: string;
  xrefs: string;
  layer_states: string;
  underlays: string;
}
