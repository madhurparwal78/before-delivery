export type Axis = 'column' | 'row';
export type Scope = 'base' | number;
export type Role = 'owner' | 'collaborator' | 'viewer';

export interface Area {
  name: string;
  row_start: number;
  column_start: number;
  row_end: number;
  column_end: number;
}

export interface Gap {
  row: number;
  column: number;
}

export interface Grid {
  columns: string[];
  rows: string[];
  areas: Area[];
}

export interface Breakpoint extends Grid {
  min_width: number;
  gap: Gap | null;
}

export interface LayoutState extends Grid {
  gap: Gap;
  breakpoints: Breakpoint[];
}

/** What a layout is at one revision: its state and the code generated from it. */
export interface LayoutContent extends LayoutState {
  revision: number;
  css: string;
  html: string;
}

export interface LayoutObject extends LayoutContent {
  id: string;
  name: string;
  role: Role;
  live: boolean;
}

export type Change =
  | { kind: 'set_track'; scope: Scope; axis: Axis; index: number; size: string }
  | { kind: 'add_track'; scope: Scope; axis: Axis; after: number }
  | { kind: 'remove_track'; scope: Scope; axis: Axis; index: number }
  | { kind: 'set_gap'; scope: Scope; row: number; column: number }
  | ({ kind: 'set_area'; scope: Scope; name: string } & Rect)
  | { kind: 'rename_area'; name: string; new_name: string }
  | ({ kind: 'clear_cells'; scope: Scope } & Rect)
  | { kind: 'add_breakpoint'; min_width: number }
  | { kind: 'remove_breakpoint'; min_width: number }
  | { kind: 'apply_css'; css: string }
  | { kind: 'restore_version'; number: number }
  | { kind: 'undo' }
  | { kind: 'redo' };

export interface Rect {
  row_start: number;
  column_start: number;
  row_end: number;
  column_end: number;
}

export interface ChangeReply {
  revision: number;
  layout: LayoutObject;
  announcement: string;
}

export interface ConflictBody {
  error: 'conflict';
  revision: number;
  layout: LayoutObject;
  message: string;
}

export interface LiveChange {
  type: 'change';
  editor: string | null;
  author: string;
  revision: number;
  announcement: string;
  restored: number | null;
  layout: LayoutContent;
}

export type LiveMessage = LiveChange | { type: 'presence'; designers: string[] };

export interface ShareInfo {
  view_path: string | null;
  join_path: string;
  collaborators: string[];
}

export interface VersionSummary {
  number: number;
  name: string;
}

/** One row of "Your layouts". */
export interface LibraryEntry {
  id: string;
  name: string;
  role: Exclude<Role, 'viewer'>;
  columns: string[];
}
