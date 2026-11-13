/** Shared record shapes served by the API and used by the browser. */
export interface Person {
  id: string;
  name: string;
  email: string;
  handle: string;
}

export type Role = 'owner' | 'editor' | 'commenter';

export interface Marker {
  frame: number;
  label: string;
}

export interface CutRef {
  id: string;
  name: string;
  total_frames: number;
}

export interface Project {
  id: string;
  title: string;
  agency: string;
  description: string;
  frame_rate: string;
  aspect_ratio: string;
  width: number;
  height: number;
  time_unit: 'frames' | 'seconds';
  version: number;
  total_frames: number;
  role: Role;
  markers: Marker[];
  last_cut: CutRef | null;
}

export type RowKind = 'video' | 'audio' | 'caption';

export interface Row {
  id: string;
  name: string;
  kind: RowKind;
  position: number;
  locked: boolean;
}

export type ClipKind = 'mp4' | 'wav' | 'png' | 'text';

export interface KeyframeV {
  frame: number;
  value: number;
  curve: 'linear' | 'eased';
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
  keyframes: Record<string, KeyframeV[]>;
}

export interface Caption {
  id: string;
  row_id: string;
  start_frame: number;
  end_frame: number;
  text: string;
}

export interface CommentPin {
  frame: number;
  row_id: string | null;
  clip_id: string | null;
  live_frame: number;
}

export interface Comment {
  id: string;
  author_name: string;
  body: string;
  visibility: 'team' | 'review';
  parent_id: string | null;
  cut_id: string | null;
  pin: CommentPin;
  mentions: string[];
  created_at: string;
}

export interface Approval {
  name: string;
  at: string;
}

export interface Cut {
  id: string;
  name: string;
  version: number;
  total_frames: number;
  shared: boolean;
  approvals: Approval[];
  created_at: string;
}

export type MediaKind = 'mp4' | 'wav' | 'png';

export interface Media {
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

export type ExportState = 'queued' | 'running' | 'done' | 'cancelled' | 'failed';

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

export interface Member {
  person: Person;
  role: Role;
}

export interface OpAuthor {
  id: string;
  name: string;
}

export interface OpLogEntry {
  version: number;
  author: OpAuthor;
  op: Record<string, unknown>;
  changes: OpChanges;
}

export interface OpChanges {
  clips: Clip[];
  captions: Caption[];
  comments: Comment[];
  rows: Row[];
  removed?: string[];
  stopped?: { at_frame: number; reason: string } | null;
}

export interface FrameLayer {
  clip_id: string;
  row_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export interface ReviewProjectInfo {
  title: string;
  frame_rate: string;
  aspect_ratio: string;
  width: number;
  height: number;
}

export interface ReviewResponse {
  project: ReviewProjectInfo;
  owner_name: string;
  cut: {
    id: string;
    name: string;
    total_frames: number;
    rows: Row[];
    clips: Clip[];
    captions: Caption[];
  };
  comments: Comment[];
  approvals: Approval[];
}

export interface TokenRecord {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export interface OutboxItem {
  id: string;
  to: string;
  subject: string;
  state: 'waiting' | 'sent';
  attempts: number;
  created_at: string;
  sent_at: string | null;
}

export interface Kit {
  id: string;
  name: string;
  text_colour: string;
  box_colour: string;
  font_weight: number;
}
