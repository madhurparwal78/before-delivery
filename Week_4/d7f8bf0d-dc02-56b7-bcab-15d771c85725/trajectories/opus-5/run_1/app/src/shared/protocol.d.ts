export type Role = 'founder' | 'manager' | 'member' | 'operator';
export type DisplayUnits = 'in' | 'mm';
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
    display_units: DisplayUnits;
}
export interface StandardsProfileWithRevision extends StandardsProfile {
    revision: number;
}
export type Hand = 'left' | 'right';
export interface PieceInputStraight {
    kind: 'straight';
    length_mm: number;
    rise_mm?: number;
    mainline?: boolean;
}
export interface PieceInputCurve {
    kind: 'curve';
    radius_mm: number;
    angle_deg: number;
    hand: Hand;
    rise_mm?: number;
    mainline?: boolean;
}
export interface PieceInputTurnout {
    kind: 'turnout';
    frog_number: number;
    hand: Hand;
    length_mm: number;
    rise_mm?: number;
    mainline?: boolean;
}
export type PieceInput = PieceInputStraight | PieceInputCurve | PieceInputTurnout;
export interface Pose {
    x_mm: number;
    y_mm: number;
    elevation_mm: number;
    heading_deg: number;
}
export interface StoredPiece {
    id: string;
    kind: 'straight' | 'curve' | 'turnout';
    length_mm: number;
    rise_mm: number;
    mainline: boolean;
    radius_mm?: number;
    angle_deg?: number;
    hand?: Hand;
    frog_number?: number;
    block_id: string | null;
    note: string;
    added_by: string;
    start: Pose;
    end: Pose;
}
export interface OpenEnd extends Pose {
    id: string;
    label: string;
}
export interface Endplate {
    end: string;
    width_mm: number;
    track_offsets_mm: number[];
}
export interface ModuleContent {
    id: string;
    name: string;
    endplates: Endplate[];
    pieces: StoredPiece[];
    open_ends: OpenEnd[];
    origin: Pose;
}
export type BlockKind = 'plain' | 'loop' | 'approach';
export interface BlockContent {
    id: string;
    number: number;
    name: string;
    kind: BlockKind;
    length_mm: number;
    module_id: string | null;
    station_id: string | null;
    east_neighbour_ids: string[];
    west_neighbour_ids: string[];
}
export interface StationContent {
    id: string;
    name: string;
    block_ids: string[];
}
export interface TurnoutContent {
    id: string;
    stem_block_id: string;
    normal_block_id: string;
    reverse_block_id: string;
}
export type Direction = 'east' | 'west';
export interface TrainContent {
    id: string;
    number: string;
    name: string;
    direction: Direction;
    speed_mph: number;
    length_mm: number;
    start_block_id: string;
    start_head_offset_mm: number;
}
export interface TimetableEntry {
    id: string;
    train_id: string;
    station_id: string;
    depart_fast_seconds: number;
}
export interface TimetableContent {
    version: number;
    entries: TimetableEntry[];
}
export interface LayoutContent {
    modules: ModuleContent[];
    blocks: BlockContent[];
    stations: StationContent[];
    turnouts: TurnoutContent[];
    trains: TrainContent[];
    timetable: TimetableContent;
}
export type RuleName = 'min_radius' | 'max_grade' | 'min_turnout' | 'reverse_curve' | 'endplate_width' | 'track_centred' | 'end_straight' | 'elevation_step' | 'unassigned_block' | 'empty_module';
export interface Finding {
    rule: RuleName;
    module_id: string | null;
    piece_id: string | null;
    measured_mm: number;
    limit_mm: number;
    message: string;
}
export type VersionState = 'Draft' | 'Validated' | 'Published';
export interface LayoutVersionSummary {
    id: string;
    number: number;
    state: VersionState;
    label: string;
    canonical_hash: string;
    saved_by: string;
    saved_at: string;
    restored_from: number | null;
    revision: number;
}
export interface LayoutVersionDetail extends LayoutVersionSummary {
    content: LayoutContent;
}
export type SessionStatus = 'Scheduled' | 'Running' | 'Held' | 'Interrupted' | 'Ended';
export type HoldReason = 'operator' | 'valkey' | null;
export type BlockState = 'free' | 'reserved' | 'occupied' | 'out_of_service';
export interface SnapshotTrain {
    id: string;
    number: string;
    name: string;
    direction: Direction;
    speed_mph: number;
    length_mm: number;
    head_block_id: string;
    head_offset_mm: number;
    trail_block_ids: string[];
    occupied_block_ids: string[];
    distance_run_mm: number;
    carry: number;
    authority_id: string | null;
    revision: number;
}
export interface SnapshotBlock {
    id: string;
    number: number;
    name: string;
    kind: BlockKind;
    length_mm: number;
    state: BlockState;
    train_number: string | null;
    authority_id: string | null;
}
export interface SnapshotTurnout {
    id: string;
    position: 'normal' | 'reverse';
    locked_by_authority_id: string | null;
}
export type AuthorityState = 'Requested' | 'Granted' | 'Refused' | 'Released' | 'Revoked';
export type AuthorityEndedReason = 'completed' | 'cancelled' | 'expired' | 'moved' | null;
export interface SnapshotAuthority {
    id: string;
    train_id: string;
    state: AuthorityState;
    block_ids: string[];
    remaining_block_ids: string[];
    limit_block_id: string;
    expires_fast_seconds: number;
    ended_reason: AuthorityEndedReason;
    revision: number;
}
export interface SnapshotConflict {
    id: string;
    state: 'Open' | 'Closed';
    train_id: string;
    other_train_id: string | null;
    block_id: string;
    note: string;
    revision: number;
}
export interface SnapshotDeadlock {
    id: string;
    state: 'Open' | 'Cleared';
    raised_at_tick: number;
    train_numbers: string[];
}
export interface TimetableProgress {
    entry_id: string;
    arrived_fast_seconds: number | null;
}
export interface SnapshotCounters {
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
    trains: SnapshotTrain[];
    blocks: SnapshotBlock[];
    turnouts: SnapshotTurnout[];
    authorities: SnapshotAuthority[];
    conflicts: SnapshotConflict[];
    deadlocks: SnapshotDeadlock[];
    timetable_progress: TimetableProgress[];
    counters: SnapshotCounters;
    stations: StationContent[];
    timetable: TimetableContent;
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
export interface LayoutCounts {
    modules: number;
    pieces: number;
    blocks: number;
    trash: number;
}
export interface LayoutDetail {
    id: string;
    name: string;
    revision: number;
    working_hash: string;
    content: LayoutContent;
    module_revisions: Record<string, number>;
    counts: LayoutCounts;
}
export interface ApiErrorBody {
    error: {
        code: string;
        message: string;
    };
    findings?: Finding[];
    piece_id?: string;
    authority?: SnapshotAuthority;
    conflict?: SnapshotConflict;
    reachable_block_ids?: string[];
}
export type SessionEventType = 'tick.committed' | 'authority.granted' | 'authority.refused' | 'authority.released' | 'train.moved' | 'conflict.closed' | 'conflict.changed' | 'session.status' | 'session.version' | 'block.changed' | 'turnout.changed' | 'packet.changed' | 'name.changed';
export type LayoutEventType = 'piece.added' | 'piece.changed' | 'piece.removed' | 'module.changed' | 'version.changed' | 'timetable.changed' | 'name.changed';
export interface TickDetail {
    tick: number;
    arrivals: {
        entry_id: string;
        arrived_fast_seconds: number;
    }[];
    authorities_released: {
        id: string;
        train_number: string;
        ended_reason: AuthorityEndedReason;
    }[];
    authorities_revoked: {
        id: string;
        train_number: string;
        ended_reason: AuthorityEndedReason;
    }[];
    deadlocks_raised: {
        id: string;
        train_numbers: string[];
    }[];
}
export interface SessionEventData {
    seq: number;
    type: SessionEventType;
    session: SessionSnapshot;
    detail: Record<string, unknown>;
}
export interface LayoutEventData {
    seq: number;
    type: LayoutEventType;
    actor: string;
    layout: {
        revision: number;
        working_hash: string;
        counts: LayoutCounts;
    };
    detail: Record<string, unknown>;
}
