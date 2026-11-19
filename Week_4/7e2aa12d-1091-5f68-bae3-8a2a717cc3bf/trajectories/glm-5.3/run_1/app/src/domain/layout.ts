// The layout domain types, shared by server and client.
export type Role = 'owner' | 'collaborator' | 'viewer';
export type ScopeName = 'base' | number;

export interface Gap { row: number; column: number }
export interface AreaLine {
  name: string;
  row_start: number;
  column_start: number;
  row_end: number;
  column_end: number;
}
export interface Breakpoint {
  min_width: number;
  columns: string[];
  rows: string[];
  areas: AreaLine[];
  gap: Gap | null;
}
export interface LayoutData {
  name: string;
  revision: number;
  columns: string[];
  rows: string[];
  gap: Gap;
  areas: AreaLine[];
  breakpoints: Breakpoint[];
}

export interface LayoutObject extends LayoutData {
  id: string;
  role: Role;
  live: boolean;
  css: string;
  html: string;
}
