export type TrainId = "straight" | "mirror_diagonal" | "erecting_prism";

export interface Train {
  id: TrainId;
  name: string;
  rotation_deg: number;
  mirrored: boolean;
  sentence: string;
}

export interface Optics {
  telescope_id: string;
  eyepiece_id: string;
  barlow_id: string | null;
  train: TrainId;
}

export interface Orientation {
  train: TrainId;
  rotation_deg: number;
  mirrored: boolean;
  sentence: string;
}

export interface Derived {
  aperture_mm: number;
  magnification: number;
  true_field_arcmin: number;
  exit_pupil_mm: number;
  orientation: Orientation;
}

export type ObjectKind = "globular" | "open_cluster" | "nebula" | "planetary_nebula" | "galaxy" | "double_star";

export interface CatalogueObject {
  id: string;
  designation: string;
  name: string;
  kind: ObjectKind;
}

export interface Telescope {
  id: string;
  name: string;
  aperture_mm: number;
  focal_length_mm: number;
}

export interface Eyepiece {
  id: string;
  name: string;
  focal_length_mm: number;
  apparent_field_deg: number;
}

export interface Barlow {
  id: string;
  name: string;
  factor: number;
}

export interface Kit {
  telescopes: Telescope[];
  eyepieces: Eyepiece[];
  barlows: Barlow[];
  trains: Train[];
}

export interface Site {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  time_zone: string;
}

export interface Account {
  id: string;
  email: string;
  display_name: string;
}

export type Point = [number, number];

export interface Pair {
  primary: Point;
  secondary: Point;
  separation_arcmin?: number;
  position_angle_deg?: number;
}

export interface SketchRef {
  strokes_sha256: string;
  strokes_size: number;
  has_raster: boolean;
}

export interface Session {
  id: string;
  site: { id: string; name: string; time_zone: string };
  started_at: string;
  evening_date: string;
  local_start: string;
  local_start_offset: string;
  optics: Optics;
  derived: Derived;
  observation_count: number;
}

export interface SessionWithObservations extends Session {
  observations: Observation[];
}

export interface Observation {
  id: string;
  session_id: string;
  object_id: string;
  designation: string;
  kind: ObjectKind;
  observed_at: string | null;
  local_time: string | null;
  local_offset: string | null;
  evening_date: string;
  site: { id: string; name: string; time_zone: string };
  seeing: number | null;
  transparency_nelm: number | null;
  concentration_class: string | null;
  pair: Pair | null;
  description: string;
  optics: Optics;
  derived: Derived;
  sketch: SketchRef | null;
  version: number;
}

export interface ProgramEdition {
  edition: number;
  effective_from: string;
  min_description: number;
  sketch_required: boolean;
  concentration_required: boolean;
  pair_required: boolean;
}

export interface Progress {
  qualifying: number;
  total: number;
  required: number;
}

export interface Program {
  id: string;
  name: string;
  required_count: number;
  sketch_required: boolean;
  min_description: number;
  concentration_required: boolean;
  pair_required: boolean;
  editions: ProgramEdition[];
  coordinator_name: string;
  coordinator_email: string;
  following: boolean;
  progress: Progress;
}

export interface ProgramDetail extends Program {
  objects: { object_id: string; designation: string; name: string; qualifying_observation_id: string | null }[];
}

export type PacketState =
  | "draft"
  | "checked"
  | "rendering"
  | "rendered"
  | "render_failed"
  | "sending"
  | "sent"
  | "send_failed";

export interface PacketRow {
  observation_id: string;
  designation: string;
  evening_date: string;
  edition: number;
  strokes_sha256: string | null;
}

export interface Packet {
  id: string;
  number: number;
  program_id: string;
  state: PacketState;
  label: string;
  revision: number;
  observation_ids: string[];
  rows: PacketRow[];
  pdf: { size: number; sha256: string; pages: number } | null;
  failure: null | "renderer_unavailable" | "storage_unavailable" | "mail_rejected";
  sent_at: string | null;
  returned_to_draft: boolean;
  created_at: string;
}

export interface PacketReason {
  observation_id: string | null;
  code: string;
  message: string;
}

export type ChangeKind =
  | "session.create"
  | "session.optics"
  | "observation.create"
  | "observation.update"
  | "sketch.put"
  | "observation.delete";

export interface Change {
  client_op_id: string;
  kind: ChangeKind;
  body: Record<string, unknown>;
}

export interface Conflict {
  field: ConflictField;
  outcome: "kept" | "replaced";
  other_device: string;
  other_edited_at: string;
}

export type ConflictField =
  | "observed_at"
  | "seeing"
  | "transparency_nelm"
  | "concentration_class"
  | "pair"
  | "description"
  | "optics"
  | "sketch";

export interface ChangeResult {
  client_op_id: string;
  status: number;
  replayed: boolean;
  body: Record<string, unknown>;
  conflicts: Conflict[];
}

export interface StrokeFile {
  format: "lowlamp-strokes/1";
  strokes: { width: "fine" | "medium" | "broad"; points: Point[] }[];
  stars: { at: Point; brightness: number }[];
}
