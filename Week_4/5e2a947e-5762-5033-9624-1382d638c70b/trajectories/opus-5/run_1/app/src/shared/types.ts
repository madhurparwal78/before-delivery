export type LayoutMode = 'map' | 'org' | 'list';
export type ThemeName = 'daylight' | 'paper' | 'dusk';
export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';
export type TaskState = 'open' | 'cancelled';
export type Priority = 'low' | 'normal' | 'high';
export type ShapeName = 'pill' | 'underline' | 'filled' | 'rounded';
export type SideName = 'left' | 'right' | 'none';
export type LinkType = 'related' | 'depends';
export type AttachmentType = 'png' | 'jpg';

export interface Task {
  percent: number;
  weight: number;
  state: TaskState;
  priority: Priority;
  due: string | null;
  assignee: string | null;
}

export interface Attachment {
  id: string;
  sha256: string;
  bytes: number;
  type: AttachmentType;
}

export interface StoredTopic {
  id: string;
  parent_id: string | null;
  floating: boolean;
  x: number | null;
  y: number | null;
  title: string;
  note: string;
  icon: string | null;
  colour: string | null;
  shape: ShapeName | null;
  side_pin: 'left' | 'right' | null;
  task: Task | null;
  locked_by: string | null;
  restricted: boolean;
  attachments: Attachment[];
  children: string[];
}

export interface CrossLink {
  id: string;
  from: string;
  to: string;
  label: string;
  type: LinkType;
}

export interface Boundary {
  id: string;
  topic_id: string;
  label: string;
}

export interface AppliedTitleEdit {
  rev: number;
  offset: number;
  delete: number;
  insert: string;
}

export interface Tombstone {
  rev: number;
  by: string;
  title: string;
  parent_id: string | null;
}

export interface TouchRecord {
  by: string;
  rev: number;
}

/** The whole authoritative state of one map. */
export interface MapDoc {
  root: string;
  topics: Record<string, StoredTopic>;
  floating: string[];
  links: CrossLink[];
  boundaries: Boundary[];
  slides: string[];
  layout: LayoutMode;
  theme: ThemeName;
  custom_colours: string[];
  title_edits: Record<string, AppliedTitleEdit[]>;
  tombstones: Record<string, Tombstone>;
  /** Who last moved or deleted each topic, and at which revision. */
  last_touch: Record<string, TouchRecord>;
}

export type OperationKind =
  | 'add'
  | 'add_floating'
  | 'title'
  | 'note'
  | 'move'
  | 'float_move'
  | 'delete'
  | 'task'
  | 'style'
  | 'pin'
  | 'link_add'
  | 'link_remove'
  | 'boundary_add'
  | 'boundary_remove'
  | 'lock'
  | 'unlock'
  | 'restrict'
  | 'layout'
  | 'theme'
  | 'slides'
  | 'custom_colour'
  /** Built only by the server, to undo a delete or to restore a version. */
  | 'restore_branch';

export interface Operation {
  op_id: string;
  kind: OperationKind;
  topic_id?: string;
  parent_id?: string | null;
  after?: string | null;
  title?: string;
  text?: string;
  offset?: number;
  delete?: number;
  insert?: string;
  x?: number;
  y?: number;
  task?: Partial<Task> | null;
  colour?: string | null;
  shape?: ShapeName | null;
  icon?: string | null;
  side?: 'left' | 'right' | null;
  link_id?: string;
  from?: string;
  to?: string;
  label?: string;
  type?: LinkType;
  boundary_id?: string;
  restricted?: boolean;
  layout?: LayoutMode;
  theme?: ThemeName;
  order?: string[];
  /** Carried by inverse groups that restore a deleted branch. */
  branch?: BranchSnapshot;
}

export interface BranchSnapshot {
  topics: StoredTopic[];
  links: CrossLink[];
  boundaries: Boundary[];
  parent_id: string | null;
  index: number;
  floating_index: number | null;
}

export interface OperationGroup {
  group_id: string;
  base_revision: number;
  ops: Operation[];
}

export type OpStatus = 'applied' | 'merged' | 'rejected' | 'recovered';
export type OpReason = 'cycle' | 'dependency_loop' | 'deleted' | 'anchor_gone' | null;

export interface OpResult {
  op_id: string;
  status: OpStatus;
  reason: OpReason;
}

export interface OpsResponse {
  group_id: string;
  status: OpStatus;
  revision: number;
  replayed: boolean;
  results: OpResult[];
  notice: string | null;
}

export interface RecoveredEntry {
  id: string;
  text: string;
  kind: 'title' | 'note' | 'add';
  from_title: string;
  parent_id: string | null;
}

export interface DerivedTopic {
  colour: string;
  shape: ShapeName;
  text: 'ink' | 'white';
  percent: number | 'dash' | null;
  earliest_due: string | null;
  overdue: boolean;
  blocked_by: string[];
  blocked_count: number;
  subtopics: number;
}

export interface ApiTopic {
  id: string;
  parent_id: string | null;
  rank: number;
  floating: boolean;
  x: number | null;
  y: number | null;
  title: string;
  note: string;
  icon: string | null;
  colour: string | null;
  shape: ShapeName | null;
  side_pin: 'left' | 'right' | null;
  task: Task | null;
  locked_by: string | null;
  lock_inherited: boolean;
  restricted: boolean;
  attachments: Attachment[];
  comment_count: number;
  vote_count: number;
  voted: boolean;
  derived: DerivedTopic;
}

export interface ClientSettings {
  toast_ms: number;
  presence_timeout_ms: number;
  virtual_from: number;
  dom_margin_px: number;
  dom_ceiling: number;
}

export interface MapPayload {
  map: {
    id: string;
    title: string;
    revision: number;
    layout: LayoutMode;
    theme: ThemeName;
    owner: string;
    role: Role;
    custom_colours: string[];
  };
  topics: ApiTopic[];
  links: CrossLink[];
  boundaries: Boundary[];
  collapsed: string[];
  slides: string[];
  recovered: RecoveredEntry[];
  server_time: string;
  server_date: string;
  settings: ClientSettings;
}

export interface VersionRow {
  id: string;
  number: number;
  name: string;
  kind: 'auto' | 'named' | 'restore';
  by: string;
  revision: number;
  created_at: string;
}

export interface VersionSnapshot {
  format: 'sprigmap-version-1';
  map_id: string;
  version: number;
  revision: number;
  layout: LayoutMode;
  theme: ThemeName;
  topics: StoredTopic[];
  links: CrossLink[];
  boundaries: Boundary[];
  slides: string[];
}

export type PresentationState = 'waiting' | 'live' | 'paused' | 'ended';
export type ShareLinkState = 'active' | 'expired' | 'revoked';
export type ExportState = 'queued' | 'running' | 'ready' | 'failed';
export type ExportFormat = 'sprig' | 'svg';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LaidOutTopic extends Box {
  id: string;
  side: SideName;
  level: number;
}

export type LayoutResult = Map<string, LaidOutTopic>;

export const BRANCH_COLOURS = [
  'indigo',
  'azure',
  'teal',
  'green',
  'violet',
  'magenta',
  'orange',
  'ochre',
] as const;

export const ICON_NAMES = [
  'star', 'flag', 'bulb', 'check', 'cross', 'question', 'clock', 'calendar',
  'pin', 'home', 'book', 'pencil', 'music', 'coin', 'cart', 'truck',
  'people', 'heart', 'warning', 'leaf', 'camera', 'phone', 'key', 'gift',
] as const;
