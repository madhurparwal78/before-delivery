import type { JsonObject } from './json.js';

const STEP_KINDS = ['set', 'filter', 'branch', 'loop', 'wait', 'send_email', 'add_row', 'update_row', 'call_webhook'] as const;
const TRIGGER_KINDS = ['form', 'schedule', 'webhook', 'row_added', 'manual'] as const;

export type StepKind = (typeof STEP_KINDS)[number];
export type TriggerKind = (typeof TRIGGER_KINDS)[number];
type NodeKind = StepKind | TriggerKind;

export const GRID_COLUMNS = 24;
export const GRID_ROWS = 12;
export const TRIGGER_CELL = { col: 1, row: 2 } as const;

export const STEP_LABEL: Record<StepKind, string> = {
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

export const TRIGGER_LABEL: Record<TriggerKind, string> = {
  form: 'Form trigger',
  schedule: 'Schedule trigger',
  webhook: 'Webhook trigger',
  row_added: 'Row added trigger',
  manual: 'Manual trigger',
};

export const PORTS: Record<NodeKind, readonly string[]> = {
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

export function isStepKind(value: unknown): value is StepKind {
  return typeof value === 'string' && (STEP_KINDS as readonly string[]).includes(value);
}

export function isTriggerKind(value: unknown): value is TriggerKind {
  return typeof value === 'string' && (TRIGGER_KINDS as readonly string[]).includes(value);
}

export function defaultFields(kind: NodeKind): JsonObject {
  switch (kind) {
    case 'form':
      return { path: '', form_fields: [] };
    case 'schedule':
      return { schedule: '' };
    case 'webhook':
      return { path: '' };
    case 'row_added':
      return { table: '' };
    case 'manual':
      return {};
    case 'set':
      return { values: {} };
    case 'filter':
    case 'branch':
      return { left: '', operator: 'equals', right: '' };
    case 'loop':
      return { source: 'list', list: '', table: '' };
    case 'wait':
      return {};
    case 'send_email':
      return { to: '', subject: '', body: '' };
    case 'add_row':
      return { table: '', values: {} };
    case 'update_row':
      return { table: '', row_id: '', values: {} };
    case 'call_webhook':
      return { url: '', body: {} };
  }
}
