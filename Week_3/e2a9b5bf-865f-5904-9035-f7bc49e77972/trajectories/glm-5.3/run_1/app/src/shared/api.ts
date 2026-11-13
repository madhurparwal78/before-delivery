// Shared API shapes the browser and server both use.
import type { ObjectKind } from "./completeness.js";
import type { RuleEdition } from "./completeness.js";
import type { ConflictReport, ResolvableField } from "./conflicts.js";
import type { TrainId, DerivedOptics } from "./optics.js";
import type { MeasuredPair } from "./pair.js";
import type { StrokeFile } from "./strokes.js";

export interface Account {
  readonly id: string;
  readonly email: string;
  readonly display_name: string;
}

export interface Telescope {
  readonly id: string;
  readonly name: string;
  readonly aperture_mm: number;
  readonly focal_length_mm: number;
}

export interface Eyepiece {
  readonly id: string;
  readonly name: string;
  readonly focal_length_mm: number;
  readonly apparent_field_deg: number;
}

export interface Barlow {
  readonly id: string;
  readonly name: string;
  readonly factor: number;
}

export interface TrainRow {
  readonly id: TrainId;
  readonly name: string;
  readonly rotation_deg: number;
  readonly mirrored: boolean;
  readonly sentence: string;
}

export interface Kit {
  readonly telescopes: readonly Telescope[];
  readonly eyepieces: readonly Eyepiece[];
  readonly barlows: readonly Barlow[];
  readonly trains: readonly TrainRow[];
}

export interface Site {
  readonly id: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly time_zone: string;
}

export interface OpticsPayload {
  readonly telescope_id: string;
  readonly eyepiece_id: string;
  readonly barlow_id: string | null;
  readonly train: TrainId;
}

export interface SessionSummary {
  readonly id: string;
  readonly site: { readonly id: string; readonly name: string; readonly time_zone: string };
  readonly started_at: string;
  readonly evening_date: string;
  readonly local_start: string;
  readonly local_start_offset: string;
  readonly optics: OpticsPayload;
  readonly derived: DerivedOptics;
  readonly observation_count: number;
}

export interface SessionWithObservations extends SessionSummary {
  readonly observations: readonly Observation[];
}

export interface SketchInfo {
  readonly strokes_sha256: string;
  readonly strokes_size: number;
  readonly has_raster: boolean;
}

export interface Observation {
  readonly id: string;
  readonly session_id: string;
  readonly object_id: string;
  readonly designation: string;
  readonly kind: ObjectKind;
  readonly observed_at: string | null;
  readonly local_time: string | null;
  readonly local_offset: string | null;
  readonly evening_date: string;
  readonly site: { readonly id: string; readonly name: string; readonly time_zone: string };
  readonly seeing: number | null;
  readonly transparency_nelm: number | null;
  readonly concentration_class: string | null;
  readonly pair: MeasuredPair | null;
  readonly description: string;
  readonly optics: OpticsPayload;
  readonly derived: DerivedOptics;
  readonly sketch: SketchInfo | null;
  readonly version: number;
}

export interface CatalogueRow {
  readonly id: string;
  readonly designation: string;
  readonly name: string;
  readonly kind: ObjectKind;
}

export interface ObjectHistory {
  readonly object: { readonly id: string; readonly designation: string; readonly name: string; readonly kind: ObjectKind };
  readonly observations: readonly Observation[];
}

export interface ProgramObjectRow {
  readonly object_id: string;
  readonly designation: string;
  readonly name: string;
  readonly qualifying_observation_id: string | null;
}

export interface ProgramProgress {
  readonly qualifying: number;
  readonly total: number;
  readonly required: number;
}

export interface ProgramSummary {
  readonly id: string;
  readonly name: string;
  readonly required_count: number;
  readonly sketch_required: boolean;
  readonly min_description: number;
  readonly concentration_required: boolean;
  readonly pair_required: boolean;
  readonly editions: readonly RuleEdition[];
  readonly coordinator_name: string;
  readonly following: boolean;
  readonly progress: ProgramProgress;
}

export interface ProgramDetail extends ProgramSummary {
  readonly objects: readonly ProgramObjectRow[];
}

export type PacketStateId =
  | "draft"
  | "checked"
  | "rendering"
  | "rendered"
  | "render_failed"
  | "sending"
  | "sent"
  | "send_failed";

export interface PacketRow {
  readonly observation_id: string;
  readonly designation: string;
  readonly evening_date: string;
  readonly edition: number;
  readonly strokes_sha256: string | null;
}

export interface PacketPdfInfo {
  readonly size: number;
  readonly sha256: string;
  readonly pages: number;
}

export interface Packet {
  readonly id: string;
  readonly number: number;
  readonly program_id: string;
  readonly state: PacketStateId;
  readonly label: string;
  readonly revision: number;
  readonly observation_ids: readonly string[];
  readonly rows: readonly PacketRow[];
  readonly pdf: PacketPdfInfo | null;
  readonly failure: "renderer_unavailable" | "storage_unavailable" | "mail_rejected" | null;
  readonly sent_at: string | null;
  readonly returned_to_draft: boolean;
  readonly created_at: string;
}

export type SyncChangeKind =
  | "session.create"
  | "session.optics"
  | "observation.create"
  | "observation.update"
  | "sketch.put"
  | "observation.delete";

export type ObservationFieldValues = Partial<{
  observed_at: string | null;
  seeing: number | null;
  transparency_nelm: number | null;
  concentration_class: string | null;
  pair: { primary: readonly [number, number]; secondary: readonly [number, number] } | null;
  description: string;
  optics: OpticsPayload;
}>;

export interface SyncChange {
  readonly client_op_id: string;
  readonly kind: SyncChangeKind;
  readonly session_id?: string;
  readonly observation_id?: string;
  readonly site_id?: string;
  readonly started_at?: string;
  readonly object_id?: string;
  readonly base_version?: number;
  readonly edited_at?: string;
  readonly fields?: ObservationFieldValues;
  readonly optics?: OpticsPayload;
  readonly strokes?: string;
  readonly raster_png_base64?: string | null;
}

export interface SyncResult {
  readonly client_op_id: string;
  readonly status: number;
  readonly replayed: boolean;
  readonly body: unknown;
  readonly conflicts: readonly ConflictReport[];
}

export type ResolvableFieldForClient = ResolvableField;
export type StrokeFileShape = StrokeFile;
