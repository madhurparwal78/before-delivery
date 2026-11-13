import type { DisplayUnit, Precision, Tolerance } from './units.js';

export type Role = 'founder' | 'engineer';

export type Member = {
  id: string;
  name: string;
  email: string;
  role: Role;
  units: DisplayUnit;
  precision: Precision;
};

export type Material = { id: string; name: string; density_g_cm3: number };

export type Plane = 'top' | 'front' | 'right';
export type Operation = 'new' | 'join' | 'cut' | 'intersect';
export type Direction = 'normal' | 'reverse' | 'symmetric';
export type BodyStatus = 'none' | 'saving' | 'stored' | 'not_stored';

export type EntityType = 'point' | 'line' | 'circle' | 'arc';

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

export const CONSTRAINT_KINDS: ConstraintKind[] = [
  'coincident',
  'horizontal',
  'vertical',
  'parallel',
  'perpendicular',
  'equal',
  'fix',
  'distance',
  'horizontal_distance',
  'vertical_distance',
  'diameter',
  'radius',
];

export const CONSTRAINT_LABEL_WORD: Record<ConstraintKind, string> = {
  coincident: 'Coincident',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  parallel: 'Parallel',
  perpendicular: 'Perpendicular',
  equal: 'Equal',
  fix: 'Fix',
  distance: 'Distance',
  horizontal_distance: 'Horizontal distance',
  vertical_distance: 'Vertical distance',
  diameter: 'Diameter',
  radius: 'Radius',
};

export const ENTITY_LABEL_WORD: Record<EntityType, string> = {
  point: 'Point',
  line: 'Line',
  circle: 'Circle',
  arc: 'Arc',
};

export const DIMENSION_KINDS: ConstraintKind[] = [
  'distance',
  'horizontal_distance',
  'vertical_distance',
  'diameter',
  'radius',
];

export type Point2 = { x: number; y: number };

export type EntityGeometry =
  | { type: 'point'; x: number; y: number }
  | { type: 'line'; start: Point2; end: Point2 }
  | { type: 'circle'; center: Point2; radius: number }
  | {
      type: 'arc';
      center: Point2;
      radius: number;
      start_angle_deg: number;
      end_angle_deg: number;
    };

export type Entity = { id: string; label: string } & EntityGeometry;

export type Constraint = {
  id: string;
  label: string;
  kind: ConstraintKind;
  refs: string[];
  value_mm?: number;
  tolerance?: Tolerance;
  redundant: boolean;
};

export type SketchPoint = {
  ref: string;
  name: string;
  x: number;
  y: number;
  freedom: 0 | 1 | 2;
};

export type SketchSummary = {
  id: string;
  name: string;
  plane: Plane;
  offset_mm: number;
  revision: number;
  slack: number;
  fully_held: boolean;
};

export type Sketch = SketchSummary & {
  part_id: string;
  drives: string[];
  entities: Entity[];
  constraints: Constraint[];
  points: SketchPoint[];
};

export type Feature = {
  id: string;
  name: string;
  sketch_id: string;
  operation: Operation;
  depth_mm: number;
  direction: Direction;
};

export type ConfirmedFigures = {
  build: number;
  object_key: string;
  volume_mm3: number;
  area_mm2: number;
  centroid_mm: { x: number; y: number; z: number };
  mass_g: number;
};

export type Part = {
  id: string;
  name: string;
  revision: number;
  material: Material;
  sketches: SketchSummary[];
  features: Feature[];
  body: { status: BodyStatus; build: number | null };
  confirmed: ConfirmedFigures | null;
};

export type ComponentType = 'part' | 'purchased' | 'assembly';

export type ComponentRef = { type: ComponentType; id: string; name: string };

export type Instance = { id: string; component: ComponentRef; quantity: number };

export type Assembly = {
  id: string;
  name: string;
  revision: number;
  instances: Instance[];
  rollup: { mass_g: number; part_count: number; line_count: number };
};

export type PurchasedPart = {
  id: string;
  name: string;
  declared_mass_g: number;
  revision: number;
};

export type TreeRow = {
  instance_id: string;
  component: ComponentRef;
  quantity: number;
  unit_mass_g: number | null;
  subtotal_mass_g: number | null;
  pieces: number;
  body_status: BodyStatus | null;
  children?: TreeRow[];
};

export type BomLine = {
  item: { type: 'part' | 'purchased'; id: string; name: string };
  kind: 'made' | 'purchased';
  material: string | null;
  quantity: number;
  unit_mass_g: number | null;
  line_mass_g: number | null;
  body_status: BodyStatus | null;
};

export type Bom = {
  assembly_id: string;
  lines: BomLine[];
  total_mass_g: number;
  part_count: number;
  line_count: number;
};

export type Workspace = {
  name: string;
  product: { assembly_id: string; name: string };
  members: { id: string; name: string; role: Role }[];
};

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    refused_label?: string;
    conflicts_with?: { id: string; label: string };
    current_revision?: number;
    saved_by?: { id: string; name: string };
  };
};
