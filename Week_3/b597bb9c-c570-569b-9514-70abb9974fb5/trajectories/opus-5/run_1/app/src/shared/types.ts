import type { FrameRateName } from '../domain/rate.js';

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:5'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const FRAME_SIZES: Record<AspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};

export function isAspectRatio(value: unknown): value is AspectRatio {
  return typeof value === 'string' && (ASPECT_RATIOS as readonly string[]).includes(value);
}

export type Role = 'owner' | 'editor' | 'commenter';
export type RowKind = 'video' | 'audio' | 'caption';
export type ClipKind = 'mp4' | 'wav' | 'png' | 'text';
export type MediaKind = 'mp4' | 'wav' | 'png';
export type KeyframeProperty = 'x' | 'y' | 'scale' | 'rotation' | 'opacity';
export type Curve = 'linear' | 'eased';
export type Visibility = 'team' | 'review';
export type ExportSize = 2160 | 1080 | 720;
export type ExportState = 'queued' | 'running' | 'done' | 'cancelled' | 'failed';

export const KEYFRAME_PROPERTIES: readonly KeyframeProperty[] = ['x', 'y', 'scale', 'rotation', 'opacity'];

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

export interface ProjectRecord {
  id: string;
  title: string;
  agency: string;
  description: string;
  frame_rate: FrameRateName;
  aspect_ratio: AspectRatio;
  width: number;
  height: number;
  time_unit: 'frames' | 'seconds';
  version: number;
  total_frames: number;
  role: Role;
  markers: Marker[];
  last_cut: { id: string; name: string; total_frames: number } | null;
}

export interface RowRecord {
  id: string;
  name: string;
  kind: RowKind;
  position: number;
  locked: boolean;
}

export interface Keyframe {
  frame: number;
  value: number;
  curve: Curve;
}

export type KeyframeMap = Partial<Record<KeyframeProperty, Keyframe[]>>;

export interface ClipRecord {
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
  keyframes: KeyframeMap;
}

export interface CaptionRecord {
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

export interface CommentRecord {
  id: string;
  author_name: string;
  body: string;
  visibility: Visibility;
  parent_id: string | null;
  cut_id: string | null;
  pin: CommentPin;
  mentions: string[];
  created_at: string;
}

export interface CutRecord {
  id: string;
  name: string;
  version: number;
  total_frames: number;
  shared: boolean;
  approvals: { name: string; at: string }[];
  created_at: string;
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

export interface ExportRecord {
  id: string;
  project_id: string;
  cut_id: string;
  cut_name: string;
  size: ExportSize;
  state: ExportState;
  progress: number;
  minutes: number;
  stale: boolean;
  requested_by: string;
  manifest_checksum: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface AllowanceRecord {
  workspace_id: string;
  month: string;
  export_minutes_used: number;
  export_minutes_allowance: number;
  storage_bytes_used: number;
  storage_bytes_allowance: number;
  resets_at: string;
  text: string;
}

export interface LayerBox {
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

export interface FrameResponse {
  frame: number;
  timecode: string;
  layers: LayerBox[];
}

export interface OpChanges {
  clips: ClipRecord[];
  captions: CaptionRecord[];
  comments: CommentRecord[];
  rows: RowRecord[];
}

export interface StoppedInfo {
  at_frame: number;
  reason: string;
}

export interface OpResult {
  version: number;
  changes: OpChanges;
  removed: string[];
  stopped: StoppedInfo | null;
  project?: ProjectRecord;
}

export interface LoggedOp {
  version: number;
  author: { id: string; name: string };
  op: { type: string; [key: string]: unknown };
  changes: OpChanges;
  removed: string[];
}

export interface KitRecord {
  id: string;
  name: string;
  text_colour: string;
  box_colour: string;
  font_weight: number;
}

export interface ReviewLinkRecord {
  id: string;
  token?: string;
  url?: string;
  cut_id: string;
  expires_at: string;
  state: 'active' | 'expired' | 'revoked';
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

export interface ServiceStatus {
  storage: 'up' | 'down';
  queue: 'up' | 'down';
  mail: 'up' | 'down';
}

export type ServerMessage =
  | { type: 'op'; version: number; author: { id: string; name: string }; op: { type: string; [k: string]: unknown }; changes: OpChanges; removed: string[]; project?: ProjectRecord; extra?: Record<string, unknown> }
  | { type: 'comment'; comment: CommentRecord }
  | { type: 'export'; export: ExportRecord }
  | { type: 'allowance'; allowance: AllowanceRecord }
  | { type: 'playhead'; person: string; frame: number }
  | { type: 'cut_shared'; cut: CutRecord }
  | { type: 'role_changed'; role: Role | null };

export type ClientMessage =
  | { type: 'subscribe'; project_id: string; after_version: number }
  | { type: 'subscribe_review' }
  | { type: 'playhead'; frame: number };
