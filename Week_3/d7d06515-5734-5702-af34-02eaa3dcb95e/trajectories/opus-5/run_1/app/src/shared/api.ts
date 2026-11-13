import type { Units } from './format';

export type Point = [number, number];

export type AccessLevel = 'owner' | 'edit' | 'markup' | 'view';

export const COLOR_NAMES = ['Red', 'Yellow', 'Green', 'Cyan', 'Blue', 'Magenta', 'White'] as const;
export type ColorName = (typeof COLOR_NAMES)[number];
export const OBJECT_COLORS = ['ByLayer', ...COLOR_NAMES] as const;

export const LINETYPE_NAMES = ['Continuous', 'Dashed', 'Hidden', 'Center'] as const;
export const OBJECT_LINETYPES = ['ByLayer', ...LINETYPE_NAMES] as const;

export const LINEWEIGHT_NAMES = [
  '0.13 mm',
  '0.18 mm',
  '0.25 mm',
  '0.35 mm',
  '0.50 mm',
  '0.70 mm',
  '1.00 mm',
] as const;
export const OBJECT_LINEWEIGHTS = ['ByLayer', ...LINEWEIGHT_NAMES] as const;

export const STYLE_NAMES = ['Standard', 'Annotative'] as const;
export const PLOT_STYLES = ['Monochrome', 'Color', 'Grayscale'] as const;
export type PlotStyle = (typeof PLOT_STYLES)[number];
export const VIEWPORT_SCALES = ['1:20', '1:50', '1:100', '1:200'] as const;
export type ViewportScale = (typeof VIEWPORT_SCALES)[number];

export const BLOCK_NAMES = ['Door 900', 'Window 1200', 'Chair 450', 'Table 1600x800', 'North arrow'] as const;
export type BlockName = (typeof BLOCK_NAMES)[number];

export type ObjectType =
  | 'line'
  | 'polyline'
  | 'circle'
  | 'arc'
  | 'spline'
  | 'mtext'
  | 'dimension'
  | 'insert'
  | 'revcloud';

export type DimensionKind = 'linear' | 'aligned' | 'radius' | 'angular';

export interface SnapSet {
  endpoint: Point[];
  midpoint: Point[];
  center: Point[];
}

export interface ObjectCommon {
  handle: string;
  type: ObjectType;
  layer: string;
  color: string;
  linetype: string;
  linetype_scale: number;
  lineweight: string;
  dimension_style: string;
  text_style: string;
  multileader_style: string;
  snaps: SnapSet;
}

export interface LineObject extends ObjectCommon {
  type: 'line';
  start: Point;
  end: Point;
  length: number;
  angle: number;
}

export interface PolylineObject extends ObjectCommon {
  type: 'polyline';
  vertices: Point[];
  closed: boolean;
  length: number;
  area: number | null;
}

export interface CircleObject extends ObjectCommon {
  type: 'circle';
  center: Point;
  radius: number;
  diameter: number;
  circumference: number;
  area: number;
}

export interface ArcObject extends ObjectCommon {
  type: 'arc';
  center: Point;
  radius: number;
  start_angle: number;
  end_angle: number;
  length: number;
}

export interface SplineObject extends ObjectCommon {
  type: 'spline';
  fit_points: Point[];
}

export interface MTextObject extends ObjectCommon {
  type: 'mtext';
  position: Point;
  width: number;
  height: number;
  contents: string;
}

export interface DimensionObject extends ObjectCommon {
  type: 'dimension';
  kind: DimensionKind;
  points: Point[];
  location: Point;
  measurement: number;
  text_override: string | null;
  text: string;
}

export interface InsertObject extends ObjectCommon {
  type: 'insert';
  block: string;
  position: Point;
  scale: number;
  rotation: number;
}

export interface RevcloudObject extends ObjectCommon {
  type: 'revcloud';
  first: Point;
  opposite: Point;
  arcs: number;
}

export type DrawingObject =
  | LineObject
  | PolylineObject
  | CircleObject
  | ArcObject
  | SplineObject
  | MTextObject
  | DimensionObject
  | InsertObject
  | RevcloudObject;

export interface LayerRow {
  name: string;
  color: ColorName;
  linetype: string;
  lineweight: string;
  on: boolean;
  frozen: boolean;
  locked: boolean;
  current: boolean;
  objects: number;
}

export interface LayoutRow {
  name: string;
  viewport_scale?: ViewportScale;
}

export interface XrefRow {
  id: string;
  drawing_id: string;
  name: string;
  status: 'loaded' | 'unloaded' | 'not_found';
  objects: DrawingObject[];
}

export interface TraceSummary {
  id: string;
  name: string;
  state: 'open' | 'submitted' | 'closed';
  author: string;
  notice: 'sent' | 'not_sent' | null;
}

export interface Trace extends TraceSummary {
  objects: DrawingObject[];
}

export interface Drawing {
  id: string;
  name: string;
  folder_id: string;
  owner: { name: string };
  units: Units;
  plot_style: PlotStyle;
  version: number;
  access: AccessLevel;
  layers: LayerRow[];
  objects: DrawingObject[];
  intersections: Point[];
  layouts: LayoutRow[];
  xrefs: XrefRow[];
  traces: TraceSummary[];
}

export interface FileItem {
  id: string;
  kind: 'folder' | 'drawing';
  name: string;
  modified_at: string;
  modified_label: string;
  size_bytes: number | null;
  size_label: string;
  owner: string;
  shared: string;
}

export interface CommandResult {
  version: number;
  created: string[];
  modified: string[];
  erased: string[];
  locked: string[];
  objects: DrawingObject[];
  history: string | null;
}

export interface ActivityEntry {
  at: string;
  actor: string;
  command: string;
  count: number;
  verb: 'created' | 'modified' | 'erased';
  text: string;
}

export interface IssueRow {
  number: number;
  trace_id: string;
  text: string;
  status: 'open' | 'resolved';
}

export interface ShareRow {
  id: string;
  token: string;
  url: string;
  access: 'view' | 'markup' | 'edit';
  recipient_email: string;
  recipient_name: string;
  expires_at: string | null;
  time_zone: string;
  status: 'active' | 'expired' | 'revoked';
}

export interface ExportRow {
  id: string;
  drawing_id: string;
  format: 'pdf' | 'dxf';
  layout: string;
  file: string;
  state: 'rendering' | 'stored' | 'failed';
  issued_at: string;
  issue_date: string;
  title_block_revision: string;
  object_key: string | null;
  size_bytes: number | null;
  download_url: string | null;
}

export interface TitleBlockRevision {
  letter: string;
  footer_note: string;
  effective_date: string;
}

export interface MeResponse {
  user: { id: string; name: string; email: string; time_zone: string; verified: boolean };
  trial: { days_left: number; ended: boolean };
  now: string;
}

export interface MeasureResult {
  distance: number;
  angle: number;
  delta_x: number;
  delta_y: number;
  text: string;
}

export interface Collaborator {
  name: string;
  state: 'Editing' | 'Viewing' | 'Away';
}

export const STUDIO_TIME_ZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Australia/Sydney',
] as const;

export type ApiErrorCode =
  | 'body_too_large'
  | 'file_too_large'
  | 'bad_request'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'not_found'
  | 'link_expired'
  | 'link_revoked'
  | 'verify_link_expired'
  | 'verify_link_replaced'
  | 'view_only'
  | 'markup_only'
  | 'trial_ended'
  | 'forbidden'
  | 'unverified'
  | 'version_conflict'
  | 'layer_zero'
  | 'layer_current'
  | 'layer_locked'
  | 'layer_in_use'
  | 'folder_not_empty'
  | 'trace_not_open'
  | 'trace_not_submitted'
  | 'issue_resolved'
  | 'export_not_ready'
  | 'signin_locked'
  | 'invite_cooldown'
  | 'mail_unavailable'
  | 'storage_unavailable';
