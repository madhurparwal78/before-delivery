// Wire shapes of the platform routes the shell calls. Domain shapes live in src/shared/model.ts.
import type { ExportKind, ExportStatus, InboxItem, ParameterDef, Role, SetDef } from '../../shared/model.ts';

export interface UserRef {
  id: string;
  username: string;
}

export interface ProjectRef {
  id: string;
  name: string;
  role: Role;
}

export interface Me {
  user: UserRef;
  projects: ProjectRef[];
}

export type WorkbookState = 'draft' | 'published';

export interface WorkbookListItem {
  id: string;
  name: string;
  project: string;
  state: WorkbookState;
  certified_by: string | null;
}

export interface WorkbookDetail extends WorkbookListItem {
  source: string;
  version: number;
  sheets: { id: string; name: string }[];
  dashboards: { id: string; name: string }[];
  parameters: ParameterDef[];
  sets: SetDef[];
}

export interface ProjectDetail {
  id: string;
  name: string;
  role: Role;
  explorers_schedule: boolean;
  members: { username: string; role: Role }[];
  sources: { id: string; name: string }[];
  workbooks: { id: string; name: string; state: WorkbookState; certified_by: string | null }[];
}

export interface InboxResponse {
  unread: number;
  items: InboxItem[];
}

export interface LineError {
  line: number | null;
  message: string;
}

export interface PreviewResponse {
  columns: { name: string; type: 'boolean' | 'number' | 'date' | 'text' }[];
  rows: (string | null)[][];
  row_count: number;
  errors: LineError[];
}

export interface ExportJob {
  id: string;
  kind: ExportKind;
  status: ExportStatus;
  progress: 0 | 50 | 100;
  download: string | null;
}
