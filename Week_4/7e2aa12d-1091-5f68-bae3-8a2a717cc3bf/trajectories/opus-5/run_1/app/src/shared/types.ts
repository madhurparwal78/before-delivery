export type Axis = 'column' | 'row';

/** `"base"` or a breakpoint's minimum width. */
export type Scope = 'base' | number;

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

export interface Breakpoint {
  min_width: number;
  columns: string[];
  rows: string[];
  areas: Area[];
  gap: Gap | null;
}

export interface LayoutState {
  columns: string[];
  rows: string[];
  gap: Gap;
  areas: Area[];
  breakpoints: Breakpoint[];
}

export type Role = 'owner' | 'collaborator' | 'viewer';

export interface LayoutObject extends LayoutState {
  id: string;
  name: string;
  role: Role;
  revision: number;
  live: boolean;
  css: string;
  html: string;
}

export interface Limits {
  maxTracks: number;
  maxBreakpoints: number;
}

export type Change =
  | { kind: 'set_track'; scope: Scope; axis: Axis; index: number; size: string }
  | { kind: 'add_track'; scope: Scope; axis: Axis; after: number }
  | { kind: 'remove_track'; scope: Scope; axis: Axis; index: number }
  | { kind: 'set_gap'; scope: Scope; row: number; column: number }
  | {
      kind: 'set_area';
      scope: Scope;
      name: string;
      row_start: number;
      column_start: number;
      row_end: number;
      column_end: number;
    }
  | { kind: 'rename_area'; name: string; new_name: string }
  | {
      kind: 'clear_cells';
      scope: Scope;
      row_start: number;
      column_start: number;
      row_end: number;
      column_end: number;
    }
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
