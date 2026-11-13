export type TrainId = 'straight' | 'mirror_diagonal' | 'erecting_prism';

export type ObjectKind =
  | 'globular'
  | 'open_cluster'
  | 'nebula'
  | 'planetary_nebula'
  | 'galaxy'
  | 'double_star';

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

export interface Train {
  id: TrainId;
  name: string;
  rotation_deg: number;
  mirrored: boolean;
  sentence: string;
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

export interface DerivedOptics {
  aperture_mm: number;
  magnification: number;
  true_field_arcmin: number;
  exit_pupil_mm: number;
  orientation: Orientation;
}

/** Arcminutes from the field centre: east positive, north positive. */
export type SkyPoint = [number, number];

export interface MeasuredPair {
  primary: SkyPoint;
  secondary: SkyPoint;
  separation_arcmin: number;
  position_angle_deg: number;
}

export interface PairInput {
  primary: SkyPoint;
  secondary: SkyPoint;
}

export type StrokeWidth = 'fine' | 'medium' | 'broad';

export interface Stroke {
  width: StrokeWidth;
  points: SkyPoint[];
}

export interface Star {
  at: SkyPoint;
  brightness: 1 | 2 | 3 | 4 | 5;
}

export interface StrokeFile {
  format: 'lowlamp-strokes/1';
  strokes: Stroke[];
  stars: Star[];
}

export interface SketchSummary {
  strokes_sha256: string;
  strokes_size: number;
  has_raster: boolean;
}

export interface SessionSite {
  id: string;
  name: string;
  time_zone: string;
}

export interface ObservingSession {
  id: string;
  site: SessionSite;
  started_at: string;
  evening_date: string;
  local_start: string;
  local_start_offset: string;
  optics: Optics;
  derived: DerivedOptics;
  observation_count: number;
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
  site: SessionSite;
  seeing: number | null;
  transparency_nelm: number | null;
  concentration_class: string | null;
  pair: MeasuredPair | null;
  description: string;
  optics: Optics;
  derived: DerivedOptics;
  sketch: SketchSummary | null;
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

export interface ProgramProgress {
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
  progress: ProgramProgress;
}

export interface ProgramObjectRow {
  object_id: string;
  designation: string;
  name: string;
  qualifying_observation_id: string | null;
}

export interface ProgramDetail extends Program {
  objects: ProgramObjectRow[];
}

export type PacketState =
  | 'draft'
  | 'checked'
  | 'rendering'
  | 'rendered'
  | 'render_failed'
  | 'sending'
  | 'sent'
  | 'send_failed';

export type PacketFailure = 'renderer_unavailable' | 'storage_unavailable' | 'mail_rejected';

export interface PacketRow {
  observation_id: string;
  designation: string;
  evening_date: string;
  edition: number;
  strokes_sha256: string | null;
}

export interface PacketPdf {
  size: number;
  sha256: string;
  pages: number;
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
  pdf: PacketPdf | null;
  failure: PacketFailure | null;
  sent_at: string | null;
  returned_to_draft: boolean;
  created_at: string;
}

export interface Account {
  id: string;
  email: string;
  display_name: string;
}

export type ObservationFieldName =
  | 'observed_at'
  | 'seeing'
  | 'transparency_nelm'
  | 'concentration_class'
  | 'pair'
  | 'description'
  | 'optics'
  | 'sketch';

export interface ConflictReport {
  field: ObservationFieldName;
  outcome: 'kept' | 'replaced';
  other_device: string;
  other_edited_at: string;
}

export interface ObservationFields {
  observed_at?: string | null;
  seeing?: number | null;
  transparency_nelm?: number | null;
  concentration_class?: string | null;
  pair?: PairInput | null;
  description?: string | null;
  optics?: Optics;
}

export type SyncChange =
  | {
      client_op_id: string;
      kind: 'session.create';
      session_id: string;
      site_id: string;
      started_at: string;
      optics: Optics;
    }
  | { client_op_id: string; kind: 'session.optics'; session_id: string; optics: Optics }
  | {
      client_op_id: string;
      kind: 'observation.create';
      observation_id: string;
      session_id: string;
      object_id: string;
      edited_at: string;
      fields: ObservationFields;
    }
  | {
      client_op_id: string;
      kind: 'observation.update';
      observation_id: string;
      base_version: number;
      edited_at: string;
      fields: ObservationFields;
    }
  | {
      client_op_id: string;
      kind: 'sketch.put';
      observation_id: string;
      base_version: number;
      edited_at: string;
      strokes: string;
      raster_png_base64: string | null;
    }
  | {
      client_op_id: string;
      kind: 'observation.delete';
      observation_id: string;
      base_version: number;
    };

export type SyncChangeKind = SyncChange['kind'];

export interface SyncResult {
  client_op_id: string;
  status: number;
  replayed: boolean;
  body: unknown;
  conflicts: ConflictReport[];
}

export interface PacketReason {
  observation_id: string | null;
  code: string;
  message: string;
}
