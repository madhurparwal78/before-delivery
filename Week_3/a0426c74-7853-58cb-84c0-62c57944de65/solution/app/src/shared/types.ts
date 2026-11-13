// Domain types shared by the server and the browser. Names follow the brief's vocabulary:
// operation, base revision, group, handle, layer state, block insert, xref, viewport, version,
// markup, issue, RFI, ball in court, review step.

export const COLOURS = ['white', 'red', 'yellow', 'green', 'cyan', 'blue', 'magenta', 'grey'] as const;
export type ColourName = (typeof COLOURS)[number];
export const LINETYPES = ['Continuous', 'Dashed', 'Dotted', 'Centre'] as const;
export type Linetype = (typeof LINETYPES)[number];
export const LINEWEIGHTS = [0.13, 0.18, 0.25, 0.35, 0.5, 0.7] as const;
export type Lineweight = (typeof LINEWEIGHTS)[number];

export type Colour = ColourName | 'ByLayer' | 'ByBlock';
export type EntityLinetype = Linetype | 'ByLayer';
export type EntityLineweight = Lineweight | 'ByLayer';

export const ROLES = ['view', 'markup', 'edit', 'manage'] as const;
export type Role = (typeof ROLES)[number];

export type Point = [number, number];
export type Rect = [number, number, number, number];

// ---------------------------------------------------------------- entities

interface EntityCommon {
  handle: string;
  layer: string;
  colour?: Colour;
  linetype?: EntityLinetype;
  lineweight?: EntityLineweight;
  /** username that created it; null for seeded entities. Used for the "lost its geometry" and "boundary broken" toasts. */
  author?: string | null;
}

export interface LineEntity extends EntityCommon { type: 'line'; x1: number; y1: number; x2: number; y2: number }
export interface CircleEntity extends EntityCommon { type: 'circle'; cx: number; cy: number; r: number }
export interface ArcEntity extends EntityCommon { type: 'arc'; cx: number; cy: number; r: number; start: number; end: number }
export interface PlineEntity extends EntityCommon { type: 'pline'; points: Point[]; closed: boolean }
export interface InsertEntity extends EntityCommon {
  type: 'insert'; block: string; x: number; y: number; scale: number; rotation: number;
  attributes: Record<string, string>;
}
export interface HatchEntity extends EntityCommon {
  type: 'hatch'; seed_x: number; seed_y: number;
  /** derived and stored: the last found area, kept when the association breaks */
  area: number;
  associative: boolean;
  /** derived and stored: handles of the outer loop entities then the island entities, as last found */
  boundary: string[];
}
export const DIMENSION_KINDS = ['linear', 'aligned', 'angular', 'radial'] as const;
export type DimensionKind = (typeof DIMENSION_KINDS)[number];
export interface DimRef { handle: string; point?: 'start' | 'end' | 'centre' | null }
export interface DimensionEntity extends EntityCommon {
  type: 'dimension'; kind: DimensionKind; style: string; refs: DimRef[]; override: string | null;
  text_x: number; text_y: number;
  /** derived and stored: scaled value (not rounded to the style precision), kept when the association breaks */
  value: number;
  associative: boolean;
}

export type Entity = LineEntity | CircleEntity | ArcEntity | PlineEntity | InsertEntity | HatchEntity | DimensionEntity;
export type EntityType = Entity['type'];
export type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
/** An entity as sent in an `add` operation or a seed: no handle yet, derived fields optional. */
export type EntityDraft = DistributiveOmit<Entity, 'handle' | 'area' | 'associative' | 'boundary' | 'value'>;

export const ENTITY_TYPES = ['line', 'pline', 'circle', 'arc', 'hatch', 'dimension', 'insert'] as const satisfies readonly EntityType[];
export const HANDLE_LETTER: Record<EntityType, string> = {
  line: 'L', pline: 'P', circle: 'C', arc: 'A', hatch: 'H', dimension: 'D', insert: 'I',
};

// ---------------------------------------------------------------- drawing records

export interface Layer { name: string; colour: ColourName; linetype: Linetype; lineweight: Lineweight; on: boolean; frozen: boolean; locked: boolean }
export interface LayerState { name: string; layers: Layer[] }
export interface BlockAttribute { tag: string; default: string }
export interface BlockDef { name: string; base: Point; entities: Entity[]; attributes: BlockAttribute[] }
export interface DimStyle { name: string; precision: number; prefix: string; suffix: string; scale: number; text_height_mm: number }
export interface Parameter { name: string; expression: string }
export const CONSTRAINT_KINDS = ['coincident', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'equal', 'fixed', 'length', 'radius'] as const;
export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number];
export interface ConstraintRef { handle: string; point?: 'start' | 'end' | null }
export interface Constraint { id: string; kind: ConstraintKind; refs: ConstraintRef[]; expression?: string }
export interface Underlay { id: string; key: string; bytes: number; sha256: string; x1: number; y1: number; x2: number; y2: number }

/** The model of a drawing (or of a published version) as an xref sees it. */
export interface ModelSnapshot { layers: Layer[]; entities: Entity[]; blocks: BlockDef[]; xrefs: Xref[] }
export interface Xref {
  name: string; source: string; x: number; y: number; scale: number; rotation: number;
  clip: Rect | null;
  /** the published version whose model is loaded; null when the source had none */
  version_id: string | null;
  model: ModelSnapshot;
}

/** In-memory state of one drawing. Entities are replaced, never mutated, so views can compare identity. */
export interface DrawingState {
  revision: number;
  next_handle: number;
  layers: Record<string, Layer>;
  entities: Record<string, Entity>;
  blocks: Record<string, BlockDef>;
  dim_styles: Record<string, DimStyle>;
  parameters: Record<string, Parameter>;
  constraints: Constraint[];
  xrefs: Record<string, Xref>;
  layer_states: Record<string, LayerState>;
  underlays: Underlay[];
}

// ---------------------------------------------------------------- operations

interface OpBase { op_id: string }
export type Op =
  | (OpBase & { type: 'add'; entity: EntityDraft })
  | (OpBase & { type: 'modify'; handle: string; set: Record<string, unknown> })
  | (OpBase & { type: 'move'; handles: string[]; dx: number; dy: number })
  | (OpBase & { type: 'delete'; handles: string[] })
  | (OpBase & { type: 'layer_add'; name: string; colour: ColourName; linetype: Linetype; lineweight: Lineweight })
  | (OpBase & { type: 'layer_set'; name: string; set: Partial<Pick<Layer, 'on' | 'frozen' | 'locked' | 'colour' | 'linetype' | 'lineweight'>> & { rename?: string } })
  | (OpBase & { type: 'layer_delete'; name: string })
  | (OpBase & { type: 'layer_state_save'; name: string })
  | (OpBase & { type: 'layer_state_restore'; name: string })
  | (OpBase & { type: 'block_define'; name: string; base: Point; handles: string[]; attributes: BlockAttribute[] })
  | (OpBase & { type: 'explode'; handle: string })
  | (OpBase & { type: 'purge' })
  | (OpBase & { type: 'dim_style_set' } & DimStyle)
  | (OpBase & { type: 'constraint_add'; kind: ConstraintKind; refs: ConstraintRef[]; expression?: string })
  | (OpBase & { type: 'constraint_delete'; id: string })
  | (OpBase & { type: 'parameter_set'; name: string; expression: string })
  | (OpBase & { type: 'parameter_delete'; name: string })
  | (OpBase & { type: 'xref_attach'; name: string; source: string; x: number; y: number; scale: number; rotation: number })
  | (OpBase & { type: 'xref_clip'; name: string; rect: Rect | null })
  | (OpBase & { type: 'xref_reload'; name: string })
  | (OpBase & { type: 'xref_bind'; name: string })
  | (OpBase & { type: 'version_restore'; version: string })
  | (OpBase & { type: 'import_merge'; import_id: string });

export interface OperationGroup { base_revision: number; group_id: string; command: string; ops: Op[] }

export type OpStatus = 'applied' | 'rebased' | 'dropped' | 'redirected';
export interface OpResult { op_id: string; status: OpStatus; handles: string[]; message: string | null }
export interface OperationsResponse { revision: number; results: OpResult[] }

/** What a group changed, as sent over the live channel and applied by clients without re-running any rule. */
export interface StatePatch {
  revision: number;
  next_handle: number;
  entities_upsert: Entity[];
  entities_delete: string[];
  /** a collection is present, in full, only when the group changed it */
  layers?: Layer[];
  blocks?: BlockDef[];
  dim_styles?: DimStyle[];
  parameters?: Parameter[];
  constraints?: Constraint[];
  xrefs?: Xref[];
  layer_states?: LayerState[];
  underlays?: Underlay[];
}

// ---------------------------------------------------------------- documents and API bodies

export interface ParameterView extends Parameter { value: number | null }
/** GET /api/drawings/<id> */
export interface DrawingDocument {
  id: string; name: string; folder_id: string; role: Role; revision: number; next_handle: number;
  /** the number of the last live message when the document was read (read before the state); the page says hello since it */
  seq: number;
  /** the starting viewport set through the grading view route for this session, else null */
  view: { zoom: number; pan_x: number; pan_y: number } | null;
  layers: Layer[]; entities: Entity[]; blocks: BlockDef[]; dim_styles: DimStyle[]; parameters: ParameterView[];
  constraints: Constraint[]; xrefs: Xref[]; layer_states: LayerState[]; underlays: Underlay[];
  sheets: Sheet[];
}

export const PAPER_SIZE_NAMES = ['A3', 'A4'] as const;
export type PaperSize = (typeof PAPER_SIZE_NAMES)[number];
export interface Viewport { id: string; sheet_id: string; x: number; y: number; width: number; height: number; scale: string; view_x: number; view_y: number; frozen_layers: string[] }
export interface Sheet { id: string; drawing_id: string; name: string; size: PaperSize; number: number; locked: boolean; locked_by: string | null; creator: string; attributes: Record<string, string>; viewports: Viewport[] }

export type VersionState = 'publishing' | 'published' | 'in_review' | 'approved' | 'rejected' | 'voided';
export interface VersionSummary { id: string; number: number; state: VersionState; replaced_by: string | null; stamps: string[]; steps: ReviewStep[] }
export interface VersionSnapshot { sheet: Sheet; model: ModelSnapshot }
export interface VersionDocument extends VersionSummary { sheet_id: string; drawing_id: string; snapshot: VersionSnapshot }

export type ReviewStepRole = 'markup' | 'manage';
export type ReviewStepState = 'waiting' | 'pending' | 'approved' | 'rejected' | 'expired' | 'voided';
export interface ReviewStep { role: ReviewStepRole; state: ReviewStepState; due_at: string | null }
export const MARKUP_KINDS = ['cloud', 'arrow', 'text'] as const;
export type MarkupKind = (typeof MARKUP_KINDS)[number];
export interface Markup { id: string; version_id: string; kind: MarkupKind; x1: number; y1: number; x2: number; y2: number; text: string; flag: 'geometry-changed' | null; author: string }
export type IssueState = 'open' | 'answered' | 'closed';
export interface Issue { id: string; version_id: string; drawing_id: string; title: string; x: number; y: number; state: IssueState; creator: string; rfi_ids: string[] }
export type RfiState = 'draft' | 'sent' | 'answered' | 'closed';
export interface Rfi { id: string; issue_id: string; question: string; answer: string | null; state: RfiState; asker: string; addressee: string; ball_in_court: string }
export const EXPORT_FORMATS = ['plot.txt', 'svg'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export type ExportState = 'queued' | 'running' | 'ready' | 'failed';
export interface ExportJob { id: string; format: ExportFormat; state: ExportState; progress: number; download_url: string | null }
export interface CompareEntry { id: string; diff: 'added' | 'removed' | 'changed' | 'same' }
export interface CompareResult { added: number; removed: number; changed: number; entities: CompareEntry[] }
export interface FolderSummary { id: string; name: string; parent_id: string | null; role: Role }
export interface DrawingListing { id: string; name: string; xref_sources: string[]; sheets: { id: string; name: string; versions: { id: string; number: number; state: VersionState }[] }[] }

// ---------------------------------------------------------------- live channel

export interface PresenceMember { username: string; colour: number }
export type LiveMessage =
  | { seq: number; type: 'ops'; data: OpsMessage }
  | { seq: number; type: 'presence'; data: PresenceMessage }
  | { seq: number; type: 'xref_version'; data: { source: string; name: string; xref_names: string[]; version_id: string } }
  | { seq: number; type: 'version'; data: { event: 'sheet' | 'viewport' | 'published' | 'state'; sheet?: Sheet; version?: VersionSummary & { sheet_id: string } } }
  | { seq: number; type: 'markup'; data: { markup: Markup } }
  | { seq: number; type: 'issue'; data: { issue: Issue } }
  | { seq: number; type: 'rfi'; data: { rfi: Rfi; issue: Issue } }
  | { seq: number; type: 'review'; data: { version_id: string; sheet_id: string; state: VersionState; steps: ReviewStep[]; stamps: string[]; message: string | null } }
  | { seq: number; type: 'role'; data: { username: string; role: Role | null } }
  | { seq: number; type: 'export'; data: { job: ExportJob; username: string } }
  | { seq: number; type: 'notice'; data: { username: string; text: string } }
  | { seq: number; type: 'link'; data: { link_id: string; state: 'active' | 'expired' | 'revoked' } };

export interface OpsMessage {
  username: string; group_id: string; command: string; base_revision: number; revision: number;
  /** the ops as applied (entities carry their assigned handles in `results`) */
  ops: Op[]; results: OpResult[]; patch: StatePatch;
  /** set on an undo or redo: the command of the group that was reversed or repeated */
  undone?: string;
}
export type PresenceMessage =
  | { kind: 'members'; members: PresenceMember[] }
  | { kind: 'cursor'; username: string; x: number | null; y: number | null; selection: string[]; zoom: number; pan_x: number; pan_y: number; width: number; height: number };

/** client -> server over the live socket */
export type LiveClientMessage =
  | { type: 'hello'; since: number }
  | { type: 'cursor'; x: number | null; y: number | null; selection: string[]; zoom: number; pan_x: number; pan_y: number; width: number; height: number };

// ---------------------------------------------------------------- errors

/**
 * The published error codes in the published order: when several errors apply, the first in this list is the response.
 */
export const ERROR_CODES = [
  'too_large', 'cross_origin', 'unauthenticated', 'rate_limited', 'not_found',
  'forbidden', 'read_only', 'sheet_locked', 'layer_locked', 'not_ball_in_court',
  'stale_base', 'illegal_transition', 'rfi_open', 'out_of_order', 'review_voided', 'review_expired', 'undo_superseded',
  'nothing_to_undo', 'nothing_to_redo', 'username_taken', 'not_ready', 'link_expired', 'link_revoked',
  'wrong_type', 'quota_exceeded', 'invalid', 'storage_unavailable', 'parse_failed',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export interface ApiErrorBody { error: ErrorCode; message: string; fields?: Record<string, string>; lines?: string[] }
