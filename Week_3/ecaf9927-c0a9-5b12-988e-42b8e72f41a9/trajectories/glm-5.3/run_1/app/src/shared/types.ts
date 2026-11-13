export type Role = "founder" | "engineer";
export type Units = "mm" | "in";
export type Plane = "top" | "front" | "right";
export type Operation = "new" | "join" | "cut" | "intersect";
export type Direction = "normal" | "reverse" | "symmetric";
export type BodyStatus = "none" | "saving" | "stored" | "not_stored";
export type ComponentType = "part" | "purchased" | "assembly";

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  units: Units;
  precision: number;
}

export interface Material {
  id: string;
  name: string;
  density_g_cm3: number;
}

export interface Tolerance {
  kind: "symmetric" | "asymmetric";
  plus_mm: number;
  minus_mm: number;
}

export interface ConfirmedFigures {
  build: number;
  object_key: string;
  volume_mm3: number;
  area_mm2: number;
  centroid_mm: { x: number; y: number; z: number };
  mass_g: number;
}

export interface Part {
  id: string;
  name: string;
  revision: number;
  material: Material;
  sketches: SketchSummary[];
  features: Feature[];
  body: { status: BodyStatus; build: number | null };
  confirmed: ConfirmedFigures | null;
}

export interface SketchSummary {
  id: string;
  name: string;
  plane: Plane;
  offset_mm: number;
  revision: number;
  slack: number;
  fully_held: boolean;
}

export interface Feature {
  id: string;
  name: string;
  sketch_id: string;
  operation: Operation;
  depth_mm: number;
  direction: Direction;
}

export type EntityType = "point" | "line" | "circle" | "arc";

export interface PointEntity {
  id: string;
  label: string;
  type: "point";
  x: number;
  y: number;
}

export interface LineEntity {
  id: string;
  label: string;
  type: "line";
  start: { x: number; y: number };
  end: { x: number; y: number };
}

export interface CircleEntity {
  id: string;
  label: string;
  type: "circle";
  center: { x: number; y: number };
  radius: number;
}

export interface ArcEntity {
  id: string;
  label: string;
  type: "arc";
  center: { x: number; y: number };
  radius: number;
  start_angle_deg: number;
  end_angle_deg: number;
}

export type SketchEntity = PointEntity | LineEntity | CircleEntity | ArcEntity;

export type ConstraintKind =
  | "coincident"
  | "horizontal"
  | "vertical"
  | "parallel"
  | "perpendicular"
  | "equal"
  | "fix"
  | "distance"
  | "horizontal_distance"
  | "vertical_distance"
  | "diameter"
  | "radius";

export interface Constraint {
  id: string;
  label: string;
  kind: ConstraintKind;
  refs: string[];
  value_mm?: number;
  tolerance?: Tolerance | null;
  redundant: boolean;
}

export interface SketchPoint {
  ref: string;
  name: string;
  x: number;
  y: number;
  freedom: number;
}

export interface Sketch {
  id: string;
  part_id: string;
  name: string;
  plane: Plane;
  offset_mm: number;
  revision: number;
  slack: number;
  fully_held: boolean;
  drives: string[];
  entities: SketchEntity[];
  constraints: Constraint[];
  points: SketchPoint[];
}

export interface InstanceComponent {
  type: ComponentType;
  id: string;
  name: string;
}

export interface Instance {
  id: string;
  component: InstanceComponent;
  quantity: number;
}

export interface Rollup {
  mass_g: number;
  part_count: number;
  line_count: number;
}

export interface Assembly {
  id: string;
  name: string;
  revision: number;
  instances: Instance[];
  rollup: Rollup;
}

export interface PurchasedPart {
  id: string;
  name: string;
  declared_mass_g: number;
  revision: number;
}

export interface TreeRow {
  instance_id: string;
  component: InstanceComponent;
  quantity: number;
  unit_mass_g: number | null;
  subtotal_mass_g: number | null;
  pieces: number;
  body_status: BodyStatus | null;
  children?: TreeRow[];
}

export interface BomLine {
  item: { type: "part" | "purchased"; id: string; name: string };
  kind: "made" | "purchased";
  material: string | null;
  quantity: number;
  unit_mass_g: number | null;
  line_mass_g: number | null;
  body_status: BodyStatus;
}

export interface Bom {
  assembly_id: string;
  lines: BomLine[];
  total_mass_g: number;
  part_count: number;
  line_count: number;
}

export interface WorkspaceInfo {
  name: string;
  product: { assembly_id: string; name: string };
  members: { id: string; name: string; role: Role }[];
}

export interface MeshBody {
  part_id: string;
  build: number;
  units: "mm";
  vertices: [number, number, number][];
  triangles: [number, number, number][];
}

export interface WorkspaceStatus {
  storage: "ok" | "unreachable";
}
