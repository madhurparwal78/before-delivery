// Domain types shared by the server and the client. JSON shapes are those of the brief's API section.

export type Units = 'mm' | 'm';
export type PlotStyle = 'Monochrome' | 'Color' | 'Grayscale';
export type Access = 'owner' | 'edit' | 'markup' | 'view';
export type ShareAccess = 'view' | 'markup' | 'edit';
export type Point = [number, number];

export const COLOR_NAMES = ['Red', 'Yellow', 'Green', 'Cyan', 'Blue', 'Magenta', 'White'] as const;
export type ColorName = (typeof COLOR_NAMES)[number];
export const LINETYPES = ['Continuous', 'Dashed', 'Hidden', 'Center'] as const;
export type LinetypeName = (typeof LINETYPES)[number];
export const LINEWEIGHTS = ['0.13 mm', '0.18 mm', '0.25 mm', '0.35 mm', '0.50 mm', '0.70 mm', '1.00 mm'] as const;
export type LineweightName = (typeof LINEWEIGHTS)[number];
export const STYLE_NAMES = ['Standard', 'Annotative'] as const;
export const VIEWPORT_SCALES = ['1:20', '1:50', '1:100', '1:200'] as const;
export type ViewportScale = (typeof VIEWPORT_SCALES)[number];
export const BLOCK_NAMES = ['Door 900', 'Window 1200', 'Chair 450', 'Table 1600x800', 'North arrow'] as const;
export type BlockName = (typeof BLOCK_NAMES)[number];

export interface Layer {
  name: string;
  color: ColorName;
  linetype: LinetypeName;
  lineweight: LineweightName;
  on: boolean;
  frozen: boolean;
  locked: boolean;
  current: boolean;
}

/** Layer as served by GET /api/drawings/<id>: `objects` is computed on read. */
export interface LayerView extends Layer {
  objects: number;
}

export interface Layout {
  name: string;
  /** Present on paper layouts only. */
  viewport_scale?: ViewportScale;
}

/** Fields every object carries, stored. */
export interface ObjectCommon {
  handle: string;
  layer: string;
  color: 'ByLayer' | ColorName;
  linetype: 'ByLayer' | LinetypeName;
  linetype_scale: number;
  lineweight: 'ByLayer' | LineweightName;
  dimension_style: string;
  text_style: string;
  multileader_style: string;
}

export interface LineGeometry { type: 'line'; start: Point; end: Point }
export interface PolylineGeometry { type: 'polyline'; vertices: Point[]; closed: boolean }
export interface CircleGeometry { type: 'circle'; center: Point; radius: number }
export interface ArcGeometry { type: 'arc'; center: Point; radius: number; start_angle: number; end_angle: number }
export interface SplineGeometry { type: 'spline'; fit_points: Point[] }
export interface MTextGeometry { type: 'mtext'; position: Point; width: number; height: number; contents: string }
export type DimensionKind = 'linear' | 'aligned' | 'radius' | 'angular';
export interface DimensionGeometry {
  type: 'dimension';
  kind: DimensionKind;
  /** linear/aligned: [first, second]; radius: [center, point on circle]; angular: [vertex, point on first line, point on second line]. */
  points: Point[];
  location: Point;
  text_override: string | null;
}
export interface InsertGeometry { type: 'insert'; block: BlockName; position: Point; scale: number; rotation: number }
export interface RevcloudGeometry { type: 'revcloud'; first: Point; opposite: Point }

export type Geometry =
  | LineGeometry | PolylineGeometry | CircleGeometry | ArcGeometry | SplineGeometry
  | MTextGeometry | DimensionGeometry | InsertGeometry | RevcloudGeometry;

/** What is persisted for an object: common fields plus geometry. No derived values. */
export type StoredObject = ObjectCommon & Geometry;

export interface Snaps {
  endpoint: Point[];
  midpoint: Point[];
  center: Point[];
}

/** Derived values added on read (never stored). */
export interface DerivedLine { length: number; angle: number }
export interface DerivedPolyline { length: number; area: number | null }
export interface DerivedCircle { diameter: number; circumference: number; area: number }
export interface DerivedArc { length: number }
export interface DerivedDimension { measurement: number; text: string }
export interface DerivedRevcloud { arcs: number }

export type ApiObject = StoredObject & { snaps: Snaps } & (
  | (LineGeometry & DerivedLine)
  | (PolylineGeometry & DerivedPolyline)
  | (CircleGeometry & DerivedCircle)
  | (ArcGeometry & DerivedArc)
  | SplineGeometry
  | MTextGeometry
  | (DimensionGeometry & DerivedDimension)
  | InsertGeometry
  | (RevcloudGeometry & DerivedRevcloud)
);

export type XrefStatus = 'loaded' | 'unloaded' | 'not_found';
export interface XrefView {
  id: string;
  drawing_id: string;
  name: string;
  status: XrefStatus;
  objects: ApiObject[];
}

export type TraceState = 'open' | 'submitted' | 'closed';
export interface TraceSummary {
  id: string;
  name: string;
  state: TraceState;
  author: string;
  notice: 'sent' | 'not_sent' | null;
}
export interface TraceView extends TraceSummary {
  objects: ApiObject[];
}

export interface DrawingView {
  id: string;
  name: string;
  folder_id: string;
  owner: { name: string };
  units: Units;
  plot_style: PlotStyle;
  version: number;
  access: Access;
  layers: LayerView[];
  objects: ApiObject[];
  intersections: Point[];
  layouts: Layout[];
  xrefs: XrefView[];
  traces: TraceSummary[];
}

export interface FolderItem {
  id: string;
  kind: 'folder' | 'drawing';
  name: string;
  modified_at: string;
  modified_label: string;
  size_bytes: number | null;
  size_label: string;
  owner: 'You' | 'Corbel Works';
  shared: 'Shared' | '—';
}

export interface MeResponse {
  user: { id: string; name: string; email: string; time_zone: string; verified: boolean };
  trial: { days_left: number; ended: boolean };
  now: string;
}

export interface ShareView {
  id: string;
  token: string;
  url: string;
  access: ShareAccess;
  recipient_email: string;
  recipient_name: string;
  expires_at: string | null;
  time_zone: string;
  status: 'active' | 'expired' | 'revoked';
}

export interface LinkInfo {
  drawing: { id: string; name: string };
  access: ShareAccess;
  status: 'active';
  expires_at: string | null;
  time_zone: string;
  expiry_label: string;
}

export type ExportState = 'rendering' | 'stored' | 'failed';
export interface ExportView {
  id: string;
  drawing_id: string;
  format: 'pdf' | 'dxf';
  layout: string;
  file: string;
  state: ExportState;
  issued_at: string;
  issue_date: string;
  title_block_revision: string;
  object_key: string | null;
  size_bytes: number | null;
  download_url: string | null;
}

export interface RevisionView { letter: string; footer_note: string; effective_date: string }
export interface IssueView { number: number; trace_id: string; text: string; status: 'open' | 'resolved' }
export interface ActivityEntry { at: string; actor: string; command: string; count: number; verb: 'created' | 'modified' | 'erased'; text: string }
export interface VersionItem {
  number: number; created_at: string; created_label: string; actor: string; size_bytes: number; object_key: string;
}

export interface CommandSuccess {
  version: number;
  created: string[];
  modified: string[];
  erased: string[];
  locked: string[];
  objects: ApiObject[];
  history: string | null;
}

/** Server-sent events on /api/drawings/<id>/events. */
export type DrawingEvent =
  | { event: 'change'; data: { version: number; changed: string[]; actor: string; command: string } }
  | { event: 'presence'; data: { collaborators: { name: string; state: 'Editing' | 'Viewing' | 'Away' }[] } }
  | { event: 'link'; data: { status: 'active' | 'expired' | 'revoked' } }
  | { event: 'trace'; data: { trace: TraceSummary } }
  | { event: 'issues'; data: { issues: IssueView[] } }
  | { event: 'activity'; data: { entry: ActivityEntry } }
  | { event: 'trial'; data: { days_left: number; ended: boolean } }
  | { event: 'sync'; data: { state: 'live' | 'paused'; storage: 'up' | 'down' } };

/** Server-sent events on /api/events. */
export type AccountEvent =
  | { event: 'files'; data: { folder_id: string } }
  | { event: 'recent'; data: Record<string, never> }
  | { event: 'trial'; data: { days_left: number; ended: boolean } };

export interface ApiErrorBody {
  error?: string;
  errors?: Record<string, string>;
  [extra: string]: unknown;
}

/** Support files (Manage Support Files). */
export interface SupportFiles {
  linetypes: string[];
  plot_styles: PlotStyle[];
  blocks: { name: BlockName; base_point: string }[];
  templates: string[];
  text_styles: string[];
}

/** Flattened drawing primitives (model space, millimetres): what the canvas, the PDF and the DXF writer draw. */
export type Primitive =
  | { kind: 'line'; a: Point; b: Point }
  | { kind: 'polyline'; points: Point[]; closed: boolean }
  | { kind: 'circle'; center: Point; radius: number }
  | { kind: 'arc'; center: Point; radius: number; start_angle: number; end_angle: number }
  | { kind: 'text'; at: Point; height: number; text: string; width: number | null };

/** One drawn primitive with the effective (ByLayer resolved) look of the object it came from. */
export interface StyledPrimitive {
  handle: string;
  primitive: Primitive;
  color: ColorName;
  linetype: LinetypeName;
  lineweight: LineweightName;
}
