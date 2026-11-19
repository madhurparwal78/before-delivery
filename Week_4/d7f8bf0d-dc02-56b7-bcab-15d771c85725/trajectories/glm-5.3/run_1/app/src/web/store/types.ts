import type { CrewPacket, LayoutContent, SessionSnapshot, StandardsProfile } from '../../shared/domain';

export interface Me {
  user: { id: string; email: string; display_name: string; walkthrough_done: boolean };
  memberships: MembershipView[];
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: string;
}

export interface MembershipView {
  workspace_id: string;
  workspace_name: string;
  role: string;
}

export interface LayoutDetail {
  id: string;
  name: string;
  revision: number;
  working_hash: string;
  content: LayoutContent;
  module_revisions: Record<string, number>;
  counts: { modules: number; pieces: number; blocks: number; trash: number };
}

export interface SessionSummary {
  id: string;
  name: string;
  status: string;
  tick: number;
  layout_version_number: number;
}

export interface PacketPreview {
  session_version: number;
  content: Record<string, unknown>;
  content_hash: string;
}

export type SheetName =
  | 'layouts' | 'versions' | 'timetable' | 'crew-packets' | 'members'
  | 'standards' | 'history' | 'trash' | 'sessions';

export type NonModalSheet = 'conflict' | 'deadlock' | 'piece-inspector';

export interface ViewUrlState {
  workspace: string | null;
  layout: string | null;
  version: string | null;
  session: string | null;
  mode: 'build' | 'operate' | null;
  train: string | null;
  block: string | null;
  piece: string | null;
  end: string | null;
  heading: number | null;
  sheet: SheetName | null;
  dialog: NonModalSheet | null;
}

/** Event data as it arrives on the SSE streams. */
export interface SessionEventData {
  seq: number;
  type: string;
  session?: SessionSnapshot;
  detail?: Record<string, unknown>;
}

export interface LayoutEventData {
  seq: number;
  type: string;
  actor?: string;
  layout?: { revision: number; working_hash: string; counts: { modules: number; pieces: number; blocks: number; trash: number } };
  detail?: Record<string, unknown>;
}

export interface StatusInfo {
  valkey: 'up' | 'down';
  gotenberg: 'up' | 'down';
  instance: string;
}

export type { CrewPacket, LayoutContent, SessionSnapshot, StandardsProfile };
