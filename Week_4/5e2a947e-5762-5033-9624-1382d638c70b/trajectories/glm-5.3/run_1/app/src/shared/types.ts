/**
 * Sprigmap domain types shared by the server and the browser.
 * Field shapes follow the published API payloads.
 */

export type Layout = 'map' | 'org' | 'list';
export type ThemeName = 'daylight' | 'paper' | 'dusk';
export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';
export type BranchColourName =
  | 'indigo' | 'azure' | 'teal' | 'green'
  | 'violet' | 'magenta' | 'orange' | 'ochre';
export type ShapeName = 'rounded' | 'pill' | 'underline' | 'filled';
export type TextColour = 'ink' | 'white';
export type IconName =
  | 'star' | 'flag' | 'bulb' | 'check' | 'cross' | 'question' | 'clock' | 'calendar'
  | 'pin' | 'home' | 'book' | 'pencil' | 'music' | 'coin' | 'cart' | 'truck'
  | 'people' | 'heart' | 'warning' | 'leaf' | 'camera' | 'phone' | 'key' | 'gift';
export type TaskPriority = 'low' | 'normal' | 'high';
export type TaskState = 'open' | 'cancelled';

export interface TaskFields {
  percent: number;
  weight: number;
  state: TaskState;
  priority: TaskPriority;
  due: string | null;
  assignee: string | null;
}

export interface Attachment {
  id: string;
  sha256: string;
  bytes: number;
  type: 'png' | 'jpg';
  state?: 'stored';
}

export interface TopicNode {
  id: string;
  parent_id: string | null;
  rank: number;
  floating: boolean;
  x: number | null;
  y: number | null;
  title: string;
  note: string;
  icon: IconName | null;
  colour: string | null;
  shape: ShapeName | null;
  side_pin: 'left' | 'right' | null;
  task: TaskFields | null;
  locked_by: string | null;
  lock_inherited: boolean;
  restricted: boolean;
  attachments: Attachment[];
  comment_count: number;
  vote_count: number;
  voted: boolean;
}

export interface CrossLink {
  id: string;
  from: string;
  to: string;
  label: string;
  type: 'related' | 'depends';
}

export interface Boundary {
  id: string;
  topic_id: string;
  label: string;
}

export interface Derived {
  colour: string;
  shape: ShapeName;
  text: TextColour;
  percent: number | 'dash' | null;
  earliest_due: string | null;
  overdue: boolean;
  blocked_by: string[];
  blocked_count: number;
  subtopics: number;
}

export type Topic = TopicNode & { derived: Derived };

export interface MapMeta {
  id: string;
  title: string;
  revision: number;
  layout: Layout;
  theme: ThemeName;
  owner: string;
  role: Role;
  custom_colours: string[];
}

export interface SettingsPublic {
  toast_ms: number;
  presence_timeout_ms: number;
  virtual_from: number;
  dom_margin_px: number;
  dom_ceiling: number;
}

export interface RecoveredEntry {
  id: string;
  text: string;
  kind: 'title' | 'note' | 'add';
  from_title: string;
  parent_id: string;
}

export type OpStatus = 'applied' | 'merged' | 'rejected' | 'recovered';
export type RejectReason = 'cycle' | 'dependency_loop' | 'deleted' | 'anchor_gone' | null;

export interface OpResult {
  op_id: string;
  status: OpStatus;
  reason: RejectReason;
}

export interface GroupResponse {
  group_id: string;
  status: OpStatus;
  revision: number;
  replayed: boolean;
  results: OpResult[];
  notice: string | null;
}

export type OpKind =
  | 'add' | 'add_floating' | 'title' | 'note' | 'move' | 'float_move' | 'delete'
  | 'task' | 'style' | 'pin' | 'link_add' | 'link_remove' | 'boundary_add'
  | 'boundary_remove' | 'lock' | 'unlock' | 'restrict' | 'layout' | 'theme'
  | 'slides' | 'custom_colour';

export interface Operation {
  op_id: string;
  kind: OpKind;
  topic_id?: string;
  parent_id?: string | null;
  after?: string | null;
  title?: string;
  offset?: number;
  delete?: number;
  insert?: string;
  text?: string;
  x?: number;
  y?: number;
  task?: Partial<TaskFields> | null;
  colour?: string | null;
  shape?: ShapeName | null;
  icon?: IconName | null;
  side?: 'left' | 'right' | null;
  link_id?: string;
  from?: string;
  to?: string;
  label?: string;
  type?: 'related' | 'depends';
  boundary_id?: string;
  restricted?: boolean;
  layout?: Layout;
  theme?: ThemeName;
  order?: string[];
}

export interface CommentThread {
  id: string;
  author: string;
  body: string;
  resolved: boolean;
  created_at: string;
  replies: { id: string; author: string; body: string; created_at: string }[];
}

export interface MapPayload {
  map: MapMeta;
  topics: Topic[];
  links: CrossLink[];
  boundaries: Boundary[];
  collapsed: string[];
  slides: string[];
  recovered: RecoveredEntry[];
  server_time: string;
  server_date: string;
  settings: SettingsPublic;
}

export interface PersonInfo {
  username: string;
  role: Role;
  guest: boolean;
  colour: number;
}

export interface PresencePerson extends PersonInfo {
  view: { zoom: number; pan_x: number; pan_y: number; width: number; height: number };
  cursor: { x: number; y: number; topic_id: string | null };
}

export interface ActivityEntry {
  seq: number;
  user: string;
  sentence: string;
  topic_id: string | null;
  at: string;
}

export interface VersionInfo {
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
  layout: Layout;
  theme: ThemeName;
  topics: TopicNode[];
  links: CrossLink[];
  boundaries: Boundary[];
  slides: string[];
}

export interface PresentationInfo {
  id: string;
  code: string;
  state: 'waiting' | 'live' | 'paused' | 'ended';
  slide_index: number;
  followers: number;
  map_id?: string;
}

export interface ExportInfo {
  id: string;
  state: 'queued' | 'running' | 'ready' | 'failed';
  progress: number;
  format: 'sprig' | 'svg';
  download_url: string | null;
}

export interface ShareLink {
  id: string;
  code: string;
  role: Exclude<Role, 'owner'>;
  expires_at: string | null;
  state: 'active' | 'expired' | 'revoked';
  url: string;
}

export interface MemberRow {
  username: string;
  role: Role;
}
