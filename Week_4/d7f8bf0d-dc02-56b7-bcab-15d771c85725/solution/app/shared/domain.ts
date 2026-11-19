// Domain types shared by the server and the browser. Names follow the brief:
// block, authority, tick, open end, session version, crew packet.

export type Role = 'founder' | 'manager' | 'member' | 'operator'
export type DisplayUnits = 'in' | 'mm'
export type Hand = 'left' | 'right'
export type Direction = 'east' | 'west'
export type BlockKind = 'plain' | 'loop' | 'approach'
export type BlockState = 'free' | 'reserved' | 'occupied' | 'out_of_service'

export interface StandardsProfile {
  endplate_single_mm: number
  endplate_double_mm: number
  double_track_offset_mm: number
  end_straight_mm: number
  min_radius_mm: number
  max_grade_tenths_percent: number
  min_frog_number: number
  reverse_curve_straight_mm: number
  elevation_step_hundredths_mm: number
  display_units: DisplayUnits
}

export interface StandardsWithRevision extends StandardsProfile {
  revision: number
}

export interface Point {
  x_mm: number
  y_mm: number
  elevation_mm: number
  heading_deg: number
}

export interface StraightBody { kind: 'straight'; length_mm: number; rise_mm: number; mainline: boolean }
export interface CurveBody { kind: 'curve'; radius_mm: number; angle_deg: number; hand: Hand; rise_mm: number; mainline: boolean }
export interface TurnoutBody { kind: 'turnout'; frog_number: number; hand: Hand; length_mm: number; rise_mm: number; mainline: boolean }
export type PieceBody = StraightBody | CurveBody | TurnoutBody

interface StoredPiece {
  id: string
  length_mm: number
  block_id: string | null
  note: string
  start: Point
  end: Point
  open_end_id: string
  open_end_label: string
  after_piece_id: string | null
  added_by: string | null
}
export type Piece = (StraightBody | CurveBody | TurnoutBody) & StoredPiece

export interface OpenEnd extends Point {
  id: string
  label: string
  piece_id: string | null
}

export interface Endplate {
  end: 'A' | 'B'
  width_mm: number
  track_offsets_mm: number[]
}

export interface ModuleOrigin { x_mm: number; y_mm: number; heading_deg: number }

export interface LayoutModule {
  id: string
  name: string
  endplates: Endplate[]
  origin: ModuleOrigin
  pieces: Piece[]
  open_ends: OpenEnd[]
}

export interface LayoutBlock {
  id: string
  number: number
  name: string
  kind: BlockKind
  module_id: string | null
  neighbour_ids: string[]
}

export interface Station { id: string; name: string; block_ids: string[] }
export interface LayoutTurnout { id: string; stem_block_id: string; normal_block_id: string; reverse_block_id: string }
export interface TrainSpec {
  id: string
  number: string
  name: string
  direction: Direction
  speed_mph: number
  length_mm: number
  start_block_id: string
  head_offset_mm: number
}
export interface TimetableEntry { id: string; train_id: string; station_id: string; depart_fast_seconds: number }
export interface Timetable { version: number; entries: TimetableEntry[] }

export interface LayoutContent {
  modules: LayoutModule[]
  blocks: LayoutBlock[]
  stations: Station[]
  turnouts: LayoutTurnout[]
  trains: TrainSpec[]
  timetable: Timetable
}

export interface LayoutCounts { modules: number; pieces: number; blocks: number; trash: number }

export interface LayoutDetail {
  id: string
  name: string
  revision: number
  working_hash: string
  content: LayoutContent
  module_revisions: Record<string, number>
  counts: LayoutCounts
}

export interface Finding {
  rule: string
  module_id: string
  piece_id: string | null
  measured_mm: number
  limit_mm: number
  message: string
}

export type VersionState = 'Draft' | 'Validated' | 'Published'
export interface LayoutVersion {
  id: string
  number: number
  state: VersionState
  label: string
  canonical_hash: string
  saved_by: string
  saved_at: string
  restored_from: string | null
  revision: number
}

export interface HistoryRow {
  id: string
  actor: { id: string; display_name: string } | null
  at: string
  action: string
  object_id: string | null
  from: string | null
  to: string | null
}

export interface TrashedModule { id: string; name: string; trashed_by: string; trashed_at: string }

export interface Membership { workspace_id: string; workspace_name: string; role: Role }
export interface UserSummary { id: string; email: string; display_name: string }
export interface MemberRow { user_id: string; display_name: string; email: string; role: Role; revision: number }

// ---- sessions ---------------------------------------------------------------------------------

export type SessionStatus = 'Scheduled' | 'Running' | 'Held' | 'Interrupted' | 'Ended'
export type HoldReason = 'operator' | 'valkey' | null
export type AuthorityState = 'Requested' | 'Granted' | 'Refused' | 'Released' | 'Revoked'
export type EndedReason = 'completed' | 'cancelled' | 'expired' | 'moved'

export interface SessionTrain {
  id: string
  number: string
  name: string
  direction: Direction
  speed_mph: number
  length_mm: number
  head_block_id: string
  head_offset_mm: number
  trail_block_ids: string[]
  occupied_block_ids: string[]
  distance_run_mm: number
  carry: number
  authority_id: string | null
  revision: number
}

export interface SessionBlock {
  id: string
  number: number
  name: string
  kind: BlockKind
  length_mm: number
  state: BlockState
  train_number: string | null
  authority_id: string | null
}

export interface SessionTurnout { id: string; position: 'normal' | 'reverse'; locked_by_authority_id: string | null }

export interface Authority {
  id: string
  train_id: string
  state: AuthorityState
  block_ids: string[]
  remaining_block_ids: string[]
  limit_block_id: string
  expires_fast_seconds: number
  ended_reason: EndedReason | null
  revision: number
}

export interface Conflict {
  id: string
  state: 'Open' | 'Closed'
  train_id: string
  other_train_id: string | null
  block_id: string
  note: string
  revision: number
}

export interface Deadlock { id: string; state: 'Open' | 'Cleared'; raised_at_tick: number; train_numbers: string[] }
export interface TimetableProgress { entry_id: string; arrived_fast_seconds: number | null }
export interface Counters {
  occupied_blocks: number
  reserved_blocks: number
  free_blocks: number
  trains: number
  open_conflicts: number
}

export interface SessionSnapshot {
  id: string
  name: string
  status: SessionStatus
  hold_reason: HoldReason
  ratio: number
  revision: number
  control_revision: number
  session_version: number
  tick: number
  fast_clock_seconds: number
  fast_clock_label: string
  layout_version_id: string
  layout_version_number: number
  timetable_version: number
  trains: SessionTrain[]
  blocks: SessionBlock[]
  turnouts: SessionTurnout[]
  authorities: Authority[]
  conflicts: Conflict[]
  deadlocks: Deadlock[]
  timetable_progress: TimetableProgress[]
  counters: Counters
}

export interface SessionListItem { id: string; name: string; status: SessionStatus; tick: number; layout_version_number: number }

export interface RoutePreview {
  route_block_ids: string[]
  limit_block_id: string
  clear: boolean
  conflict_block_id: string | null
  other_train_number: string | null
}

export type PacketState = 'Queued' | 'Rendering' | 'Ready' | 'Failed' | 'Superseded'
export type PacketFailure = 'gotenberg_unreachable' | 'valkey_unreachable' | null
export interface CrewPacket {
  id: string
  state: PacketState
  session_version: number
  content_hash: string
  failure: PacketFailure
  issued_by: string
  issued_at: string
  ready_at: string | null
  byte_length: number | null
}

export interface PacketTimetableRow { entry_id: string; time: string; train_number: string; station: string }
export interface PacketContent {
  timetable: PacketTimetableRow[]
  train_orders: string[]
  block_table: Array<{ number: number; name: string; kind: BlockKind; length_mm: number }>
  track_diagram: Array<{ number: number; name: string; kind: BlockKind }>
}
export interface PacketPreview { session_version: number; content: PacketContent; content_hash: string }

// ---- events -----------------------------------------------------------------------------------

export type SessionEventType =
  | 'tick.committed' | 'authority.granted' | 'authority.refused' | 'authority.released' | 'train.moved'
  | 'conflict.closed' | 'conflict.changed' | 'session.status' | 'session.version' | 'block.changed'
  | 'turnout.changed' | 'packet.changed' | 'name.changed'

export type LayoutEventType =
  | 'piece.added' | 'piece.changed' | 'piece.removed' | 'module.changed' | 'version.changed'
  | 'timetable.changed' | 'name.changed'

export interface TickDetail {
  tick: number
  arrivals: Array<{ entry_id: string; train_number: string; arrived_fast_seconds: number }>
  authorities_released: Array<{ id: string; train_number: string; ended_reason: EndedReason }>
  authorities_revoked: Array<{ id: string; train_number: string; ended_reason: EndedReason }>
  deadlocks_raised: Array<{ id: string; train_numbers: string[] }>
}

export interface SessionEvent<D = Record<string, unknown>> {
  seq: number
  type: SessionEventType
  session: SessionSnapshot
  detail: D
}

export interface LayoutEvent {
  seq: number
  type: LayoutEventType
  actor: { id: string; display_name: string } | null
  layout: { revision: number; working_hash: string; counts: LayoutCounts }
  detail: Record<string, unknown>
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string>; current_revision?: number } & Record<string, unknown>
}
