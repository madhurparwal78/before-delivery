import type { Keyframes, Property } from "./keyframes";
import type { RateLabel } from "./rational";

export type Role = "owner" | "editor" | "commenter";
export type RowKind = "video" | "audio" | "caption";
export type ClipKind = "mp4" | "wav" | "png" | "text";
export type MediaKind = "mp4" | "wav" | "png";
export type Visibility = "team" | "review";
export type ExportState = "queued" | "running" | "done" | "cancelled" | "failed";

export const ASPECTS = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
} as const;
export type AspectRatio = keyof typeof ASPECTS;
export const ASPECT_LABELS = Object.keys(ASPECTS) as AspectRatio[];

export interface Person {
  id: string;
  name: string;
  email: string;
  handle: string;
}

export interface Marker {
  frame: number;
  label: string;
}

export interface Project {
  id: string;
  title: string;
  agency: string;
  description: string;
  frame_rate: RateLabel;
  aspect_ratio: AspectRatio;
  width: number;
  height: number;
  time_unit: "frames" | "seconds";
  version: number;
  total_frames: number;
  role: Role;
  markers: Marker[];
  last_cut: { id: string; name: string; total_frames: number } | null;
}

export interface Row {
  id: string;
  name: string;
  kind: RowKind;
  position: number;
  locked: boolean;
}

export interface Clip {
  id: string;
  row_id: string;
  name: string;
  kind: ClipKind;
  media_id: string | null;
  start_frame: number;
  end_frame: number;
  source_in: number;
  source_out: number;
  speed_percent: number;
  hidden: boolean;
  group_id: string | null;
  text: string | null;
  text_colour: string | null;
  box_colour: string | null;
  font_weight: number | null;
  keyframes: Keyframes;
  base: Partial<Record<Property, number>>;
}

export interface Caption {
  id: string;
  row_id: string;
  start_frame: number;
  end_frame: number;
  text: string;
}

export interface MediaDims {
  kind: MediaKind;
  width: number | null;
  height: number | null;
  sha256: string;
}

export interface Comment {
  id: string;
  author_name: string;
  body: string;
  visibility: Visibility;
  parent_id: string | null;
  cut_id: string | null;
  pin: { frame: number; row_id: string | null; clip_id: string | null; live_frame: number };
  mentions: string[];
  created_at: string;
}

export interface Cut {
  id: string;
  name: string;
  version: number;
  total_frames: number;
  shared: boolean;
  approvals: { name: string; at: string }[];
  created_at: string;
}

export interface Member {
  person: Person;
  role: Role;
}

export interface ExportRecord {
  id: string;
  project_id: string;
  cut_id: string;
  cut_name: string;
  size: number;
  state: ExportState;
  progress: number;
  minutes: number;
  stale: boolean;
  requested_by: string;
  manifest_checksum: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface Allowance {
  workspace_id: string;
  month: string;
  export_minutes_used: number;
  export_minutes_allowance: number;
  storage_bytes_used: number;
  storage_bytes_allowance: number;
  resets_at: string;
  text: string;
}

export interface MediaRecord {
  id: string;
  name: string;
  kind: MediaKind;
  folder: string;
  bytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  sample_rate: number | null;
  used_in: string[];
}

export interface UploadRecord {
  upload_id: string;
  file_name: string;
  folder: string;
  bytes: number;
  sha256: string;
  chunks: number;
  chunks_received: number[];
  state: "open" | "receiving";
}

export interface Kit {
  id: string;
  name: string;
  text_colour: string;
  box_colour: string;
  font_weight: 400 | 600;
}

export interface ReviewLink {
  id: string;
  token: string;
  url: string;
  cut_id: string;
  expires_at: string;
  state: "active" | "expired" | "revoked";
}

export interface ReadToken {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  window_requests: number;
  window_ends_in_ms: number;
}

export interface OutboxItem {
  id: string;
  to: string;
  subject: string;
  state: "waiting" | "sent";
  attempts: number;
  created_at: string;
  sent_at: string | null;
}

export interface ProjectDetail {
  project: Project;
  rows: Row[];
  clips: Clip[];
  captions: Caption[];
  members: Member[];
  media: Record<string, MediaDims>;
}

export interface Stopped {
  at_frame: number;
  reason: string;
}

export interface OpChanges {
  clips: Clip[];
  captions: Caption[];
  comments: Comment[];
  rows: Row[];
  markers?: Marker[];
  project?: { aspect_ratio: AspectRatio; width: number; height: number };
}

/** What a client needs to announce an op in words. */
export interface OpSummary {
  type: string;
  clip_name?: string;
  at_frame?: number;
  cut_name?: string;
  aspect_ratio?: string;
}

export interface OpResult {
  version: number;
  changes: OpChanges;
  removed: string[];
  stopped: Stopped | null;
}

export interface LoggedOp extends OpResult {
  author: { id: string; name: string };
  op: OpSummary;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
  winner?: string;
  items?: unknown[];
  projects?: string[];
  missing?: number[];
  reason?: string;
  allowance?: Allowance;
}

export type LiveMessage =
  | ({ type: "op" } & LoggedOp)
  | { type: "comment"; comment: Comment }
  | { type: "export"; export: ExportRecord }
  | { type: "allowance"; allowance: Allowance }
  | { type: "playhead"; person: string; frame: number | null }
  | { type: "cut_shared"; cut: Cut }
  | { type: "role_changed"; role: Role | null }
  | { type: "token_window"; token_id: string; count: number; window_ends_in_ms: number };
