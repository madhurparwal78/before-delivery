export type Point = [number, number];

export type Units = "mm" | "m";
export type PlotStyle = "Monochrome" | "Color" | "Grayscale";

export type ColourName =
  | "ByLayer"
  | "Red"
  | "Yellow"
  | "Green"
  | "Cyan"
  | "Blue"
  | "Magenta"
  | "White";

export const colourNames: ColourName[] = ["ByLayer", "Red", "Yellow", "Green", "Cyan", "Blue", "Magenta", "White"];

export type LinetypeName = "ByLayer" | "Continuous" | "Dashed" | "Hidden" | "Center";
export const linetypeNames: LinetypeName[] = ["ByLayer", "Continuous", "Dashed", "Hidden", "Center"];

export const lineweightNames = ["ByLayer", "0.13 mm", "0.18 mm", "0.25 mm", "0.35 mm", "0.50 mm", "0.70 mm", "1.00 mm"] as const;
export type LineweightName = (typeof lineweightNames)[number];

export const styleNames = ["Standard", "Annotative"] as const;
export type StyleName = (typeof styleNames)[number];

export const plotStyleNames: PlotStyle[] = ["Monochrome", "Color", "Grayscale"];

export type Access = "owner" | "edit" | "markup" | "view";

export interface Layer {
  name: string;
  color: string;
  linetype: string;
  lineweight: string;
  on: boolean;
  frozen: boolean;
  locked: boolean;
  current: boolean;
  objects: number;
}

export type SnapBuckets = { endpoint: Point[]; midpoint: Point[]; center: Point[] };

export interface BaseObjectCommon {
  handle: string;
  type: string;
  layer: string;
  color: string;
  linetype: string;
  linetype_scale: number;
  lineweight: string;
  dimension_style: string;
  text_style: string;
  multileader_style: string;
  snaps: SnapBuckets;
}

export interface LineObject extends BaseObjectCommon {
  type: "line";
  start: Point;
  end: Point;
  length: number;
  angle: number;
}

export interface PolylineObject extends BaseObjectCommon {
  type: "polyline";
  vertices: Point[];
  closed: boolean;
  length: number;
  area: number | null;
}

export interface CircleObject extends BaseObjectCommon {
  type: "circle";
  center: Point;
  radius: number;
  diameter: number;
  circumference: number;
  area: number;
}

export interface ArcObject extends BaseObjectCommon {
  type: "arc";
  center: Point;
  radius: number;
  start_angle: number;
  end_angle: number;
  length: number;
}

export interface SplineObject extends BaseObjectCommon {
  type: "spline";
  fit_points: Point[];
}

export interface MTextObject extends BaseObjectCommon {
  type: "mtext";
  position: Point;
  width: number;
  height: number;
  contents: string;
}

export interface DimensionObject extends BaseObjectCommon {
  type: "dimension";
  kind: "linear" | "aligned" | "radius" | "angular";
  points: Point[];
  location: Point;
  measurement: number;
  text_override: string | null;
  text: string;
}

export interface InsertObject extends BaseObjectCommon {
  type: "insert";
  block: string;
  position: Point;
  scale: number;
  rotation: number;
}

export interface RevCloudObject extends BaseObjectCommon {
  type: "revcloud";
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
  | RevCloudObject;

export interface Layout {
  name: string;
  viewport_scale?: string;
}

export interface Xref {
  id: string;
  drawing_id: string;
  name: string;
  status: "loaded" | "unloaded" | "not_found";
  objects: DrawingObject[];
}

export interface Trace {
  id: string;
  name: string;
  state: "open" | "submitted" | "closed";
  author: string;
  notice: "sent" | "not_sent" | null;
  objects: TraceObject[];
}

export type TraceObject = DrawingObject;

export interface DrawingDoc {
  id: string;
  name: string;
  folder_id: string | null;
  owner: { name: string };
  units: Units;
  plot_style: PlotStyle;
  version: number;
  access: Access;
  layers: Layer[];
  objects: DrawingObject[];
  intersections: Point[];
  layouts: Layout[];
  xrefs: Xref[];
  traces: Trace[];
}

export interface FileItem {
  id: string;
  kind: "folder" | "drawing";
  name: string;
  modified_at: string;
  modified_label: string;
  size_bytes: number | null;
  size_label: string;
  owner: string;
  shared: boolean;
}

export interface ActivityEntry {
  at: string;
  actor: string;
  command: string;
  count: number;
  verb: string;
  text: string;
}

export interface Issue {
  number: number;
  trace_id: string;
  text: string;
  status: "open" | "resolved";
}

export interface ShareLink {
  id: string;
  token: string;
  url: string;
  access: "view" | "markup" | "edit";
  recipient_email: string;
  recipient_name: string | null;
  expires_at: string | null;
  time_zone: string;
  status: "active" | "expired" | "revoked";
}

export interface ExportRecord {
  id: string;
  drawing_id: string;
  format: "pdf" | "dxf";
  layout: string;
  file: string;
  state: "rendering" | "stored" | "failed";
  issued_at: string | null;
  issue_date: string | null;
  title_block_revision: string | null;
  object_key: string | null;
  size_bytes: number | null;
  download_url: string | null;
}

export interface BlockDefinition {
  name: string;
  base: Point;
  objects: Array<
    | { kind: "line"; start: Point; end: Point }
    | { kind: "arc"; center: Point; radius: number; start_angle: number; end_angle: number }
    | { kind: "polyline"; vertices: Point[]; closed: boolean }
    | { kind: "mtext"; position: Point; height: number; contents: string }
  >;
}

export const blockLibrary: BlockDefinition[] = [
  {
    name: "Door 900",
    base: [0, 0],
    objects: [
      { kind: "line", start: [0, 0], end: [0, 900] },
      { kind: "arc", center: [0, 0], radius: 900, start_angle: 0, end_angle: 90 },
    ],
  },
  {
    name: "Window 1200",
    base: [0, 0],
    objects: [
      { kind: "line", start: [0, -50], end: [1200, -50] },
      { kind: "line", start: [0, 0], end: [1200, 0] },
      { kind: "line", start: [0, 50], end: [1200, 50] },
    ],
  },
  {
    name: "Chair 450",
    base: [0, 0],
    objects: [
      { kind: "polyline", vertices: [-225, -225, 225, -225, 225, 225, -225, 225] as unknown as Point[], closed: true },
    ],
  },
  {
    name: "Table 1600x800",
    base: [0, 0],
    objects: [
      { kind: "polyline", vertices: [-800, -400, 800, -400, 800, 400, -800, 400] as unknown as Point[], closed: true },
    ],
  },
  {
    name: "North arrow",
    base: [0, 0],
    objects: [
      { kind: "polyline", vertices: [0, 0, -150, -600, 150, -600] as unknown as Point[], closed: true },
      { kind: "mtext", position: [0, -800], height: 200, contents: "N" },
    ],
  },
];
