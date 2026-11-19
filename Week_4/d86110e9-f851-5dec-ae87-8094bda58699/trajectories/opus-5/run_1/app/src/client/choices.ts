import type { StepKind } from '../shared/types';

export const OPERATOR_CHOICES = [
  'equals',
  'not equals',
  'contains',
  'greater than',
  'less than',
  'is empty',
  'is not empty',
];

export interface ToolbarKind {
  kind: StepKind;
  label: string;
  key: string;
}

/** The toolbar buttons and the letter key that adds each kind. */
export const TOOLBAR_KINDS: ToolbarKind[] = [
  { kind: 'set', label: 'Add step: Set values', key: 's' },
  { kind: 'filter', label: 'Add step: Filter', key: 'f' },
  { kind: 'branch', label: 'Add step: Branch', key: 'b' },
  { kind: 'loop', label: 'Add step: Loop', key: 'l' },
  { kind: 'wait', label: 'Add step: Wait', key: 'w' },
  { kind: 'send_email', label: 'Add step: Send email', key: 'e' },
  { kind: 'add_row', label: 'Add step: Add row', key: 'a' },
  { kind: 'update_row', label: 'Add step: Update row', key: 'u' },
  { kind: 'call_webhook', label: 'Add step: Call webhook', key: 'h' },
];
