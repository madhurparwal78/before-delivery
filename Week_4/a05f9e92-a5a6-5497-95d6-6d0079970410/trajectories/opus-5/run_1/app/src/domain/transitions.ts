/**
 * The published transition tables. Records move only along these rows, and this
 * is the one place that decides a move, its roles and its required fields.
 */

import { ApiError } from '../errors';
import { fieldLabel, type TableName, typeWords } from './fields';
import type { RoleKey } from './roles';

export type IncidentState =
  | 'new'
  | 'assigned'
  | 'in_progress'
  | 'on_hold'
  | 'resolved'
  | 'closed'
  | 'cancelled';

export type ProblemState =
  | 'new'
  | 'assessing'
  | 'known_error'
  | 'fix_in_progress'
  | 'resolved'
  | 'closed'
  | 'cancelled';

export type ChangeState =
  | 'draft'
  | 'assessed'
  | 'peer_review'
  | 'board_vote'
  | 'approved'
  | 'rejected'
  | 'implementing'
  | 'done'
  | 'cancelled';

export type RequestItemState =
  | 'submitted'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'fulfilling'
  | 'delivered'
  | 'closed'
  | 'cancelled';

export type TaskState = 'open' | 'in_progress' | 'done' | 'cancelled';

export type RecordState = IncidentState | ProblemState | ChangeState | RequestItemState | TaskState;

export const stateLabels: Readonly<Record<TableName, Readonly<Record<string, string>>>> = {
  incident: {
    new: 'New',
    assigned: 'Assigned',
    in_progress: 'In progress',
    on_hold: 'On hold',
    resolved: 'Resolved',
    closed: 'Closed',
    cancelled: 'Cancelled',
  },
  problem: {
    new: 'New',
    assessing: 'Assessing',
    known_error: 'Known error',
    fix_in_progress: 'Fix in progress',
    resolved: 'Resolved',
    closed: 'Closed',
    cancelled: 'Cancelled',
  },
  change: {
    draft: 'Draft',
    assessed: 'Assessed',
    peer_review: 'Peer review',
    board_vote: 'Board vote',
    approved: 'Approved',
    rejected: 'Rejected',
    implementing: 'Implementing',
    done: 'Done',
    cancelled: 'Cancelled',
  },
  request_item: {
    submitted: 'Submitted',
    awaiting_approval: 'Awaiting approval',
    approved: 'Approved',
    rejected: 'Rejected',
    fulfilling: 'Fulfilling',
    delivered: 'Delivered',
    closed: 'Closed',
    cancelled: 'Cancelled',
  },
  task: {
    open: 'Open',
    in_progress: 'In progress',
    done: 'Done',
    cancelled: 'Cancelled',
  },
};

export function stateLabel(table: TableName, state: string): string {
  return stateLabels[table][state] ?? state;
}

/** Who may make a move. `system` moves are made by the server, never by a person. */
export type Mover = RoleKey | 'system' | 'caller' | 'requester';

export interface TransitionRow {
  readonly from: readonly string[];
  readonly to: string;
  readonly roles: readonly Mover[];
  readonly required?: readonly string[];
  /** Change models this row belongs to. */
  readonly models?: readonly string[];
}

const incidentTransitions: readonly TransitionRow[] = [
  { from: ['new'], to: 'assigned', roles: ['operator', 'technician'], required: ['assigned_to'] },
  { from: ['new', 'assigned'], to: 'in_progress', roles: ['operator', 'technician'], required: ['assigned_to'] },
  { from: ['in_progress'], to: 'on_hold', roles: ['operator', 'technician'], required: ['hold_reason'] },
  { from: ['on_hold'], to: 'in_progress', roles: ['operator', 'technician'] },
  {
    from: ['in_progress'],
    to: 'resolved',
    roles: ['operator', 'technician'],
    required: ['resolution_code', 'resolution_note'],
  },
  {
    from: ['resolved'],
    to: 'in_progress',
    roles: ['operator', 'technician', 'caller'],
    required: ['reopen_reason'],
  },
  { from: ['resolved'], to: 'closed', roles: ['operator'] },
  {
    from: ['new', 'assigned', 'in_progress', 'on_hold'],
    to: 'cancelled',
    roles: ['operator'],
    required: ['cancel_reason'],
  },
];

const problemTransitions: readonly TransitionRow[] = [
  { from: ['new'], to: 'assessing', roles: ['operator', 'technician'] },
  { from: ['assessing'], to: 'known_error', roles: ['operator', 'technician'], required: ['workaround'] },
  { from: ['assessing', 'known_error'], to: 'fix_in_progress', roles: ['operator'], required: ['fix_change'] },
  { from: ['fix_in_progress'], to: 'resolved', roles: ['operator'] },
  { from: ['resolved'], to: 'closed', roles: ['operator'] },
  {
    from: ['new', 'assessing', 'known_error', 'fix_in_progress'],
    to: 'cancelled',
    roles: ['operator'],
    required: ['cancel_reason'],
  },
];

const normalDraftFields = [
  'configuration_item',
  'planned_start',
  'planned_end',
  'implementation_plan',
  'backout_plan',
];

const changeTransitions: readonly TransitionRow[] = [
  {
    models: ['normal'],
    from: ['draft'],
    to: 'assessed',
    roles: ['operator'],
    required: normalDraftFields,
  },
  { models: ['normal'], from: ['assessed'], to: 'peer_review', roles: ['operator'] },
  { models: ['normal'], from: ['peer_review'], to: 'board_vote', roles: ['system'] },
  { models: ['normal'], from: ['peer_review'], to: 'approved', roles: ['system'] },
  { models: ['normal'], from: ['board_vote'], to: 'approved', roles: ['system'] },
  { models: ['normal'], from: ['peer_review', 'board_vote'], to: 'rejected', roles: ['system'] },
  { models: ['normal'], from: ['rejected'], to: 'assessed', roles: ['operator'] },
  {
    models: ['emergency'],
    from: ['draft'],
    to: 'board_vote',
    roles: ['operator'],
    required: normalDraftFields,
  },
  { models: ['emergency'], from: ['board_vote'], to: 'approved', roles: ['system'] },
  { models: ['emergency'], from: ['board_vote'], to: 'rejected', roles: ['system'] },
  {
    models: ['standard'],
    from: ['draft'],
    to: 'approved',
    roles: ['operator'],
    required: ['standard_template', 'configuration_item', 'planned_start', 'planned_end'],
  },
  { from: ['approved'], to: 'implementing', roles: ['operator'] },
  { from: ['implementing'], to: 'done', roles: ['operator'], required: ['outcome', 'close_note'] },
  {
    from: ['draft', 'assessed', 'peer_review', 'board_vote', 'approved', 'rejected'],
    to: 'cancelled',
    roles: ['operator'],
    required: ['cancel_reason'],
  },
];

const requestItemTransitions: readonly TransitionRow[] = [
  { from: ['submitted'], to: 'awaiting_approval', roles: ['system'] },
  { from: ['submitted'], to: 'fulfilling', roles: ['system'] },
  { from: ['awaiting_approval'], to: 'approved', roles: ['system'] },
  { from: ['approved'], to: 'fulfilling', roles: ['system'] },
  { from: ['awaiting_approval'], to: 'rejected', roles: ['system'] },
  { from: ['fulfilling'], to: 'delivered', roles: ['system'] },
  { from: ['delivered'], to: 'closed', roles: ['operator'] },
  {
    from: ['submitted', 'awaiting_approval'],
    to: 'cancelled',
    roles: ['operator', 'requester'],
    required: ['cancel_reason'],
  },
];

const taskTransitions: readonly TransitionRow[] = [
  { from: ['open'], to: 'in_progress', roles: ['operator', 'technician'] },
  { from: ['in_progress'], to: 'done', roles: ['operator', 'technician'], required: ['close_note'] },
  {
    from: ['open', 'in_progress'],
    to: 'cancelled',
    roles: ['operator'],
    required: ['cancel_reason'],
  },
];

export const transitionTables: Readonly<Record<TableName, readonly TransitionRow[]>> = {
  incident: incidentTransitions,
  problem: problemTransitions,
  change: changeTransitions,
  request_item: requestItemTransitions,
  task: taskTransitions,
};

export const initialStates: Readonly<Record<TableName, string>> = {
  incident: 'new',
  problem: 'new',
  change: 'draft',
  request_item: 'submitted',
  task: 'open',
};

/** States that count as closed for "open records" counting and request closure. */
export const closedStates: Readonly<Record<TableName, readonly string[]>> = {
  incident: ['resolved', 'closed', 'cancelled'],
  problem: ['resolved', 'closed', 'cancelled'],
  change: ['done', 'cancelled', 'rejected'],
  request_item: ['delivered', 'closed', 'rejected', 'cancelled'],
  task: ['done', 'cancelled'],
};

export function isOpenState(table: TableName, state: string): boolean {
  return !closedStates[table].includes(state);
}

export function rowsFor(table: TableName, model: string | null): readonly TransitionRow[] {
  const rows = transitionTables[table];
  if (table !== 'change') return rows;
  return rows.filter((r) => !r.models || (model !== null && r.models.includes(model)));
}

export function findTransition(
  table: TableName,
  model: string | null,
  from: string,
  to: string,
): TransitionRow | undefined {
  return rowsFor(table, model).find((r) => r.from.includes(from) && r.to === to);
}

/** The moves a given mover may make from a state. */
export function allowedTransitions(
  table: TableName,
  model: string | null,
  from: string,
  movers: readonly Mover[],
): TransitionRow[] {
  return rowsFor(table, model).filter(
    (r) => r.from.includes(from) && r.roles.some((role) => movers.includes(role)),
  );
}

export function illegalTransition(table: TableName, from: string, to: string): ApiError {
  return new ApiError(
    422,
    'illegal_transition',
    `Cannot move ${typeWords[table]} from ${stateLabel(table, from)} to ${stateLabel(table, to)}.`,
  );
}

export function roleNotAllowed(table: TableName, to: string): ApiError {
  return new ApiError(
    422,
    'role_not_allowed',
    `Your role cannot move this ${typeWords[table]} to ${stateLabel(table, to)}.`,
  );
}

export function fieldRequired(table: TableName, field: string, to: string): ApiError {
  const label = fieldLabel(table, field);
  return new ApiError(
    422,
    'field_required',
    `${label} is required to move to ${stateLabel(table, to)}.`,
    { [field]: `${label} is required to move to ${stateLabel(table, to)}.` },
  );
}
