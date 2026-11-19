export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';
export type LayoutMode = 'map' | 'org' | 'list';
export type ThemeName = 'daylight' | 'paper' | 'dusk';
export type Side = 'left' | 'right';
export type ShapeName = 'pill' | 'underline' | 'filled' | 'rounded';
type LinkType = 'related' | 'depends';
export type Priority = 'low' | 'normal' | 'high';
type TaskState = 'open' | 'cancelled';
export type AttachmentType = 'png' | 'jpg';
export type OpReason = 'cycle' | 'dependency_loop' | 'deleted' | 'anchor_gone';
export type GroupStatus = 'applied' | 'merged' | 'rejected' | 'recovered';

export const BRANCH_COLOURS = ['indigo', 'azure', 'teal', 'green', 'violet', 'magenta', 'orange', 'ochre'] as const;
export type BranchColour = (typeof BRANCH_COLOURS)[number];
export const SHAPES: readonly ShapeName[] = ['pill', 'underline', 'filled', 'rounded'];
export const LAYOUTS: readonly LayoutMode[] = ['map', 'org', 'list'];
export const THEMES: readonly ThemeName[] = ['daylight', 'paper', 'dusk'];
export const ICONS = [
  'star', 'flag', 'bulb', 'check', 'cross', 'question', 'clock', 'calendar', 'pin', 'home', 'book', 'pencil',
  'music', 'coin', 'cart', 'truck', 'people', 'heart', 'warning', 'leaf', 'camera', 'phone', 'key', 'gift',
] as const;
type IconName = (typeof ICONS)[number];

export interface TaskFields {
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

/** A topic as stored in the map document. */
export interface DocTopic {
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
  side_pin: Side | null;
  task: TaskFields | null;
  locked_by: string | null;
  restricted: boolean;
  attachments: Attachment[];
  /** Creation counter, used for floating-topic order. */
  n: number;
}

export interface Link {
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

/** The materialised state of one map: everything that operations change. */
export interface MapDoc {
  topics: Record<string, DocTopic>;
  links: Link[];
  boundaries: Boundary[];
  slides: string[];
  layout: LayoutMode;
  theme: ThemeName;
  custom_colours: string[];
  next_n: number;
}

export interface Derived {
  colour: string;
  shape: ShapeName;
  text: 'ink' | 'white';
  percent: number | null | 'dash';
  earliest_due: string | null;
  overdue: boolean;
  blocked_by: string[];
  blocked_count: number;
  subtopics: number;
}

/** A topic as the API shows it to one person. */
export interface ApiTopic extends DocTopic {
  lock_inherited: boolean;
  comment_count: number;
  vote_count: number;
  voted: boolean;
  derived: Derived;
}

export interface RecoveredEntry {
  id: string;
  text: string;
  kind: 'title' | 'note' | 'add';
  from_title: string;
  parent_id: string | null;
}

export interface MapSettings {
  toast_ms: number;
  presence_timeout_ms: number;
  virtual_from: number;
  dom_margin_px: number;
  dom_ceiling: number;
  attach_max_bytes: number;
  map_quota_bytes: number;
  outline_max_bytes: number;
}

export interface MapHeader {
  id: string;
  title: string;
  revision: number;
  layout: LayoutMode;
  theme: ThemeName;
  owner: string;
  role: Role;
  custom_colours: string[];
}

export interface PresentationInfo {
  id: string;
  code: string;
  state: PresentationState;
  slide_index: number;
  followers: number;
}

export interface MapPayload {
  map: MapHeader;
  topics: ApiTopic[];
  links: Link[];
  boundaries: Boundary[];
  collapsed: string[];
  slides: string[];
  recovered: RecoveredEntry[];
  server_time: string;
  server_date: string;
  settings: MapSettings;
  /** Latest live-connection sequence at the time of this snapshot. */
  seq: number;
  /** The creation counter the next new topic takes, so the browser numbers topics as the server does. */
  next_n: number;
  /** The not-yet-ended presentation, shown to the owner only. */
  presentation: PresentationInfo | null;
  /** Who is asking: a user, or a guest by display name. */
  me: { id: string; name: string; guest: boolean };
  /** Usernames holding a role on the map, for mentions and assignees. */
  roster: string[];
}

export type PresentationState = 'waiting' | 'live' | 'paused' | 'ended';
export type LinkState = 'active' | 'expired' | 'revoked';
export type ExportState = 'queued' | 'running' | 'ready' | 'failed';
export type ExportFormat = 'sprig' | 'svg';

export interface VersionInfo {
  id: string;
  number: number;
  name: string;
  kind: 'auto' | 'named' | 'restore';
  by: string;
  revision: number;
  created_at: string;
}

export interface ShareLinkInfo {
  id: string;
  code: string;
  role: Exclude<Role, 'owner'>;
  expires_at: string | null;
  state: LinkState;
  url: string;
}

export interface ExportInfo {
  id: string;
  state: ExportState;
  progress: number;
  format: ExportFormat;
  download_url: string | null;
}

export interface CommentInfo {
  id: string;
  author: string;
  body: string;
  created_at: string;
}

export interface ThreadInfo extends CommentInfo {
  resolved: boolean;
  replies: CommentInfo[];
}

export interface MentionInfo {
  id: string;
  map_id: string;
  topic_id: string;
  comment_id: string;
  by: string;
  read: boolean;
}

export interface ActivityEntry {
  seq: number;
  user: string;
  sentence: string;
  topic_id: string | null;
  at: string;
}

export interface PresenceEntry {
  id: string;
  name: string;
  role: Role;
  guest: boolean;
  colour: BranchColour;
}

export interface ViewReport {
  zoom: number;
  pan_x: number;
  pan_y: number;
  width: number;
  height: number;
}

export interface AudienceTopic {
  id: string;
  parent_id: string | null;
  rank: number;
  title: string;
  derived: Pick<Derived, 'colour' | 'shape' | 'text'>;
  icon: string | null;
}

export interface AudiencePayload {
  state: PresentationState;
  slide_index: number;
  slide_count: number;
  presenter: string;
  followers: number;
  server_time: string;
  layout: LayoutMode;
  theme: ThemeName;
  slide: { topic_id: string; topics: AudienceTopic[] } | null;
}

// ---------------------------------------------------------------- operations

export interface BranchSnapshot {
  topics: DocTopic[];
  links: Link[];
  boundaries: Boundary[];
  /** Ids from the branch's parent up to the root, for restoring under the nearest survivor. */
  ancestors: string[];
}

interface OpBase {
  op_id: string;
}

export type PublicOp =
  | (OpBase & { kind: 'add'; topic_id: string; parent_id: string; after: string | null; title: string })
  | (OpBase & { kind: 'add_floating'; topic_id: string; x: number; y: number; title: string })
  | (OpBase & { kind: 'title'; topic_id: string; offset: number; delete: number; insert: string })
  | (OpBase & { kind: 'note'; topic_id: string; text: string })
  | (OpBase & { kind: 'move'; topic_id: string; parent_id: string; after: string | null })
  | (OpBase & { kind: 'float_move'; topic_id: string; x: number; y: number })
  | (OpBase & { kind: 'delete'; topic_id: string })
  | (OpBase & { kind: 'task'; topic_id: string; task: Partial<TaskFields> | null })
  | (OpBase & { kind: 'style'; topic_id: string; colour?: string | null; shape?: ShapeName | null; icon?: string | null })
  | (OpBase & { kind: 'pin'; topic_id: string; side: Side | null })
  | (OpBase & { kind: 'link_add'; link_id: string; from: string; to: string; label: string; type: LinkType })
  | (OpBase & { kind: 'link_remove'; link_id: string })
  | (OpBase & { kind: 'boundary_add'; boundary_id: string; topic_id: string; label: string })
  | (OpBase & { kind: 'boundary_remove'; boundary_id: string })
  | (OpBase & { kind: 'lock'; topic_id: string })
  | (OpBase & { kind: 'unlock'; topic_id: string })
  | (OpBase & { kind: 'restrict'; topic_id: string; restricted: boolean })
  | (OpBase & { kind: 'layout'; layout: LayoutMode })
  | (OpBase & { kind: 'theme'; theme: ThemeName })
  | (OpBase & { kind: 'slides'; order: string[] })
  | (OpBase & { kind: 'custom_colour'; colour: string });

/** Operations only the server produces: undo, redo, restore, graft and paste. */
type InternalOp =
  | (OpBase & { kind: 'put_branch'; branch: BranchSnapshot })
  | (OpBase & { kind: 'drop_links'; link_ids: string[]; boundary_ids: string[] });

export type Op = PublicOp | InternalOp;

export interface OpResult {
  op_id: string;
  status: GroupStatus;
  reason: OpReason | null;
}

export interface OpsResponse {
  group_id: string;
  status: GroupStatus;
  revision: number;
  replayed: boolean;
  results: OpResult[];
  notice: string | null;
}

// ------------------------------------------------------------- live messages

export type LiveMessage =
  | {
      type: 'op';
      group_id: string;
      user: string;
      revision: number;
      ops: Op[];
      sentence: string;
      focus_topic_id: string | null;
      hidden?: boolean;
    }
  | { type: 'resync' }
  | { type: 'presence'; people: PresenceEntry[] }
  | { type: 'cursor'; user: string; colour: BranchColour; x: number; y: number; topic_id: string | null; view: ViewReport | null }
  | { type: 'notice'; text: string }
  | { type: 'comment'; topic_id: string; comment_count: number; thread: ThreadInfo; by: string }
  | { type: 'vote'; topic_id: string; vote_count: number; by: string; voted_by_me: boolean | null }
  | { type: 'role'; role: Role }
  | { type: 'access_removed' }
  | { type: 'session_expired' }
  | { type: 'link_expired'; state: 'expired' | 'revoked' }
  | { type: 'version'; version: VersionInfo }
  | { type: 'export'; export: ExportInfo }
  | { type: 'presentation'; presentation: PresentationInfo; skipped: SkippedSlide[] }
  | { type: 'recovered'; entries: RecoveredEntry[] }
  | { type: 'derived'; server_date: string }
  | { type: 'inbox'; unread: number };

export type Sequenced<T> = T & { seq: number };

export interface SkippedSlide {
  index: number;
  reason: 'deleted' | 'restricted';
}
