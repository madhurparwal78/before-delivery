type Role = 'founder' | 'engineer';
export type LengthUnit = 'mm' | 'in';
export type Plane = 'top' | 'front' | 'right';
export type Operation = 'new' | 'join' | 'cut' | 'intersect';
export type Direction = 'normal' | 'reverse' | 'symmetric';
export type BodyStatus = 'none' | 'saving' | 'stored' | 'not_stored';
export type ComponentType = 'part' | 'purchased' | 'assembly';

export type ConstraintKind =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'equal'
  | 'fix'
  | 'distance'
  | 'horizontal_distance'
  | 'vertical_distance'
  | 'diameter'
  | 'radius';

export const DIMENSION_KINDS: readonly ConstraintKind[] = [
  'distance',
  'horizontal_distance',
  'vertical_distance',
  'diameter',
  'radius',
];

export const OPERATIONS: readonly Operation[] = ['new', 'join', 'cut', 'intersect'];
export const DIRECTIONS: readonly Direction[] = ['normal', 'reverse', 'symmetric'];
export const PLANES: readonly Plane[] = ['top', 'front', 'right'];

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  units: LengthUnit;
  precision: number;
}

export interface Material {
  id: string;
  name: string;
  density_g_cm3: number;
}

export interface Confirmed {
  build: number;
  object_key: string;
  volume_mm3: number;
  area_mm2: number;
  centroid_mm: { x: number; y: number; z: number };
  mass_g: number;
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

export interface Part {
  id: string;
  name: string;
  revision: number;
  material: Material;
  sketches: SketchSummary[];
  features: Feature[];
  body: { status: BodyStatus; build: number | null };
  confirmed: Confirmed | null;
}

export interface Point2 {
  x: number;
  y: number;
}

export type Entity =
  | { id: string; label: string; type: 'point'; x: number; y: number }
  | { id: string; label: string; type: 'line'; start: Point2; end: Point2 }
  | { id: string; label: string; type: 'circle'; center: Point2; radius: number }
  | {
      id: string;
      label: string;
      type: 'arc';
      center: Point2;
      radius: number;
      start_angle_deg: number;
      end_angle_deg: number;
    };

export interface Tolerance {
  kind: 'symmetric' | 'asymmetric';
  plus_mm: number;
  minus_mm: number;
}

export interface Constraint {
  id: string;
  label: string;
  kind: ConstraintKind;
  refs: string[];
  value_mm?: number;
  tolerance?: Tolerance;
  redundant: boolean;
}

export interface SketchPoint {
  ref: string;
  name: string;
  x: number;
  y: number;
  freedom: 0 | 1 | 2;
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
  entities: Entity[];
  constraints: Constraint[];
  points: SketchPoint[];
}

export interface Instance {
  id: string;
  component: { type: ComponentType; id: string; name: string };
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
  component: { type: ComponentType; id: string; name: string };
  quantity: number;
  unit_mass_g: number | null;
  subtotal_mass_g: number | null;
  pieces: number;
  body_status: BodyStatus | null;
  children?: TreeRow[];
}

export interface BomLine {
  item: { type: 'part' | 'purchased'; id: string; name: string };
  kind: 'made' | 'purchased';
  material: string | null;
  quantity: number;
  unit_mass_g: number | null;
  line_mass_g: number | null;
  body_status: BodyStatus | null;
}

export interface Bom {
  assembly_id: string;
  lines: BomLine[];
  total_mass_g: number;
  part_count: number;
  line_count: number;
}

export interface Workspace {
  name: string;
  product: { assembly_id: string; name: string };
  members: { id: string; name: string; role: Role }[];
}

export interface BodyMesh {
  part_id: string;
  build: number;
  units: 'mm';
  vertices: [number, number, number][];
  triangles: [number, number, number][];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    refused_label?: string;
    conflicts_with?: { id: string; label: string };
    current_revision?: number;
    saved_by?: { id: string; name: string };
  };
}
