export type Role = 'founder' | 'manager' | 'member' | 'operator';

export interface UserRecord {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  walkthrough_done: boolean;
}

export interface MembershipRecord {
  workspace_id: string;
  user_id: string;
  role: Role;
}

export interface StandardsProfile {
  endplate_single_mm: number;
  endplate_double_mm: number;
  double_track_offset_mm: number;
  end_straight_mm: number;
  min_radius_mm: number;
  max_grade_tenths_percent: number;
  min_frog_number: number;
  reverse_curve_straight_mm: number;
  elevation_step_hundredths_mm: number;
  display_units: 'in' | 'mm';
}

export type EndplateKind = 'single' | 'double';

export interface Endplate {
  end: 'A' | 'B';
  width_mm: number;
  track_offsets_mm: number[];
}

export type PieceKind = 'straight' | 'curve' | 'turnout';

export interface Point {
  x_mm: number;
  y_mm: number;
  elevation_mm: number;
  heading_deg: number;
}

export interface Piece {
  id: string;
  kind: PieceKind;
  length_mm: number;
  rise_mm: number;
  mainline: boolean;
  block_id: string | null;
  note: string;
  start: Point;
  end: Point;
  radius_mm?: number;
  angle_deg?: number;
  hand?: 'left' | 'right';
  frog_number?: number;
}

export interface OpenEnd {
  id: string;
  label: string;
  x_mm: number;
  y_mm: number;
  elevation_mm: number;
  heading_deg: number;
  parent_piece_id: string | null;
}

export interface Module {
  id: string;
  name: string;
  endplates: Endplate[];
  pieces: Piece[];
  open_ends: OpenEnd[];
  trashed: boolean;
  trashed_by: string | null;
  trashed_at: string | null;
}

export interface Block {
  id: string;
  number: number;
  name: string;
  kind: 'plain' | 'loop' | 'approach';
  length_mm: number;
}

export interface Station {
  id: string;
  name: string;
  block_ids: string[];
}

export interface Turnout {
  id: string;
  stem_block_id: string;
  normal_block_id: string;
  reverse_block_id: string;
}

export interface Train {
  id: string;
  number: string;
  name: string;
  direction: 'east' | 'west';
  speed_mph: number;
  length_mm: number;
  start_block_id: string;
  head_offset_mm: number;
}

export interface TimetableEntry {
  id: string;
  train_id: string;
  station_id: string;
  depart_fast_seconds: number;
}

export interface Timetable {
  version: number;
  entries: TimetableEntry[];
}

export interface LayoutContent {
  modules: Module[];
  blocks: Block[];
  stations: Station[];
  turnouts: Turnout[];
  trains: Train[];
  timetable: Timetable;
  /** Block adjacency: the ordered block numbers a route may follow, west to east. */
  block_sequence?: string[];
}

export type VersionState = 'Draft' | 'Validated' | 'Published';

export interface LayoutVersion {
  id: string;
  layout_id: string;
  number: number;
  state: VersionState;
  label: string;
  canonical_hash: string;
  content: LayoutContent;
  saved_by: string;
  saved_at: string;
  restored_from: string | null;
  revision: number;
  timetable_version: number;
}

export type SessionStatus = 'Scheduled' | 'Running' | 'Held' | 'Interrupted' | 'Ended';
export type HoldReason = 'operator' | 'valkey' | null;

export interface SessionTrain {
  id: string;
  number: string;
  name: string;
  direction: 'east' | 'west';
  speed_mph: number;
  length_mm: number;
  start_block_id: string;
  start_head_offset_mm: number;
  head_block_id: string;
  head_offset_mm: number;
  trail_block_ids: string[];
  occupied_block_ids: string[];
  distance_run_mm: number;
  carry: number;
  authority_id: string | null;
  revision: number;
}

export interface SessionBlock {
  id: string;
  number: number;
  name: string;
  kind: 'plain' | 'loop' | 'approach';
  length_mm: number;
  state: 'free' | 'reserved' | 'occupied' | 'out_of_service';
  train_number: string | null;
  authority_id: string | null;
}

export interface SessionTurnout {
  id: string;
  position: 'normal' | 'reverse';
  locked_by_authority_id: string | null;
}

export type AuthorityState = 'Requested' | 'Granted' | 'Refused' | 'Released' | 'Revoked';
export type AuthorityEndReason = 'completed' | 'cancelled' | 'expired' | 'moved' | null;

export interface Authority {
  id: string;
  train_id: string;
  state: AuthorityState;
  block_ids: string[];
  remaining_block_ids: string[];
  limit_block_id: string;
  destination_block_id: string;
  via_block_id: string | null;
  expires_fast_seconds: number;
  ended_reason: AuthorityEndReason;
  revision: number;
}

export interface Conflict {
  id: string;
  state: 'Open' | 'Closed';
  train_id: string;
  other_train_id: string | null;
  block_id: string;
  note: string;
  revision: number;
}

export interface Deadlock {
  id: string;
  state: 'Open' | 'Cleared';
  raised_at_tick: number;
  train_numbers: string[];
  member_train_ids: string[];
}

export interface TimetableProgress {
  entry_id: string;
  arrived_fast_seconds: number | null;
}

export interface SessionCounters {
  occupied_blocks: number;
  reserved_blocks: number;
  free_blocks: number;
  trains: number;
  open_conflicts: number;
}

export interface SessionSnapshot {
  id: string;
  name: string;
  status: SessionStatus;
  hold_reason: HoldReason;
  ratio: number;
  revision: number;
  control_revision: number;
  session_version: number;
  tick: number;
  fast_clock_seconds: number;
  fast_clock_label: string;
  layout_version_id: string;
  layout_version_number: number;
  timetable_version: number;
  trains: SessionTrain[];
  blocks: SessionBlock[];
  turnouts: SessionTurnout[];
  authorities: Authority[];
  conflicts: Conflict[];
  deadlocks: Deadlock[];
  timetable_progress: TimetableProgress[];
  counters: SessionCounters;
}

export type PacketState = 'Queued' | 'Rendering' | 'Ready' | 'Failed' | 'Superseded';

export interface CrewPacket {
  id: string;
  state: PacketState;
  session_version: number;
  content_hash: string | null;
  failure: 'gotenberg_unreachable' | 'valkey_unreachable' | null;
  issued_by: string;
  issued_at: string;
  ready_at: string | null;
  byte_length: number | null;
}

export interface HistoryRow {
  id: string;
  actor: string;
  at: string;
  action: string;
  object_id: string | null;
  from: string | null;
  to: string | null;
}

export interface Finding {
  rule: string;
  module_id: string | null;
  piece_id: string | null;
  measured_mm: number;
  limit_mm: number;
  message: string;
}
