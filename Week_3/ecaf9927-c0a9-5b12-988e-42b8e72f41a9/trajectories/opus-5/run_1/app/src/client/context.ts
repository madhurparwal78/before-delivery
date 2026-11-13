import type {
  Assembly,
  Bom,
  ConstraintKind,
  Direction,
  Material,
  Member,
  Operation,
  Part,
  PurchasedPart,
  Sketch,
  TreeRow,
  Workspace,
} from '../shared/api.js';
import type { BodyMesh } from './bodies.js';

export type Mode =
  | { kind: 'assembly'; assemblyId: string }
  | { kind: 'part'; partId: string }
  | { kind: 'sketch'; sketchId: string }
  | { kind: 'feature'; partId: string; featureId: string };

export type Tool = 'select' | 'line' | 'circle' | 'arc' | 'point';

export type SaveState = 'idle' | 'saving' | 'stored' | 'not_stored' | 'no_body';

export type DimensionDraft = {
  constraintId: string | null;
  kind: ConstraintKind;
  refs: string[];
  value: string;
  tolerance: string;
};

export type ExtrudeDraft = {
  sketchId: string;
  depth: string;
  operation: Operation;
  direction: Direction;
  pending: boolean;
  idempotencyKey: string;
};

export type FeatureDraft = { partId: string; featureId: string; depth: string; direction: Direction };

export type DialogKind =
  | 'new-part'
  | 'new-assembly'
  | 'new-purchased'
  | 'new-sketch'
  | 'add-to-assembly';

export type State = {
  member: Member | null;
  signingIn: boolean;
  signInError: string | null;
  signInFields: Record<string, string>;

  workspace: Workspace | null;
  materials: Material[];
  parts: Part[];
  assemblies: Assembly[];
  purchased: PurchasedPart[];

  mode: Mode | null;
  tab: 'model' | 'bom';
  treeExpanded: Set<string>;
  partsExpanded: Set<string>;
  treeActive: string | null;

  sketch: Sketch | null;
  selection: string[];
  highlight: number;
  tool: Tool;
  toolDraft: Record<string, string>;
  toolPoints: { x: number; y: number }[];
  toolErrors: Record<string, string>;
  dimension: DimensionDraft | null;
  dimensionErrors: Record<string, string>;
  zoom: number;
  pan: { x: number; y: number };

  extrude: ExtrudeDraft | null;
  featureDraft: FeatureDraft | null;
  preview: { volume_mm3: number | null; mass_g: number | null } | null;

  rows: TreeRow[];
  bom: Bom | null;
  bodies: Map<string, BodyMesh | 'unavailable'>;

  saveStatus: SaveState;
  savingPartId: string | null;
  modelMessage: string;
  storageDown: boolean;
  conflict: string | null;
  slackShown: number | null;
  ringsFrom: Map<string, number> | null;
  ghost: { label: string; conflictId: string; flash: boolean } | null;

  sheet: 'tree' | 'properties' | null;
  dialog: DialogKind | null;
  dialogFields: Record<string, string>;
  dialogErrors: Record<string, string>;
  dialogPending: boolean;
  dialogOpener: string | null;
  dialogKey: string | null;
  sheetOpener: string | null;

  width: number;
};

export type Actions = {
  signIn: (email: string, password: string) => void;
  signOut: () => void;
  openAssembly: (id: string) => void;
  openPart: (id: string) => void;
  openSketch: (id: string) => void;
  openFeature: (partId: string, featureId: string) => void;
  setTab: (tab: 'model' | 'bom') => void;
  toggleTreeRow: (instanceId: string) => void;
  moveTreeActive: (delta: number) => void;
  setTreeExpanded: (expanded: boolean) => void;
  openTreeActive: () => void;
  openTreeKey: (key: string) => void;
  togglePartItem: (partId: string) => void;
  setQuantity: (instanceId: string, quantity: number) => void;
  removeInstance: (instanceId: string) => void;
  openDialog: (kind: DialogKind, opener: HTMLElement | null) => void;
  closeDialog: () => void;
  setDialogField: (name: string, value: string) => void;
  submitDialog: () => void;
  closeSheet: () => void;
  openSheet: (sheet: 'tree' | 'properties', opener: HTMLElement | null) => void;
  setTool: (tool: Tool) => void;
  setToolField: (name: string, value: string) => void;
  placeEntity: () => void;
  canvasPoint: (x: number, y: number) => void;
  moveHighlight: (delta: number) => void;
  toggleHighlighted: () => void;
  clickItem: (ref: string, additive: boolean) => void;
  clearSelection: () => void;
  applyConstraint: (kind: ConstraintKind) => void;
  startDimension: (kind?: ConstraintKind) => void;
  editDimension: (constraintId: string) => void;
  setDimensionField: (name: string, value: string) => void;
  applyDimension: () => void;
  cancelDimension: () => void;
  deleteConstraint: (constraintId: string) => void;
  deleteSelection: () => void;
  closeSketch: () => void;
  startExtrude: () => void;
  setExtrudeField: (name: string, value: string) => void;
  confirmExtrude: () => void;
  cancelExtrude: () => void;
  setFeatureField: (name: string, value: string) => void;
  applyFeatureDepth: () => void;
  setMaterial: (materialId: string) => void;
  savePart: () => void;
  setUnits: (units: 'mm' | 'in') => void;
  setPrecision: (precision: number) => void;
  reloadAfterConflict: () => void;
  zoomBy: (factor: number) => void;
  panBy: (dx: number, dy: number) => void;
};

export type Ctx = { state: State; actions: Actions };
