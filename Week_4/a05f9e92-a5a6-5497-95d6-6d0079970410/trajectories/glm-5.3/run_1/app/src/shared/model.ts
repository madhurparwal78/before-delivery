// Domain model: states, labels, transition tables, priority matrix, numbering.

export type Table = 'incident' | 'problem' | 'change' | 'request_item' | 'task';
export type Role = 'operator' | 'technician' | 'requester' | 'approver' | 'manager';

export const TABLES: Table[] = ['incident', 'problem', 'change', 'request_item', 'task'];

export const TABLE_LABEL: Record<Table, string> = {
  incident: 'Incident',
  problem: 'Problem',
  change: 'Change',
  request_item: 'Request item',
  task: 'Task',
};

export const TABLE_LABEL_PLURAL: Record<Table, string> = {
  incident: 'Incidents',
  problem: 'Problems',
  change: 'Changes',
  request_item: 'Request items',
  task: 'Tasks',
};

export type IncidentState = 'new' | 'assigned' | 'in_progress' | 'on_hold' | 'resolved' | 'closed' | 'cancelled';
export type ProblemState = 'new' | 'assessing' | 'known_error' | 'fix_in_progress' | 'resolved' | 'closed' | 'cancelled';
export type ChangeState =
  | 'draft' | 'assessed' | 'peer_review' | 'board_vote' | 'approved' | 'rejected'
  | 'implementing' | 'done' | 'cancelled';
export type RequestItemState =
  | 'submitted' | 'awaiting_approval' | 'approved' | 'rejected' | 'fulfilling' | 'delivered' | 'closed' | 'cancelled';
export type TaskState = 'open' | 'in_progress' | 'done' | 'cancelled';

export const INCIDENT_STATES: IncidentState[] = ['new', 'assigned', 'in_progress', 'on_hold', 'resolved', 'closed', 'cancelled'];
export const PROBLEM_STATES: ProblemState[] = ['new', 'assessing', 'known_error', 'fix_in_progress', 'resolved', 'closed', 'cancelled'];
export const CHANGE_STATES: ChangeState[] = ['draft', 'assessed', 'peer_review', 'board_vote', 'approved', 'rejected', 'implementing', 'done', 'cancelled'];
export const REQUEST_ITEM_STATES: RequestItemState[] = ['submitted', 'awaiting_approval', 'approved', 'rejected', 'fulfilling', 'delivered', 'closed', 'cancelled'];
export const TASK_STATES: TaskState[] = ['open', 'in_progress', 'done', 'cancelled'];

export const STATE_LABELS: Record<string, string> = {
  new: 'New',
  assigned: 'Assigned',
  in_progress: 'In progress',
  on_hold: 'On hold',
  resolved: 'Resolved',
  closed: 'Closed',
  cancelled: 'Cancelled',
  assessing: 'Assessing',
  known_error: 'Known error',
  fix_in_progress: 'Fix in progress',
  draft: 'Draft',
  assessed: 'Assessed',
  peer_review: 'Peer review',
  board_vote: 'Board vote',
  approved: 'Approved',
  rejected: 'Rejected',
  implementing: 'Implementing',
  done: 'Done',
  submitted: 'Submitted',
  awaiting_approval: 'Awaiting approval',
  fulfilling: 'Fulfilling',
  delivered: 'Delivered',
  open: 'Open',
};

export const STATUS_LABELS: Record<string, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  down: 'Down',
  maintenance: 'In maintenance',
};

export const PRIORITY_LABELS: Record<number, string> = {
  1: 'Critical',
  2: 'High',
  3: 'Moderate',
  4: 'Low',
  5: 'Planning',
};

export const SCALE_LABELS: Record<number, string> = { 1: 'High', 2: 'Medium', 3: 'Low' };

export const RISK_BANDS: Array<{ max: number; label: string }> = [
  { max: 9, label: 'Low' },
  { max: 17, label: 'Moderate' },
];

export function risk_band(score: number): string {
  for (const b of RISK_BANDS) if (score <= b.max) return b.label;
  return 'High';
}

/** Priority matrix: [impact][urgency] -> priority (1 is most urgent). */
export const PRIORITY_MATRIX: Record<number, Record<number, number>> = {
  1: { 1: 1, 2: 2, 3: 3 },
  2: { 1: 2, 2: 3, 3: 4 },
  3: { 1: 3, 2: 4, 3: 5 },
};

export function matrix_priority(impact: number, urgency: number): number {
  const row = PRIORITY_MATRIX[impact] || PRIORITY_MATRIX[3];
  return row[urgency] ?? row[3];
}

/** Priority for a record, bumped one level when its item is business-critical. */
export function compute_priority(impact: number, urgency: number, business_critical: boolean): number {
  let p = matrix_priority(impact, urgency);
  if (business_critical && p > 1) p -= 1;
  return p;
}

export const PREFIXES: Record<Table, string> = {
  incident: 'BRK-',
  problem: 'ROOT-',
  change: 'ALT-',
  request_item: 'ITM-',
  task: 'JOB-',
};

// Requests use their own sequence with prefix ASK-, articles ART-, sets SET-.
export const REQUEST_PREFIX = 'ASK-';
export const ARTICLE_PREFIX = 'ART-';
export const SET_PREFIX = 'SET-';

export function pad_number(n: number): string {
  return String(n).padStart(6, '0');
}

export interface TransitionSpec {
  from: string;
  to: string;
  roles: Role[];
  required: string[];
}

const DESK: Role[] = ['operator', 'technician'];
const OP: Role[] = ['operator'];

export const TRANSITIONS: Record<Table, TransitionSpec[]> = {
  incident: [
    { from: 'new', to: 'assigned', roles: DESK, required: ['assigned_to'] },
    { from: 'new', to: 'in_progress', roles: DESK, required: ['assigned_to'] },
    { from: 'assigned', to: 'in_progress', roles: DESK, required: ['assigned_to'] },
    { from: 'in_progress', to: 'on_hold', roles: DESK, required: ['hold_reason'] },
    { from: 'on_hold', to: 'in_progress', roles: DESK, required: [] },
    { from: 'in_progress', to: 'resolved', roles: DESK, required: ['resolution_code', 'resolution_note'] },
    { from: 'resolved', to: 'in_progress', roles: ['operator', 'technician', 'requester'], required: ['reopen_reason'] },
    { from: 'resolved', to: 'closed', roles: OP, required: [] },
    { from: 'new', to: 'cancelled', roles: OP, required: ['cancel_reason'] },
    { from: 'assigned', to: 'cancelled', roles: OP, required: ['cancel_reason'] },
    { from: 'in_progress', to: 'cancelled', roles: OP, required: ['cancel_reason'] },
    { from: 'on_hold', to: 'cancelled', roles: OP, required: ['cancel_reason'] },
  ],
  problem: [
    { from: 'new', to: 'assessing', roles: DESK, required: [] },
    { from: 'assessing', to: 'known_error', roles: DESK, required: ['workaround'] },
    { from: 'assessing', to: 'fix_in_progress', roles: OP, required: ['fix_change'] },
    { from: 'known_error', to: 'fix_in_progress', roles: OP, required: ['fix_change'] },
    { from: 'fix_in_progress', to: 'resolved', roles: OP, required: [] },
    { from: 'resolved', to: 'closed', roles: OP, required: [] },
    { from: 'new', to: 'cancelled', roles: OP, required: ['cancel_reason'] },
    { from: 'assessing', to: 'cancelled', roles: OP, required: ['cancel_reason'] },
    { from: 'known_error', to: 'cancelled', roles: OP, required: ['cancel_reason'] },
    { from: 'fix_in_progress', to: 'cancelled', roles: OP, required: ['cancel_reason'] },
  ],
  change: [
    { from: 'draft', to: 'assessed', roles: OP, required: ['configuration_item', 'planned_start', 'planned_end', 'implementation_plan', 'backout_plan'] },
    { from: 'assessed', to: 'peer_review', roles: OP, required: [] },
    { from: 'rejected', to: 'assessed', roles: OP, required: [] },
    { from: 'approved', to: 'implementing', roles: OP, required: [] },
    { from: 'implementing', to: 'done', roles: OP, required: ['outcome', 'close_note'] },
    { from: 'draft', to: 'cancelled', roles: OP, required: ['cancel_reason'] },
    { from: 'assessed', to: 'cancelled', roles: OP, required: ['cancel_reason'] },
    { from: 'peer_review', to: 'cancelled', roles: OP, required: ['cancel_reason'] },
    { from: 'board_vote', to: 'cancelled', roles: OP, required: ['cancel_reason'] },
    { from: 'approved', to: 'cancelled', roles: OP, required: ['cancel_reason'] },
    { from: 'rejected', to: 'cancelled', roles: OP, required: ['cancel_reason'] },
  ],
  request_item: [
    { from: 'delivered', to: 'closed', roles: OP, required: [] },
    { from: 'submitted', to: 'cancelled', roles: ['operator', 'requester'], required: ['cancel_reason'] },
    { from: 'awaiting_approval', to: 'cancelled', roles: ['operator', 'requester'], required: ['cancel_reason'] },
  ],
  task: [
    { from: 'open', to: 'in_progress', roles: DESK, required: [] },
    { from: 'in_progress', to: 'done', roles: DESK, required: ['close_note'] },
    { from: 'open', to: 'cancelled', roles: OP, required: ['cancel_reason'] },
    { from: 'in_progress', to: 'cancelled', roles: OP, required: ['cancel_reason'] },
  ],
};

// System-driven transitions (workflow steps, votes, fix changes) are not
// listed here; they are applied by the engine with actor 'system'.
export const SYSTEM_ACTOR = 'system';

export const STEP_STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started',
  open: 'Open',
  approved: 'Approved',
  rejected: 'Rejected',
  waiting: 'Waiting',
  running: 'Running',
  done: 'Done',
  skipped: 'Skipped',
  failed: 'Failed',
  handled: 'Handled',
};

export const RUN_STATUS_LABELS: Record<string, string> = {
  running: 'Running',
  waiting: 'Waiting',
  done: 'Done',
  failed: 'Failed',
};

export const PAGE_TITLES: Record<string, string> = {
  '/': 'Switchyard',
  '/login': 'Sign in',
};

export const APP_NAME = 'Switchyard';
export const WORDMARK = 'Ferrocline';
export const SENTENCE = 'One person, one organisation, every promise kept on its own clock.';
export const BUTTON_TEXT = 'Open your desk';
