export type Role = 'owner' | 'editor' | 'viewer';
export type RunStatus = 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'waiting' | 'retrying' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
export type StepKind = 'set' | 'filter' | 'branch' | 'loop' | 'wait' | 'send_email' | 'add_row' | 'update_row' | 'call_webhook';
export type TriggerKind = 'form' | 'schedule' | 'webhook' | 'row_added' | 'manual';
export type NodeKind = StepKind | TriggerKind;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Fields = { [key: string]: Json };

export interface Me {
  id: string;
  name: string;
  email: string;
  workspaces: Array<{ id: string; name: string; slug: string; role: Role }>;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  role: Role;
  time_zone: string;
  now: string;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  name: string;
  col: number;
  row: number;
  fields: Fields;
}

export interface TriggerNode extends GraphNode {
  kind: TriggerKind;
  sample: Fields;
}

export interface GraphEdge {
  id: string;
  from: string;
  port: string;
  to: string;
  order: number;
}

export interface DraftView {
  id: string;
  name: string;
  trigger_kind: TriggerKind;
  revision: number;
  live_version: number | null;
  drain_count: number;
  next_run_at: string | null;
  trigger: TriggerNode;
  steps: GraphNode[];
  edges: GraphEdge[];
  version?: number;
}

export interface AutomationItem {
  id: string;
  name: string;
  trigger_kind: TriggerKind;
  live_version: number | null;
  next_run_at: string | null;
  drain_count: number;
}

export interface RunItem {
  id: string;
  number: number;
  automation_id: string;
  automation_name: string;
  status: RunStatus;
  test: boolean;
  version: number | null;
  replay_of: string | null;
  started_at: string;
  finished_at: string | null;
  message: string | null;
  failed_step: string | null;
}

export interface RunStep {
  id: string;
  kind: NodeKind;
  name: string;
  col: number;
  row: number;
  status: StepStatus;
  reused: boolean;
  input: Json;
  output: Json;
  log: string[];
  attempts: number;
  started_at: string | null;
  finished_at: string | null;
  due_at: string | null;
  retry_at: string | null;
}

export interface RunDetailView extends RunItem {
  trigger: Json;
  steps: RunStep[];
  edges: GraphEdge[];
}

export interface TableView {
  id: string;
  name: string;
  columns: Array<{ name: string; type: 'text' | 'number' }>;
  row_count?: number;
  rows?: Array<Record<string, Json>>;
}

export interface MembersView {
  members: Array<{ user_id: string; name: string; email: string; role: Role }>;
  invites: Array<{ id: string; email: string; role: 'editor' | 'viewer' }>;
}

export type StreamEvent =
  | { type: 'run'; workspace_id: string; run: RunItem; steps: Array<{ id: string; status: StepStatus }> }
  | { type: 'version'; workspace_id: string; automation_id: string; version: number }
  | { type: 'drain'; workspace_id: string; automation_id: string; count: number }
  | { type: 'draft'; workspace_id: string; automation_id: string; revision: number; step_id: string }
  | { type: 'presence'; workspace_id: string; automation_id: string; members: Array<{ id: string; name: string }> }
  | { type: 'table'; workspace_id: string; table_id: string };
