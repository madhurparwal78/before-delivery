export type TriggerKind = 'form' | 'schedule' | 'webhook' | 'row_added' | 'manual';
export type StepKind =
  | 'set'
  | 'filter'
  | 'branch'
  | 'loop'
  | 'wait'
  | 'send_email'
  | 'add_row'
  | 'update_row'
  | 'call_webhook';
export type NodeKind = TriggerKind | StepKind;

export const TRIGGER_KINDS: readonly TriggerKind[] = ['form', 'schedule', 'webhook', 'row_added', 'manual'];
export const STEP_KINDS: readonly StepKind[] = [
  'set',
  'filter',
  'branch',
  'loop',
  'wait',
  'send_email',
  'add_row',
  'update_row',
  'call_webhook',
];

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface TriggerNode {
  id: 'trigger';
  kind: TriggerKind;
  name: string;
  col: number;
  row: number;
  fields: JsonObject;
  sample: JsonObject;
}

export interface StepNode {
  id: string;
  kind: StepKind;
  name: string;
  col: number;
  row: number;
  fields: JsonObject;
}

export interface Edge {
  id: string;
  from: string;
  port: string;
  to: string;
  order: number;
}

export interface AutomationContent {
  trigger: TriggerNode;
  steps: StepNode[];
  edges: Edge[];
}

export type RunStatus = 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
export type StepStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'retrying'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface RunListItem {
  id: string;
  number: number;
  automation_id: string;
  automation_name: string;
  status: RunStatus;
  test: boolean;
  version: number | null;
  replay_of: string | null;
  started_at: string | null;
  finished_at: string | null;
  message: string | null;
  failed_step: string | null;
}

export interface RunStepRecord {
  id: string;
  kind: NodeKind;
  name: string;
  col: number;
  row: number;
  status: StepStatus;
  reused: boolean;
  input: JsonValue;
  output: JsonValue;
  log: string[];
  attempts: number;
  started_at: string | null;
  finished_at: string | null;
  due_at: string | null;
  retry_at: string | null;
}

export interface RunDetail extends RunListItem {
  trigger: JsonValue;
  steps: RunStepRecord[];
  edges: Edge[];
}

export interface AutomationListItem {
  id: string;
  name: string;
  trigger_kind: TriggerKind;
  live_version: number | null;
  next_run_at: string | null;
  drain_count: number;
}

export interface AutomationDetail extends AutomationContent {
  id: string;
  name: string;
  trigger_kind: TriggerKind;
  revision: number;
  live_version: number | null;
  drain_count: number;
  next_run_at: string | null;
  version?: number;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  role: Role;
  time_zone: string;
  now: string;
}

export type Role = 'owner' | 'editor' | 'viewer';

export interface MeResponse {
  id: string;
  name: string;
  email: string;
  workspaces: { id: string; name: string; slug: string; role: Role }[];
}

export type StreamEvent =
  | { type: 'run'; workspace_id: string; run: RunListItem; steps: { id: string; status: StepStatus; name: string }[] }
  | { type: 'version'; workspace_id: string; automation_id: string; version: number }
  | { type: 'drain'; workspace_id: string; automation_id: string; count: number }
  | { type: 'draft'; workspace_id: string; automation_id: string; revision: number; step_id: string | null }
  | { type: 'presence'; workspace_id: string; automation_id: string; members: { id: string; name: string }[] }
  | { type: 'table'; workspace_id: string; table_id: string };

export const KIND_LABELS: Record<StepKind, string> = {
  set: 'Set values',
  filter: 'Filter',
  branch: 'Branch',
  loop: 'Loop',
  wait: 'Wait',
  send_email: 'Send email',
  add_row: 'Add row',
  update_row: 'Update row',
  call_webhook: 'Call webhook',
};

export const TRIGGER_LABELS: Record<TriggerKind, string> = {
  form: 'Form trigger',
  schedule: 'Schedule trigger',
  webhook: 'Webhook trigger',
  row_added: 'Row added trigger',
  manual: 'Manual trigger',
};

export const PORTS: Record<NodeKind, string[]> = {
  form: ['out'],
  schedule: ['out'],
  webhook: ['out'],
  row_added: ['out'],
  manual: ['out'],
  set: ['out', 'error'],
  filter: ['out'],
  branch: ['true', 'false'],
  loop: ['each', 'done'],
  wait: ['out'],
  send_email: ['out', 'error'],
  add_row: ['out', 'error'],
  update_row: ['out', 'error'],
  call_webhook: ['out', 'error'],
};

export const GRID_COLS = 24;
export const GRID_ROWS = 12;
