export type ItemKind = 'task' | 'milestone' | 'group';
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';
export type Role = 'owner' | 'editor' | 'viewer';
export type ExportFormat = 'csv' | 'pdf';

export interface Assignee {
  userId: string;
  name: string;
  hours: number;
}

export interface ItemBaseline {
  start: string;
  end: string;
  variance: number;
}

export interface Item {
  id: string;
  row: number;
  name: string;
  kind: ItemKind;
  group: string | null;
  chosenStart: string | null;
  start: string | null;
  end: string | null;
  duration: number;
  percent: number;
  critical: boolean;
  float: number | null;
  late: boolean;
  version: number;
  assignees: Assignee[];
  baseline: ItemBaseline | null;
}

export interface Link {
  id: string;
  from: string;
  to: string;
  type: LinkType;
  lag: number;
  critical: boolean;
}

export interface Holiday {
  date: string;
  name: string;
}

export interface ProjectBaseline {
  name: string;
  finish: string | null;
  finishVariance: number | null;
}

export interface Project {
  id: string;
  name: string;
  finish: string | null;
  holidays: Holiday[];
  items: Item[];
  links: Link[];
  baseline: ProjectBaseline | null;
}

export interface MovedItem {
  id: string;
  start: string | null;
  end: string | null;
}

export interface AppConfig {
  today: string;
  timeZone: string;
  assignNoticeDelaySeconds: number;
  presenceTimeoutSeconds: number;
  knockOnMs: number;
  knockOnStaggerMs: number;
  finishMotionMs: number;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export interface WorkspaceRef {
  id: string;
  name: string;
  role: Role;
}

export interface MeResponse {
  user: SessionUser;
  workspaces: WorkspaceRef[];
}

export interface ProjectListEntry {
  id: string;
  name: string;
  workspace: { id: string; name: string };
  finish: string | null;
}

export interface Comment {
  id: string;
  author: { userId: string; name: string };
  text: string;
  createdAt: string;
}

export interface ExportRecord {
  id: string;
  format: ExportFormat;
  filename: string;
  downloadUrl: string;
  createdAt: string;
}

export interface WorkloadAssignment {
  project: string;
  item: string;
  hours: number;
}

export interface WorkloadDay {
  date: string;
  hours: number;
  over: boolean;
  assignments: WorkloadAssignment[];
}

export interface WorkloadPerson {
  userId: string;
  name: string;
  capacity: number;
  overDays: number;
  days: WorkloadDay[];
}

export interface WorkloadResponse {
  from: string;
  days: string[];
  people: WorkloadPerson[];
}

export interface PresencePerson {
  userId: string;
  name: string;
  selected: string | null;
}

/** What the live channel carries after an accepted change. */
export type LiveVerb = 'changed' | 'added' | 'deleted' | 'commented' | 'holidays' | 'baseline';

export interface LiveEdit {
  /** The item the knock-on radiates from; null for holiday changes. */
  editedItemId: string | null;
  movedItemIds: string[];
  actorId: string;
  actorName: string;
  verb: LiveVerb;
  itemName: string | null;
  itemId: string | null;
}

export interface LiveProjectMessage {
  type: 'project';
  project: Project;
  edit: LiveEdit;
}

export interface LivePresenceMessage {
  type: 'presence';
  people: PresencePerson[];
}

export interface LiveCommentMessage {
  type: 'comment';
  itemId: string;
  itemName: string;
  actorId: string;
  comment: Comment;
}

export interface LiveExportsMessage {
  type: 'exports';
  exports: ExportRecord[];
}

/** Something changed somewhere in the workspace, so workload figures need re-reading. */
export interface LiveWorkspaceMessage {
  type: 'workspace';
}

export type LiveMessage =
  | LiveProjectMessage
  | LivePresenceMessage
  | LiveCommentMessage
  | LiveExportsMessage
  | LiveWorkspaceMessage;
