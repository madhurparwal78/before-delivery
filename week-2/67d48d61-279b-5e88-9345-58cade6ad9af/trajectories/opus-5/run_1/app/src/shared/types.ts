import type { AttachmentKind, CycleKey, Priority, Status } from './domain.js';

export interface SubtaskRollUp {
  done: number;
  total: number;
}

export interface Task {
  id: string;
  number: number;
  title: string;
  details: string;
  department: string | null;
  label: string | null;
  status: Status;
  priority: Priority;
  owner: string | null;
  cycle: CycleKey | null;
  parent: string | null;
  subtasks: SubtaskRollUp | null;
  blocked_by: string[];
  blocks: string[];
  blocked: boolean;
  duplicate_of: string | null;
  request: string | null;
  version: number;
  updated_at: string;
}

export interface CycleSnapshot {
  key: CycleKey;
  name: string;
  starts_at: string;
  ends_at: string | null;
  current: boolean;
  done: number;
  total: number;
}

export interface Snapshot {
  seq: number;
  triage: number;
  columns: Record<'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled', number>;
  blocked: number;
  cycles: CycleSnapshot[];
}

export interface CascadeEntry {
  id: string;
  depth: number;
  order: number;
  freed_by: string;
}

export interface ReblockedEntry {
  id: string;
  order: number;
}

export interface ChangeResult {
  change: number;
  undoable: boolean;
  tasks: Task[];
  cascade: CascadeEntry[];
  reblocked: ReblockedEntry[];
  snapshot: Snapshot;
}

export interface RequestOutcome {
  id: string;
  status: string;
  task: string | null;
}

export interface DecisionResult extends ChangeResult {
  request: RequestOutcome;
}

export type ChangeKind =
  | 'create'
  | 'edit'
  | 'bulk'
  | 'undo'
  | 'relation'
  | 'decision'
  | 'pull'
  | 'rollover'
  | 'attachment';

export interface Attachment {
  id: string;
  task: string;
  file_name: string;
  kind: AttachmentKind;
  size: number;
  content_type: string;
  created_at: string;
  current: boolean;
}

export interface AttachmentChangeEvent {
  change: number;
  undoable: false;
  kind: 'attachment';
  attachment: Attachment;
  cascade: CascadeEntry[];
  reblocked: ReblockedEntry[];
  snapshot: Snapshot;
}

export type ChangeEvent = (ChangeResult & { kind: ChangeKind }) | AttachmentChangeEvent;

export interface ActivityEntry {
  id: number;
  task: string;
  at: string;
  actor: { handle: string; name: string } | null;
  kind: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  change: number;
}

export interface IntakeRequest {
  id: string;
  title: string;
  details: string;
  requester: string;
  department: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'merged';
  task: string | null;
  created: string;
  decided_at: string | null;
}

export interface Production {
  theatre: string;
  show: string;
  time_zone: string;
  today: string;
  opening_night: string;
  days_to_opening: number;
  current_cycle: CycleKey;
  departments: { key: string; name: string; labels: { key: string; name: string }[] }[];
  crew: { handle: string; name: string; role: string; department: string | null }[];
}

export interface ServiceStatus {
  intake: 'up' | 'down';
  plot_storage: 'up' | 'down';
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    current?: Task | Task[];
    blocked_by?: string[];
    tasks?: string[];
  };
}
